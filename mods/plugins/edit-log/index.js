/**
 * Edit Log — what a message said before it was changed.
 *
 * Slack lets anybody rewrite or remove what they said, and leaves no trace of
 * either: an edited message carries a small "(edited)" and nothing that says
 * what it used to be, and a deleted one simply is not there any more. This
 * keeps both, for the conversations you have open, on this machine.
 *
 * **It only knows what your client drew.** There is no history endpoint behind
 * this and no request of any kind: it reads the messages on screen every second
 * and a half and compares them with what they said last time. A message edited
 * while you were in another channel was never on your screen, so it is not
 * here, and the mod says so rather than pretending to be a record.
 *
 * **It writes nothing anywhere but your own settings file.** The log lives in
 * `~/.betterslack/settings.json` under this plugin, capped, and the dialog can
 * empty it. Nothing is sent to Slack or to anyone else.
 *
 * The judgement -- is this an edit, a deletion, or Slack re-rendering -- is in
 * `watch.js`, away from the DOM, because that is the part that has to be right
 * and the part worth a test.
 */

import { STRINGS } from './strings.js';
import { addToLog, createWatcher } from './watch.js';

const ICON = `<svg viewBox="0 0 20 20" aria-hidden="true">
  <path fill="currentColor" fill-rule="evenodd" d="M10 2.75a7.25 7.25 0 1 0 7.19 8.16.75.75 0 1 0-1.49-.19A5.75 5.75 0 1 1 10 4.25c1.6 0 3.04.65 4.08 1.7l-1.36.02a.75.75 0 0 0 .02 1.5l3.1-.05a.75.75 0 0 0 .74-.76l-.05-3.1a.75.75 0 0 0-1.5.03l.02 1.2A7.22 7.22 0 0 0 10 2.75Z" clip-rule="evenodd"/>
  <path fill="currentColor" d="M10.75 6.5a.75.75 0 0 0-1.5 0V10c0 .2.08.39.22.53l2.25 2.25a.75.75 0 1 0 1.06-1.06l-2.03-2.03V6.5Z"/>
</svg>`;

/** Demo Mode rewrites every name and every message on screen. See below. */
const DEMO_ON = 'betterslack-demo-on';

/**
 * How often the screen is read.
 *
 * A poll rather than a MutationObserver, deliberately. The message list is the
 * most re-rendered container in the client, and this mod also puts a node back
 * into it -- an observer that reacts to Slack's own re-render by touching the
 * list is exactly the shape that has frozen this renderer before. A timer
 * cannot loop, and `helpers.poll` stops it while the window is hidden, where
 * Slack draws nothing anyway.
 */
const SWEEP_MS = 1500;

const CSS_CLASS = 'betterslack-editlog';

