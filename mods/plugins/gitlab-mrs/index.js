// GitLab Merge Requests: your open merge requests, by project, with each
// pipeline's stages and jobs -- in a view in Slack's rail, and as a small
// summary of the latest pipeline in Slack's top bar.
//
// The pieces, in the order they are read:
//
//   lib/      the rules -- statuses, stages, progress, grouping, which pipeline
//             is worth a word, how the bar shrinks, when to ask again, what is
//             kept. Pure: no DOM, no network.
//   api/      the five reads of GitLab's REST API, through `api.net`
//   store.js  who is signed in, what GitLab last said, when to ask again
//   ui/       the view, the top bar, the popovers, the sign-in form
//
// What leaves Slack for GitLab is a path and an id. Nothing Slack knows is ever
// sent: no message, no channel, no workspace, no Slack token. The only thing sent
// anywhere else is a GitLab token -- and that is not this plugin's to send:
// `api.net.setCredential` hands it to the loader once, which keeps it where
// this page cannot read it and attaches it to requests for the address in this
// plugin's settings, and for nothing else.
//
// Everything is registered through `api`, so switching the plugin off takes
// the tab, the bar, the popovers, the timers and the commands with it.

import { STRINGS } from './strings.js';
import { createClient, normaliseServer } from './api/gitlab.js';
import { createStore } from './store.js';
import { buildHeadline, failingCount, findPipeline } from './lib/headline.js';
import { createFormat } from './ui/format.js';
import { createLayer } from './ui/layer.js';
import { createLogin } from './ui/login.js';
import { createView } from './ui/view.js';
import { createJobsPopover } from './ui/jobs-popover.js';
import { createRecent } from './ui/recent.js';
import { BAR_ID, SLOT, createBar } from './ui/topbar.js';

/** How often the screen is brought up to date with the clock ("3 min ago"). Costs no request. */
const REPAINT_MS = 30_000;
/** How often the plugin considers asking GitLab. It asks only when `lib/schedule.js` says it is time. */
const BEAT_MS = 5_000;
/** Changes arriving together are one repaint. */
const COALESCE_MS = 40;

/** A merge: two branches becoming one. Original, and nothing of anybody's logo. */
const ICON = `<svg viewBox="0 0 20 20" aria-hidden="true" fill="none">
  <circle cx="5.5" cy="4.5" r="2" stroke="currentColor" stroke-width="1.6"/>
  <circle cx="5.5" cy="15.5" r="2" stroke="currentColor" stroke-width="1.6"/>
  <circle cx="14.5" cy="9.5" r="2" stroke="currentColor" stroke-width="1.6"/>
  <path d="M5.5 6.5v7M5.5 9.5h7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
</svg>`;

export default {
  /**
   * @param {import('../../../src/runtime/api.js').PluginApi} api
   */
  async start(api) {
    const t = api.i18n.strings(STRINGS);
    const format = createFormat(t, api.i18n.locale);
    api.css(api.assets.text('gitlab.css'));

    let disposed = false;
    let view = null;
    let bar = null;
    let recent = null;
    api.onDispose(() => { disposed = true; });

    const client = createClient({
      request: (url, options) => api.net.request(url, options),
      getBase: () => normaliseServer(api.settings.get('gitUrl', '')),
    });

    // -- repainting: one pass, whoever asked ---------------------------------
    let timer = null;
    const paint = () => {
      timer = null;
      if (disposed) return;
      const { state } = store;
      view?.update(state);
      bar?.update(buildHeadline(state));
      layer.refresh();
    };
    const schedule = () => {
      if (timer === null && !disposed) timer = setTimeout(paint, COALESCE_MS);
    };
    api.onDispose(() => clearTimeout(timer));

    const store = createStore({ api, client, onChange: schedule });
    const layer = createLayer({ api });

    const pipelineOf = (id) => findPipeline(store.state, id);
    const jobs = createJobsPopover({ api, t, format, layer, pipelineOf });
    recent = createRecent({
      api, t, layer,
      getModel: () => buildHeadline(store.state),
      onSeeMore: () => tab.open(),
      onStage: (anchor, pipelineId, name) => jobs.open(anchor, pipelineId, name),
    });

    const login = createLogin({ api, t, store });
    view = createView({
      api, t, format, store, login,
      onStage: (anchor, pipelineId, name) => jobs.open(anchor, pipelineId, name),
      onSignOut: async () => {
        await store.signOut();
        paint();
      },
    });
    api.onDispose(() => view.dispose());

    const tab = api.slack.addView({
      id: 'merge-requests',
      label: t('railLabel'),
      icon: ICON,
      render: () => view.element,
      onOpen: () => {
        layer.close();
        store.setViewOpen(true);
        paint();
        if (!store.state.signedIn) setTimeout(() => view.focusLogin(), 0);
      },
      onClose: () => {
        layer.close();
        store.setViewOpen(false);
      },
    });

    // -- the rail's badge: what is failing, or how many are open --------------
    const badge = api.settings.get('railBadge', 'failed');
    if (badge !== 'none') {
      api.helpers.badge(tab.tabSelector, 'gitlab', () => {
        const { state } = store;
        if (!state.signedIn) return null;
        if (badge === 'count') return state.mergeRequests.length || null;
        return failingCount(state) || null;
      });
    }

    // -- the top bar ------------------------------------------------------------
    if (api.settings.get('topBar', true) !== false) {
      bar = createBar({
        api, t,
        onOpen: (anchor) => {
          const model = buildHeadline(store.state);
          // Nothing to list until signed in: the bar is the way to the form.
          if (model.phase === 'signedOut' || model.phase === 'invalid') {
            tab.open();
            return;
          }
          recent.toggle(anchor, () => bar.setExpanded(false));
          bar.setExpanded(layer.isOpen() && layer.anchorIs(anchor));
        },
      });
      api.helpers.mount(SLOT, BAR_ID, () => bar.element);
    }

    // -- what was kept, before anything decides whether somebody is signed in ---
    await store.load();
    if (disposed) return;
    paint();
    api.onDispose(() => { void store.flush(); store.dispose(); });
    api.helpers.poll(() => store.tick(), BEAT_MS);
    api.helpers.poll(paint, REPAINT_MS);

    api.commands.add({ id: 'open', title: t('commandOpen'), icon: '🔀', run: () => tab.open() });
    api.commands.add({
      id: 'refresh',
      title: t('commandRefresh'),
      icon: '🔄',
      run: () => {
        if (!store.state.signedIn) tab.open();
        else void store.refresh({ force: true });
      },
    });
  },
};
