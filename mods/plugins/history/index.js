/**
 * History — everything Slack changes and never tells you about.
 *
 * A message rewritten, a message deleted, a reaction taken back, a channel or a
 * section renamed, somebody changing their display name or their status,
 * somebody joining or leaving: Slack does all of it silently, and the only
 * person who notices is the one looking for something that is not where it was.
 * This keeps all of it, for the conversations you have open, on this machine,
 * and puts it on one page you can search and sort.
 *
 * **It only knows what your client drew.** There is no history endpoint behind
 * this: it reads the screen every second and a half and compares it with what
 * it read last time. Something that changed while you were in another channel
 * was never on your screen, so it is not here, and the page says so rather than
 * pretending to be a record.
 *
 * **It writes nothing anywhere but your own settings file.** The log lives in
 * `~/.betterslack/settings.json` under this plugin, capped, and the page can
 * empty it. The only requests it makes are the ones that turn a user id into a
 * name, through `api.slack.web`, which is cached per workspace.
 *
 * The judgement -- is this a change, or Slack re-rendering -- lives in
 * `watch-messages.js` and `watch-names.js`, away from the DOM, because that is
 * the part that has to be right and the part worth a test.
 */

import { createView } from './view.js';
import { STRINGS } from './strings.js';
import { add, tally, view } from './store.js';
import { createMessageWatcher, reactionChanges } from './watch-messages.js';
import { createNameWatcher, displayNameChanges, rosterChanges, statusChanges } from './watch-names.js';

