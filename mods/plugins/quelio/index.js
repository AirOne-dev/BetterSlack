// Quelio: the week's progress toward its objective, and when to leave today,
// in Slack's top bar.
//
// The pieces, in the order they are read:
//
//   lib/        the rules (out of the settings) and the arithmetic -- pure, no DOM, no network
//   quelio.js   the one request quelio-api understands, through `api.net`
//   session.js  who is signed in, what Quelio last said, when to ask again
//   view.js     all of that plus the clock, as what is on screen right now
//   ui/         the bar, its details, and the sign-in form
//
// Nothing here reads Slack: no message, no channel, no workspace, no token.
// The only thing taken from the client is the language it speaks. The only
// thing sent anywhere is a Quelio username with a password or a token, to the
// address in this plugin's settings.
//
// Everything is registered through `api`, so switching it off takes the bar,
// the details, the timers and the commands with it.

import { STRINGS } from './strings.js';
import { readRules } from './lib/rules.js';
import { createClient } from './quelio.js';
import { createSession } from './session.js';
import { buildView, createFormat } from './view.js';
import { BAR_ID, BEFORE, SLOT, createBar } from './ui/bar.js';
import { createDetails } from './ui/details.js';
import { openLogin } from './ui/login.js';

/** How often the screen follows the clock. Nothing on it is finer than a minute. */
const REPAINT_MS = 20_000;
/** How often a refresh is considered. Costs nothing unless one is due. */
const CHECK_MS = 60_000;

export default {
  /**
   * @param {import('../../../src/runtime/api.js').PluginApi} api
   */
  async start(api) {
    const t = api.i18n.strings(STRINGS);
    const format = createFormat(t, api.i18n.locale);
    api.css(api.assets.text('quelio.css'));
    // The company's rules are settings; one that cannot be read is its default.
    const { rules, invalid } = readRules((key, fallback) => api.settings.get(key, fallback));
    if (invalid.length) api.log.warn(`settings not usable, defaults used instead: ${invalid.join(', ')}`);

    let bar = null;
    let details = null;
    let signedIn = false;
    // A request still travelling when the plugin is switched off answers into
    // an instance that is gone; it may not repaint or toast from there.
    let disposed = false;
    api.onDispose(() => { disposed = true; });

    const paint = () => {
      if (disposed) return;
      const view = buildView(session.state, new Date(), rules);
      bar?.update(view);
      details?.update(view);
      // Quelio ended the session: say so once, where it happened.
      const now = Boolean(session.state.session);
      if (signedIn && !now && session.state.expired) api.ui.toast(t('expired'), { variant: 'warning' });
      signedIn = now;
    };

    const session = createSession({ api, client: createClient(api), rules, onChange: paint });

    const signIn = () => {
      details?.close();
      openLogin({
        api,
        t,
        format,
        session,
        onSignedIn: () => api.ui.toast(t('signedIn'), { variant: 'success' }),
      });
    };

    const open = (anchor) => {
      if (!session.state.session) {
        signIn();
        return;
      }
      details.toggle(anchor, buildView(session.state, new Date(), rules));
    };

    bar = createBar({ api, t, format, onOpen: open });
    details = createDetails({
      api,
      t,
      format,
      session,
      onSignOut: async () => {
        await session.signOut();
        api.ui.toast(t('signedOut'));
      },
      onSettings: () => api.app.openMod(api.id),
      onToggle: (isOpen) => bar.setExpanded(isOpen),
    });
    api.onDispose(() => details.close());

    api.helpers.mount(SLOT, BAR_ID, () => bar.element, { before: BEFORE });
    paint();
    // What was kept, before anything decides whether somebody is signed in.
    await session.load();
    // Switched off while that was being read: nothing more may be started.
    if (disposed) return;
    api.helpers.poll(paint, REPAINT_MS);
    api.helpers.poll(() => { void session.tick(); }, CHECK_MS);

    api.commands.add({
      id: 'open',
      title: t('commandOpen'),
      run: () => open(document.getElementById(BAR_ID)),
    });
    api.commands.add({
      id: 'refresh',
      title: t('commandRefresh'),
      run: () => {
        if (!session.state.session) signIn();
        else void session.refreshNow();
      },
    });
  },
};