export default {
  /**
   * @param {import('../../../src/runtime/api.js').PluginApi} api
   */
  start(api) {
    const t = api.i18n.strings(STRINGS);
    const { message: MESSAGE, messageText: TEXT } = api.slack.selectors;

    const keep = Math.max(20, Number(api.settings.get('keep', 200)) || 200);
    const recordDeletions = api.settings.get('deletions', true) !== false;
    const showDeleted = api.settings.get('showDeleted', true) !== false;

    const watcher = createWatcher();
    /** Headstones on screen, keyed the way `watch.js` keys a message. */
    const headstones = new Map();
    /** Ones you dismissed: still in the log, never put back on screen. */
    const dismissed = new Set();

    api.css(`
      .${CSS_CLASS}-stone {
        display: flex; align-items: flex-start; gap: 8px;
        margin: 2px 0; padding: 4px 20px 4px 56px;
        font-size: 15px; line-height: 1.46668;
        color: var(--dt_color-content-sec, #ababad);
        border-left: 3px solid var(--dt_color-content-imp, #c01343);
      }
      .${CSS_CLASS}-stone__text { flex: 1 1 auto; min-width: 0; text-decoration: line-through; word-break: break-word; }
      .${CSS_CLASS}-stone__tag {
        flex: 0 0 auto; font-size: 11px; font-weight: 700; text-transform: uppercase;
        letter-spacing: .4px; color: var(--dt_color-content-imp, #c01343); padding-top: 3px;
      }
      .${CSS_CLASS}-stone__close {
        flex: 0 0 auto; background: none; border: 0; cursor: pointer; padding: 0 2px;
        color: var(--dt_color-content-sec, #ababad); font-size: 15px; line-height: 1.4;
      }
      .${CSS_CLASS}-stone__close:hover { color: var(--dt_color-content-pry, #d1d2d3); }

      .${CSS_CLASS}-list { display: flex; flex-direction: column; gap: 14px; max-height: 60vh; overflow-y: auto; }
      .${CSS_CLASS}-entry {
        border: 1px solid var(--dt_color-otl-sec, rgba(94, 93, 96, .35));
        border-radius: 8px; padding: 10px 12px;
      }
      .${CSS_CLASS}-entry__head {
        display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;
        font-size: 13px; color: var(--dt_color-content-sec, #ababad); margin-bottom: 8px;
      }
      .${CSS_CLASS}-entry__who { font-weight: 700; color: var(--dt_color-content-pry, #d1d2d3); }
      .${CSS_CLASS}-entry__kind {
        font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .4px;
        color: var(--dt_color-content-imp, #c01343);
      }
      .${CSS_CLASS}-entry__kind--edited { color: var(--dt_color-content-hgl-1, #1d9bd1); }
      .${CSS_CLASS}-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .4px;
        color: var(--dt_color-content-sec, #ababad); margin: 6px 0 2px; }
      .${CSS_CLASS}-text { white-space: pre-wrap; word-break: break-word; font-size: 14px; }
      .${CSS_CLASS}-text--before { text-decoration: line-through; color: var(--dt_color-content-sec, #ababad); }
      .${CSS_CLASS}-actions { display: flex; gap: 8px; margin-top: 10px; }
      .${CSS_CLASS}-note { font-size: 13px; color: var(--dt_color-content-sec, #ababad); }
    `);

    // --------------------------------------------------------------- reading

    /**
     * Everything on screen, in the order Slack drew it.
     *
     * Null while Demo Mode is on: it replaces every name and every message on
     * screen with invented ones, so reading then would fill the log with words
     * nobody wrote and mark every message on screen as edited twice over --
     * once when the sweep starts and once when it is switched off again.
     */
    const read = () => {
      if (document.documentElement.classList.contains(DEMO_ON)) return null;
      const out = [];
      for (const element of document.querySelectorAll(MESSAGE)) {
        const channelId = element.getAttribute('data-msg-channel-id');
        const ts = element.getAttribute('data-msg-ts');
        if (!channelId || !ts) continue;
        const body = element.querySelector(TEXT);
        // A join notice or a bare file card has no message text to compare.
        if (!body) continue;
        out.push({
          key: `${channelId}:${ts}`,
          channelId,
          ts,
          text: (body.textContent ?? '').trim(),
          // Slack draws no avatar on a follow-up message from the same person,
          // so this is null for plenty of them. An absent author is shown as
          // one rather than guessed from the message above.
          userId: api.slack.userIdFromMessage(api.slack.describeMessage(element)),
        });
      }
      return out;
    };

    /** The channel you are looking at, by name, so the log reads as prose. */
    const channelNameNow = () => document.querySelector('[data-qa="channel_name"]')?.textContent?.trim() ?? null;

    // ----------------------------------------------------------- the headstone

    /**
     * The message left where it was, struck through.
     *
     * Put back by the sweep rather than by `helpers.mount`: mounting installs an
     * observer per node, and one per deleted message inside the list Slack
     * re-renders most is a great many observers reacting to each other. The
     * trade is honest -- a re-render can take a headstone away for up to a
     * second and a half before the next sweep puts it back -- and the failure
     * mode is a flicker rather than a wedged renderer.
     */
    const buildStone = (entry) => {
      const close = api.dom.h('button', {
        class: `${CSS_CLASS}-stone__close`,
        type: 'button',
        'aria-label': t('close'),
        title: t('close'),
      }, ['×']);
      close.addEventListener('click', () => {
        dismissed.add(`${entry.channelId}:${entry.ts}`);
        headstones.get(`${entry.channelId}:${entry.ts}`)?.remove();
        headstones.delete(`${entry.channelId}:${entry.ts}`);
      });
      return api.dom.h('div', { class: `${CSS_CLASS}-stone` }, [
        api.dom.h('span', { class: `${CSS_CLASS}-stone__tag` }, [t('deleted')]),
        api.dom.h('span', { class: `${CSS_CLASS}-stone__text` }, [entry.before]),
        close,
      ]);
    };

    /**
     * Keep every headstone where its message was, and only while it can be.
     *
     * The anchor is the message that came after it, matched on both the channel
     * and the timestamp: a bare `data-msg-ts` would match the same second in
     * another conversation. When that anchor is not drawn -- you scrolled away,
     * or changed channel -- the headstone comes off rather than drifting to the
     * end of whatever list is on screen.
     */
    const placeStones = (log) => {
      if (!showDeleted) return;
      const wanted = new Map();
      for (const entry of log) {
        if (entry.kind !== 'deleted' || !entry.nextTs) continue;
        const key = `${entry.channelId}:${entry.ts}`;
        if (dismissed.has(key)) continue;
        if (!wanted.has(key)) wanted.set(key, entry);
      }

      for (const [key, node] of headstones) {
        if (!wanted.has(key)) { node.remove(); headstones.delete(key); }
      }

      for (const [key, entry] of wanted) {
        const anchor = document.querySelector(
          `${MESSAGE}[data-msg-channel-id="${CSS.escape(entry.channelId)}"][data-msg-ts="${CSS.escape(entry.nextTs)}"]`,
        );
        const existing = headstones.get(key);
        if (!anchor) {
          if (existing) { existing.remove(); headstones.delete(key); }
          continue;
        }
        if (existing?.isConnected && existing.nextElementSibling === anchor) continue;
        existing?.remove();
        const node = buildStone(entry);
        anchor.before(node);
        headstones.set(key, node);
      }
    };

    // ------------------------------------------------------------- the sweep

    const readLog = () => {
      const stored = api.settings.get('entries', []);
      return Array.isArray(stored) ? stored : [];
    };

    let log = readLog();
    /** When the dialog was last opened, so the badge counts what is new. */
    let openedAt = Number(api.settings.get('openedAt', 0)) || 0;
    let refreshDialog = null;

    const save = api.helpers.debounce(() => { void api.settings.set('entries', log); }, 400);

    api.helpers.poll(() => {
      const readings = read();
      if (!readings) return;

      const changes = watcher.sweep(readings)
        .filter((change) => recordDeletions || change.kind !== 'deleted');

      if (changes.length > 0) {
        const channel = channelNameNow();
        const here = api.slack.currentChannelId();
        const named = changes.map((change) => ({
          ...change,
          // The name only when we are certain it is the one on screen; the id
          // is honest where a thread view mixes several channels together.
          channelName: channel && change.channelId === here ? channel : null,
        }));
        log = addToLog(log, named, keep, Date.now());
        save();
        refreshDialog?.();
      }

      placeStones(log);
    }, SWEEP_MS);

    // ------------------------------------------------------------ the dialog

    /** Names for the ids in the log, in one request, cached per workspace. */
    const namesFor = async (entries) => {
      const ids = [...new Set(entries.map((entry) => entry.userId).filter(Boolean))];
      if (ids.length === 0 || !api.slack.web.available) return new Map();
      try {
        const users = await api.slack.web.users(ids);
        return new Map([...users].map(([id, user]) => [
          id,
          user?.profile?.display_name || user?.real_name || user?.name || id,
        ]));
      } catch {
        return new Map();
      }
    };

    const when = (at) => new Date(at).toLocaleString(api.i18n.locale, {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });

    const entryNode = (entry, names, close) => {
      const who = entry.userId ? (names.get(entry.userId) ?? entry.userId) : t('someone');
      const where = entry.channelName ?? entry.channelId;

      const head = api.dom.h('div', { class: `${CSS_CLASS}-entry__head` }, [
        api.dom.h('span', {
          class: `${CSS_CLASS}-entry__kind${entry.kind === 'edited' ? ` ${CSS_CLASS}-entry__kind--edited` : ''}`,
        }, [t(entry.kind)]),
        api.dom.h('span', { class: `${CSS_CLASS}-entry__who` }, [who]),
        api.dom.h('span', {}, [t('inChannel', { channel: where })]),
        api.dom.h('span', {}, ['·', ' ', when(entry.at)]),
      ]);

      const body = api.dom.h('div', {}, [
        api.dom.h('div', { class: `${CSS_CLASS}-label` }, [t('before')]),
        api.dom.h('div', { class: `${CSS_CLASS}-text ${CSS_CLASS}-text--before` }, [entry.before]),
      ]);
      if (entry.kind === 'edited') {
        body.append(
          api.dom.h('div', { class: `${CSS_CLASS}-label` }, [t('after')]),
          api.dom.h('div', { class: `${CSS_CLASS}-text` }, [entry.after ?? '']),
        );
      } else {
        body.append(api.dom.h('div', { class: `${CSS_CLASS}-note` }, [t('deletedNote')]));
      }

      const copy = api.dom.h('button', {
        class: 'c-button c-button--outline c-button--small',
        type: 'button',
      }, [t('copy')]);
      copy.addEventListener('click', () => void api.helpers.copy(entry.before, t('copied')));

      const actions = api.dom.h('div', { class: `${CSS_CLASS}-actions` }, [copy]);
      // An edited message is still there to be looked at; a deleted one is not,
      // and a button that lands on nothing is worse than no button.
      if (entry.kind === 'edited') {
        const jump = api.dom.h('button', {
          class: 'c-button c-button--outline c-button--small',
          type: 'button',
        }, [t('jump')]);
        jump.addEventListener('click', () => {
          close();
          api.slack.openMessage(entry.channelId, entry.ts);
        });
        actions.append(jump);
      }

      return api.dom.h('div', { class: `${CSS_CLASS}-entry` }, [head, body, actions]);
    };

    const open = async () => {
      openedAt = Date.now();
      void api.settings.set('openedAt', openedAt);

      const list = api.dom.h('div', { class: `${CSS_CLASS}-list` });
      const box = { close: () => {} };

      const draw = async () => {
        if (log.length === 0) {
          list.replaceChildren(
            api.dom.h('div', { class: `${CSS_CLASS}-note` }, [t('empty')]),
            api.dom.h('div', { class: `${CSS_CLASS}-note` }, [t('emptyHint')]),
          );
          return;
        }
        const names = await namesFor(log);
        if (!list.isConnected) return;
        list.replaceChildren(...log.map((entry) => entryNode(entry, names, () => box.close())));
      };

      const handle = api.ui.modal({
        title: t('title'),
        subtitle: t('subtitle'),
        width: 620,
        content: list,
        actions: [
          {
            label: t('clear'),
            onClick: async () => {
              const sure = await api.ui.confirm({
                title: t('clearTitle'),
                message: t('clearBody', { count: log.length }),
                confirmLabel: t('clear'),
                danger: true,
              });
              if (!sure) return false;
              log = [];
              await api.settings.set('entries', log);
              for (const [key, node] of headstones) { node.remove(); headstones.delete(key); }
              api.ui.toast(t('cleared'), { variant: 'success' });
              // Kept open, showing the empty state: closing the dialog on the
              // way out reads as the button having done something else.
              void draw();
              return false;
            },
            variant: 'danger',
          },
          { label: t('close'), variant: 'primary' },
        ],
      });
      box.close = () => handle.close();

      refreshDialog = () => { if (handle.body.isConnected) void draw(); };
      await draw();
    };

    // ------------------------------------------------------------- the chrome

    api.slack.addToolbarButton('channelHeader', {
      id: 'log',
      label: t('button'),
      description: t('buttonHint'),
      icon: ICON,
      onClick: () => void open(),
    });

    // What arrived since you last looked. Nothing to see means no badge at all,
    // rather than a zero sitting on the button for ever.
    api.helpers.badge('[data-qa="betterslack_edit-log_log"]', 'new',
      () => log.filter((entry) => entry.at > openedAt).length || null);

    api.commands.add({
      id: 'open',
      title: t('title'),
      subtitle: t('commandSubtitle'),
      icon: '🕘',
      run: () => void open(),
    });
  },
};