const ICON = `<svg viewBox="0 0 20 20" aria-hidden="true" fill="none">
  <path d="M10 3.2a6.8 6.8 0 1 1-6.6 8.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  <path d="M3.4 7.6 3.2 4.4M3.4 7.6l3.2-.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M10 6.8V10l2.3 2.3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

/** Demo Mode rewrites every name and every message on screen. See `read`. */
const DEMO_ON = 'betterslack-demo-on';

/**
 * How often the screen is read.
 *
 * A poll rather than a MutationObserver, deliberately. The message list is the
 * most re-rendered container in the client, and this mod also puts a node back
 * into it -- an observer that reacts to Slack's own re-render by touching that
 * list is exactly the shape that has frozen this renderer before. A timer
 * cannot loop, and `helpers.poll` stops it while the window is hidden, where
 * Slack draws nothing anyway.
 */
const SWEEP_MS = 1500;

/** People change their status in minutes, not seconds, and every ask is a request. */
const PEOPLE_MS = 5 * 60 * 1000;
/** How many of the people you have seen are asked about. */
const PEOPLE_LIMIT = 60;

export default {
  /**
   * @param {import('../../../src/runtime/api.js').PluginApi} api
   */
  start(api) {
    const t = api.i18n.strings(STRINGS);
    const { message: MESSAGE, messageText: TEXT, channelSidebar: SIDEBAR } = api.slack.selectors;

    const keep = Math.max(50, Number(api.settings.get('keep', 500)) || 500);
    const showDeleted = api.settings.get('showDeleted', true) !== false;
    const watchPeople = api.settings.get('people', true) !== false;

    api.css(api.assets.text('view.css'));

    const messages = createMessageWatcher();
    const names = createNameWatcher();
    /** Members per channel, so a join is a difference and not a parsed sentence. */
    const roster = new Map();
    /** Statuses per person, the same way, and what each of them is called. */
    const statuses = new Map();
    const people = new Map();
    /** Everyone this client has drawn, newest last, for the slow people sweep. */
    const peopleSeen = [];

    /** Headstones on screen, keyed the way the watcher keys a message. */
    const headstones = new Map();
    /** Ones you dismissed: still in the log, never put back on screen. */
    const dismissed = new Set();

    let log = (() => {
      const stored = api.settings.get('entries', []);
      return Array.isArray(stored) ? stored : [];
    })();
    let openedAt = Number(api.settings.get('openedAt', 0)) || 0;

    const save = api.helpers.debounce(() => { void api.settings.set('entries', log); }, 400);

    // ------------------------------------------------------------------ page

    /** The workspace's custom emoji, asked for once and kept. */
    let customEmoji = null;

    /**
     * Who a row is about: the name, the face and the status.
     *
     * One request for the whole page through `web.users`, which is batched and
     * cached per workspace, and the status through the same answer -- a row
     * that looks like a message wants what a message shows.
     */
    const peopleFor = async (rows) => {
      const ids = [...new Set(rows.map((entry) => entry.userId).filter(Boolean))].slice(0, 200);
      if (ids.length === 0 || !api.slack.web.available) return new Map();
      try {
        if (!customEmoji) customEmoji = await api.slack.web.emoji().catch(() => new Map());
        const users = await api.slack.web.users(ids);
        return new Map([...users].map(([id, user]) => [id, {
          name: displayName(user) ?? id,
          /*
           * `avatarUrl` rewrites the `<base>-<size>` shape a message's avatar
           * has, and answers null for anything else -- a profile's `image_72`
           * ends in `.png`, so it comes back null and every row drew a coloured
           * square instead of a face. It is already the URL, so it is used as
           * it is where the rewrite declines.
           */
          avatar: (() => {
            const url = user?.profile?.image_72 ?? user?.profile?.image_48 ?? null;
            return api.slack.avatarUrl(url, 72) ?? url;
          })(),
          status: api.slack.describeStatus(user, customEmoji),
          profile: user?.profile ?? null,
        }]));
      } catch {
        return new Map();
      }
    };

    const page = createView(api, t, {
      icon: ICON,
      onOpen: () => markSeen(),
      onClose: () => markSeen(),
      getLog: () => log,
      view,
      tally,
      peopleFor,
      /*
       * The picture for a shortcode, for entries recorded before the picture
       * was kept beside the name. `:raised_hands::skin-tone-2:` is two names
       * run together, and only the first is an emoji anything can draw -- the
       * tone is lost, which is a better row than the raw shortcode was.
       */
      emojiUrl: (shortcode) => {
        const base = String(shortcode ?? '').replace(/^:|:$/g, '').split('::')[0];
        if (!base) return null;
        try { return api.slack.emojiUrl(base, customEmoji ?? undefined); } catch { return null; }
      },
      openConversation: (channelId) => api.slack.openConversation(channelId),
      openMessage: (channelId, ts) => api.slack.openMessage(channelId, ts),
      clear: async () => {
        log = [];
        await api.settings.set('entries', log);
        for (const [key, node] of headstones) { node.remove(); headstones.delete(key); }
      },
    });

    /*
     * Seen is seen, however you got here.
     *
     * Stamped from the view's own `onOpen` rather than from a function the
     * shortcut and the command happen to share: clicking the tab in Slack's
     * rail goes straight through `addView` and never touched this, so the
     * count sat on the tab after you had read every line of it. Stamped on the
     * way out as well, so anything that arrives while you are looking at it is
     * not waiting for you when you close it.
     */
    const markSeen = () => {
      openedAt = Date.now();
      void api.settings.set('openedAt', openedAt);
    };
    const open = () => page.open();

    // --------------------------------------------------------------- reading

    /**
     * Everything on screen, in the order Slack drew it.
     *
     * Null while Demo Mode is on: it replaces every name and every message on
     * screen with invented ones, so reading then would fill the log with words
     * nobody wrote and mark everything on screen as changed twice over -- once
     * when it starts and once when it is switched off again.
     */
    const readMessages = () => {
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
          who: senderName(element),
          reactions: readReactions(element),
        });
      }
      return out;
    };

    /**
     * The reaction tally on one message: emoji to count.
     *
     * Slack says *who* reacted only in a tooltip it builds when you hover, in
     * the reader's language and with names rather than ids, so the count is
     * what can be known honestly. `data-stringify-emoji` is the shortcode,
     * which is the same name whatever the reader's language is.
     */
    const readReactions = (element) => {
      const out = {};
      for (const pill of element.querySelectorAll('[data-qa="reactji"]')) {
        const drawn = pill.querySelector('[data-stringify-emoji]');
        const emoji = drawn?.getAttribute('data-stringify-emoji');
        const count = Number(pill.querySelector('.c-reaction__count')?.textContent?.trim());
        if (!emoji || !Number.isFinite(count)) continue;
        /*
         * The picture, taken from the screen rather than built from the name.
         *
         * A shortcode is not always one name: a reaction with a skin tone is
         * `:raised_hands::skin-tone-2:`, two of them run together, and a custom
         * emoji is a name only this workspace knows. Slack has already resolved
         * both into an `<img>`, so the honest source of the picture is the
         * picture. Printed as its shortcode instead, the row read
         * `:raised_hands::skin-tone-2:`, which is a rendering that failed.
         */
        out[emoji] = { count, url: drawn.tagName === 'IMG' ? drawn.src : (drawn.querySelector('img')?.src ?? null) };
      }
      return out;
    };

    /** Every name on screen, with what it names. */
    const readNames = () => {
      const out = [];
      const channelId = api.slack.currentChannelId();
      const channelName = document.querySelector('[data-qa="channel_name"]')?.textContent?.trim();
      if (channelId && channelName) out.push({ scope: 'channel', key: channelId, name: channelName });

      // Sections are named by the person who made them, and the heading is the
      // only place that name is written down.
      const sections = document.querySelectorAll(`${SIDEBAR} .p-channel_sidebar__section_heading`);
      for (const [index, heading] of [...sections].entries()) {
        out.push({ scope: 'section', key: String(index), name: heading.textContent?.trim() ?? '' });
      }

      return out;
    };

    // ----------------------------------------------------------- the headstone

    const buildStone = (entry) => {
      const key = `${entry.channelId}:${entry.ts}`;
      const close = api.dom.h('button', {
        class: 'bsh-stone__close',
        type: 'button',
        'aria-label': t('dismiss'),
        title: t('dismiss'),
      }, ['×']);
      close.addEventListener('click', () => {
        dismissed.add(key);
        headstones.get(key)?.remove();
        headstones.delete(key);
      });
      return api.dom.h('div', { class: 'bsh-stone' }, [
        api.dom.h('span', { class: 'bsh-stone__tag' }, [t('deleted')]),
        api.dom.h('span', { class: 'bsh-stone__text' }, [entry.before]),
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
    const placeStones = () => {
      if (!showDeleted) return;
      const wanted = new Map();
      for (const entry of log) {
        if (entry.kind !== 'deleted' || !entry.nextTs) continue;
        const key = `${entry.channelId}:${entry.ts}`;
        if (dismissed.has(key) || wanted.has(key)) continue;
        wanted.set(key, entry);
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

    // ------------------------------------------------------------- the sweeps

    const record = (events) => {
      if (events.length === 0) return;
      const channelName = document.querySelector('[data-qa="channel_name"]')?.textContent?.trim() ?? null;
      const here = api.slack.currentChannelId();
      log = add(log, events.map((event) => ({
        ...event,
        // The name only where we are certain it is the one on screen; the id is
        // honest where a thread view mixes several channels together.
        channelName: event.channelName
          ?? (channelName && event.channelId === here ? channelName : null),
      })), keep, Date.now());
      save();
      page.refresh();
    };

    api.helpers.poll(() => {
      if (document.documentElement.classList.contains(DEMO_ON)) return;
      record([...messages.sweep(readMessages()), ...names.sweep(readNames())]);
      placeStones();

      for (const element of document.querySelectorAll(MESSAGE)) {
        const id = api.slack.userIdFromMessage(api.slack.describeMessage(element));
        if (id && !peopleSeen.includes(id)) peopleSeen.push(id);
      }
      if (peopleSeen.length > PEOPLE_LIMIT * 4) peopleSeen.splice(0, peopleSeen.length - PEOPLE_LIMIT * 4);
    }, SWEEP_MS);

    /**
     * Who is in the conversation, and what people's statuses are.
     *
     * Slowly, and on its own timer: both are requests, both change in minutes
     * rather than seconds, and `api.slack.web` holds its answers for a minute
     * anyway. A join is the difference between two member lists rather than a
     * notice parsed out of the reader's language.
     */
    if (watchPeople) {
      api.helpers.poll(async () => {
        if (!api.slack.web.available) return;
        if (document.documentElement.classList.contains(DEMO_ON)) return;

        const channelId = api.slack.currentChannelId();
        if (channelId) {
          try {
            const members = await api.slack.web.call('conversations.members', { channel: channelId, limit: 500 });
            const ids = Array.isArray(members?.members) ? members.members : null;
            if (ids) {
              const channelName = document.querySelector('[data-qa="channel_name"]')?.textContent?.trim() ?? null;
              record(rosterChanges(channelId, channelName, roster.get(channelId), ids));
              roster.set(channelId, ids);
            }
          } catch {
            // A conversation this token cannot list is not a failure worth
            // saying anything about: it simply has no roster to compare.
          }
        }

        const ids = [...new Set(peopleSeen)].slice(-PEOPLE_LIMIT);
        if (ids.length === 0) return;
        try {
          const users = await api.slack.web.users(ids);
          const status = new Map([...users].map(([id, user]) => [id, user?.profile?.status_text ?? '']));
          const called = new Map([...users].map(([id, user]) => [id, displayName(user) ?? '']));
          record([
            ...statusChanges(statuses, status).map((event) => ({
              ...event,
              who: displayName(users.get(event.userId)) ?? null,
            })),
            ...displayNameChanges(people, called),
          ]);
          for (const [id, value] of status) statuses.set(id, value);
          for (const [id, value] of called) people.set(id, value);
        } catch {
          // Same: an answer that did not arrive is not a change.
        }
      }, PEOPLE_MS);
    }

    // ------------------------------------------------------------- the chrome

    /**
     * What arrived since you last looked, on the tab in Slack's rail.
     *
     * Not everything, by default. A workspace of any size renames a section,
     * greets somebody and changes a status all day, and a tab wearing a
     * permanent number is a tab nobody reads -- the count means something only
     * while it is rare. So it is the three that are somebody taking something
     * back: an edit, a deletion, a reaction removed. The setting opens it up
     * or closes it entirely.
     */
    const BADGE_KINDS = {
      changes: ['edited', 'deleted', 'reaction-removed'],
      messages: ['edited', 'deleted'],
      all: null,
      none: [],
    };
    const badgeKinds = BADGE_KINDS[api.settings.get('badgeFor', 'changes')] ?? BADGE_KINDS.changes;

    api.helpers.badge(page.tabSelector, 'new', () => {
      if (badgeKinds !== null && badgeKinds.length === 0) return null;
      const since = log.filter((entry) => entry.at > openedAt
        && (badgeKinds === null || badgeKinds.includes(entry.kind)));
      return since.length || null;
    });

    api.helpers.hotkey(api.settings.get('shortcut', 'mod+shift+h'), () => {
      if (page.isOpen()) page.close();
      else open();
    });

    api.commands.add({
      id: 'open',
      title: t('title'),
      subtitle: t('buttonHint'),
      icon: '🕘',
      run: () => open(),
    });
  },
};

/**
 * The sender's name as drawn, cleaned of the copy Slack draws for screen
 * readers.
 *
 * Measured in a live client: `[data-qa="message_sender"]` holds the name twice
 * on some messages -- "Ada LovelaceAda Lovelace :" -- and once on others. This
 * is only a label on a row, never a value anything is compared against (see
 * `watch-names.js`), but a label that reads as a stutter is still wrong.
 */
function senderName(element) {
  const raw = (element.querySelector('.c-message__sender_button')
    ?? element.querySelector('[data-qa="message_sender"]'))?.textContent ?? '';
  const text = raw.replace(/\s+/g, ' ').replace(/\s*:\s*$/, '').trim();
  if (!text) return null;
  const half = text.length / 2;
  if (text.length % 2 === 0 && text.slice(0, half) === text.slice(half)) return text.slice(0, half);
  return text;
}

/** The name a person would recognise, in the order Slack's own client prefers. */
function displayName(user) {
  if (!user) return null;
  return user.profile?.display_name || user.real_name || user.name || null;
}

export { reactionChanges };
