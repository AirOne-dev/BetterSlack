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
import { add, tally, view, without } from './store.js';
import { createMessageWatcher, reactionChanges } from './watch-messages.js';
import { createNameWatcher, displayNameChanges, rosterChanges, statusChanges } from './watch-names.js';
import { catchUp, snapshotOf } from './catch-up.js';
import { harvest, merge, namesFor } from './emoji.js';

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

/**
 * How far back a catch-up looks when you open a channel.
 *
 * One page of `conversations.history`. Further back costs another request and
 * answers about messages nobody is going to scroll to; a message older than
 * this that changed while you were away is not caught, and the mod says so
 * rather than pretending otherwise.
 */
const CATCH_UP_LIMIT = 60;
/** Channels whose last state is remembered. Each one is a page of text. */
const CATCH_UP_CHANNELS = 8;
/** The floor between two "who reacted" questions about the same channel. */
const ASK_MS = 8000;

/** People change their status in minutes, not seconds, and every ask is a request. */
const PEOPLE_MS = 5 * 60 * 1000;
/** How many of the people you have seen are asked about. */
const PEOPLE_LIMIT = 60;

/**
 * What `stop()` has to undo.
 *
 * The headstones are the only thing this mod leaves inside Slack's own markup,
 * and the runtime's cleanup does not know about them: it takes back the
 * stylesheet, the poll and the tab, so a headstone left behind would sit in the
 * conversation as an unstyled sentence with nothing able to remove it.
 */
let sweepUp = null;

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
    /*
     * What each channel looked like when you last left it.
     *
     * Through `helpers.cache`, which is bounded by key and persisted, so this
     * survives a restart -- the whole point is the day you were not looking --
     * without letting the loader's settings file grow without limit.
     */
    const snapshots = api.helpers.cache('snapshots', { keys: CATCH_UP_CHANNELS });

    /*
     * The name-to-picture table, built out of Slack's own screen.
     *
     * A shortcode cannot be drawn from its name -- Slack serves a standard
     * emoji by codepoint -- so the pairs are collected from whatever the client
     * has drawn and kept. An emoji seen once in Slack is one this can draw for
     * ever after.
     */
    let emojiTable = api.settings.get('emoji', {});
    if (!emojiTable || typeof emojiTable !== 'object') emojiTable = {};
    const saveEmoji = api.helpers.debounce(() => { void api.settings.set('emoji', emojiTable); }, 2000);
    const emojiFor = (shortcode) => {
      for (const name of namesFor(shortcode)) {
        if (emojiTable[name]) return emojiTable[name];
        try {
          const found = api.slack.emojiUrl(name, customEmoji ?? undefined);
          if (found) return found;
        } catch { /* a name nothing knows is not an error */ }
      }
      return null;
    };
    /** Channel ids to names, as the log learns them, so `<#C…>` reads as one. */
    const channelNames = new Map();

    /**
     * Somebody's message, as Slack would have drawn it.
     *
     * What the API answers with is not what Slack shows: a mention arrives as
     * `<@U04ED8UPV>`, a link as `<https://…|https://…>`, an ampersand as
     * `&amp;`. Left alone, a log of messages is a log of wire format. The
     * renderer is the runtime's, so this reads a message exactly as the
     * command palette does.
     *
     * The full address rather than the host: a row in a list has eighty
     * characters and a message here has the width of the page, and a link
     * pasted on its own is usually the point of the message.
     */
    const drawText = (text, people) => api.slack.renderMrkdwn(text, {
      userName: (id) => people?.get(id)?.name ?? null,
      channelName: (id) => channelNames.get(id) ?? null,
      emojiUrl: (name) => emojiFor(name),
      onChannel: (id) => { page.close(); api.slack.openConversation(id); },
    });

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
      if (!Array.isArray(stored)) return [];
      /*
       * Rows written before a reaction could be attributed.
       *
       * An emoji, a count and "somebody" -- which is what reading the screen
       * can know and is not worth a line. They cannot be repaired either:
       * Slack answers about the reactions on a message now, never about who
       * was on one yesterday. So they go on the way in.
       */
      return stored.filter((entry) => (entry?.kind !== 'reaction-added' && entry?.kind !== 'reaction-removed')
        || entry.userId || entry.who);
    })();
    let openedAt = Number(api.settings.get('openedAt', 0)) || 0;
    // Every channel the log has already named, so a `<#C…>` in a message read
    // today is drawn as a name even in a channel this session never opened.
    for (const entry of log) {
      if (entry.channelId && entry.channelName) channelNames.set(entry.channelId, entry.channelName);
    }

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
      /*
       * Both people, not one.
       *
       * `userId` is who did the thing and `subjectUser` is who wrote the
       * message it was done to, and a card is headed by the second. Asking
       * only about the first left every card whose author had not also reacted
       * headed by a raw `U04F0LX84H0`.
       */
      /*
       * And whoever is mentioned inside the words.
       *
       * `<@U04ED8UPV>` is a person the row draws just as much as its author
       * is, and asking only about the two on the entry left every mention in
       * every message reading as a raw id.
       */
      const mentioned = rows.flatMap((entry) => [...String(
        [entry.subject, entry.before, entry.after].filter(Boolean).join(' '),
      ).matchAll(/<@([UWB][A-Z0-9]+)(?:\|[^>]*)?>/g)].map((match) => match[1]));
      const ids = [...new Set([
        ...rows.flatMap((entry) => [entry.userId, entry.subjectUser]),
        ...mentioned,
      ].filter(Boolean))].slice(0, 200);
      if (ids.length === 0 || !api.slack.web.available) return new Map();
      try {
        if (!customEmoji) customEmoji = await api.slack.web.emoji().catch(() => new Map());
        const users = await api.slack.web.users(ids);
        return new Map([...users].map(([id, user]) => [id, {
          name: displayName(user) ?? id,
          avatar: avatarOf(api, user),
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
      emojiUrl: emojiFor,
      renderText: (text, people) => drawText(text, people),
      openConversation: (channelId) => api.slack.openConversation(channelId),
      openMessage: (channelId, ts) => api.slack.openMessage(channelId, ts),
      forget: async (card) => {
        log = without(log, card);
        await api.settings.set('entries', log);
        // A headstone belongs to an entry: forgetting the entry takes it off
        // the conversation too, or the line stays there with nothing behind it.
        for (const [key, node] of headstones) {
          if (!log.some((entry) => `${entry.channelId}:${entry.ts}` === key)) {
            node.remove();
            headstones.delete(key);
          }
        }
        page.refresh();
      },
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
          text: textOf(body),
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
     * What a message says, with its emoji written down rather than dropped.
     *
     * `textContent` loses every emoji: Slack draws them as `<img>`, and an
     * image has no text. So the body is walked and each one contributes its
     * shortcode -- which is what `conversations.history` sends too, so the two
     * halves of this mod describe a message the same way.
     */
    const textOf = (body) => {
      const parts = [];
      const walk = (node) => {
        if (node.nodeType === Node.TEXT_NODE) { parts.push(node.nodeValue ?? ''); return; }
        const name = node.getAttribute?.('data-stringify-emoji');
        if (name) { parts.push(`:${String(name).replace(/^:|:$/g, '')}:`); return; }
        for (const child of node.childNodes) walk(child);
      };
      walk(body);
      return parts.join('').trim();
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

    /**
     * Faces and names for the headstones, fetched once and kept.
     *
     * A deletion caught by the screen knows the author's id off the avatar and
     * usually their name; one caught by the catch-up knows only the id, since
     * `conversations.history` sends `user` and nothing else. Either way the
     * line has to look like the message it replaces, so the answer is the same
     * batched, per-workspace-cached `users.info` the page uses.
     *
     * A name that never arrives leaves the id, never a blank: the point of the
     * line is whose words are gone.
     */
    const faces = new Map();
    let fetchingFaces = false;
    const wantFaces = (ids) => {
      const missing = [...new Set(ids)].filter((id) => id && !faces.has(id));
      if (missing.length === 0 || fetchingFaces || !api.slack.web.available) return;
      fetchingFaces = true;
      void api.slack.web.users(missing)
        .then((users) => {
          for (const id of missing) {
            const user = users.get(id);
            faces.set(id, user ? { name: displayName(user) ?? id, avatar: avatarOf(api, user) } : null);
          }
          // Drawn already, with what was known then. Draw them again now that
          // there is a face, rather than leaving the first answer on screen.
          placeStones(true);
        })
        .catch(() => { for (const id of missing) faces.set(id, null); })
        .finally(() => { fetchingFaces = false; });
    };

    /**
     * The line left where a deleted message was.
     *
     * **It wears Slack's own message markup.** Not because it is convenient:
     * a theme styles the client through those class names, so anything drawn
     * inside a conversation with markup of its own is the one thing on screen
     * the theme cannot reach -- Discord's rounds every avatar through
     * `.c-message_kit__avatar img`, and a square face in a column of circles
     * reads as broken rather than as a mod. The gutter, the avatar and the
     * sender are Slack's; what is this mod's own is the tag and the struck
     * text, and those carry classes of their own.
     *
     * `data-qa` is deliberately *not* copied. That is what every mod here
     * matches messages on, this one included, so a headstone wearing it would
     * be read back as a message -- swept, compared, and eventually reported as
     * deleted when it came off the screen.
     *
     * It is dimmer and smaller than the message it replaces all the same: a
     * note about something gone, not a message pretending to still be there.
     */
    const buildStone = (entry) => {
      const key = `${entry.channelId}:${entry.ts}`;
      const face = faces.get(entry.userId ?? '') ?? null;
      const who = face?.name ?? entry.who ?? entry.userId ?? t('someone');

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

      // Slack's avatar is a button wrapping a sized container wrapping the
      // image, and a theme's rule reaches for the image inside it.
      const avatar = api.dom.h('span', { class: 'c-message_kit__avatar c-avatar bsh-stone__avatar' }, [
        api.dom.h('span', { class: 'c-base_icon__width_only_container' }, [
          face?.avatar
            ? api.dom.h('img', {
              class: 'c-base_icon c-base_icon--image',
              src: face.avatar,
              alt: '',
              loading: 'lazy',
            })
            : api.dom.h('span', { class: 'c-base_icon bsh-stone__avatar--none' }),
        ]),
      ]);

      // The message's own text, with its mentions, links and emoji drawn.
      const text = api.dom.h('span', { class: 'bsh-stone__text' }, []);
      text.append(drawText(entry.before ?? '', faces));

      return api.dom.h('div', {
        class: 'bsh-stone c-message_kit__background c-message_kit__message',
      }, [
        api.dom.h('div', { class: 'c-message_kit__gutter' }, [
          api.dom.h('div', { class: 'c-message_kit__gutter__left' }, [avatar]),
          api.dom.h('div', { class: 'c-message_kit__gutter__right bsh-stone__body' }, [
            api.dom.h('div', { class: 'bsh-stone__head' }, [
              api.dom.h('span', { class: 'c-message__sender c-message_kit__sender bsh-stone__who' }, [who]),
              api.dom.h('span', { class: 'bsh-stone__tag' }, [t('deleted')]),
            ]),
            text,
          ]),
          close,
        ]),
      ]);
    };

    /**
     * The message a headstone hangs off, and which side of it to sit on.
     *
     * Worked out from what is drawn now rather than from the neighbours the
     * deletion was recorded with. Those were written from the screen at the
     * moment the message went, and a stored neighbour cannot be corrected
     * afterwards -- while a timestamp is exactly what Slack orders a
     * conversation by, so the two messages a gap sits between can be found
     * again every time, from whatever the client happens to have drawn.
     *
     * The message that came after is the anchor, and the line goes above it:
     * that is where the message was. A message deleted from the end of a
     * conversation has nothing after it, so it hangs under the one before
     * instead -- but only then, because a window scrolled away from the bottom
     * has a newest drawn message that is not the newest message, and hanging
     * the line under that one would put it in the middle of the conversation.
     *
     * Timestamps compare as text: every one is ten digits, a dot and six, so
     * that is exact where comparing them as numbers is at the edge of what a
     * double holds.
     */
    const anchorFor = (entry) => {
      let newer = null;
      let older = null;
      for (const node of document.querySelectorAll(
        `${MESSAGE}[data-msg-channel-id="${CSS.escape(entry.channelId)}"]`,
      )) {
        const ts = node.getAttribute('data-msg-ts');
        if (!ts) continue;
        if (ts > entry.ts) { if (!newer || ts < newer.ts) newer = { node, ts }; }
        else if (ts < entry.ts) { if (!older || ts > older.ts) older = { node, ts }; }
      }
      if (newer) return { node: newer.node, after: false };
      // Recorded as having had something after it, so its place is above a
      // message this window is not showing. A stored neighbour older than the
      // message itself is not one: it says nothing about what followed.
      const hadNext = Boolean(entry.nextTs) && entry.nextTs > entry.ts;
      if (!hadNext && older) return { node: older.node, after: true };
      return null;
    };

    /**
     * Keep every headstone where its message was, and only while it can be.
     *
     * When the anchor is not drawn -- you scrolled away, or changed channel --
     * the headstone comes off rather than drifting to the end of whatever list
     * is on screen.
     */
    const placeStones = (redraw = false) => {
      /*
       * A headstone in the document that this instance did not put there is
       * one from a previous life of the plugin -- switched off and on, or hot
       * reloaded while Slack kept running -- and nothing else will ever remove
       * it. Two lines where one message was is worse than none.
       */
      const mine = new Set(headstones.values());
      for (const node of document.querySelectorAll('.bsh-stone')) {
        if (!mine.has(node)) node.remove();
      }
      if (!showDeleted) return;
      const wanted = new Map();
      for (const entry of log) {
        if (entry.kind !== 'deleted' || (!entry.nextTs && !entry.previousTs)) continue;
        const key = `${entry.channelId}:${entry.ts}`;
        if (dismissed.has(key) || wanted.has(key)) continue;
        wanted.set(key, entry);
      }
      wantFaces([...wanted.values()].flatMap((entry) => [
        entry.userId,
        // And whoever the message mentioned, so the line reads as it read.
        ...[...String(entry.before ?? '').matchAll(/<@([UWB][A-Z0-9]+)(?:\|[^>]*)?>/g)].map((m) => m[1]),
      ]));

      for (const [key, node] of headstones) {
        if (!wanted.has(key)) { node.remove(); headstones.delete(key); }
      }

      for (const [key, entry] of wanted) {
        const anchor = anchorFor(entry);
        const existing = headstones.get(key);
        if (!anchor) {
          if (existing) { existing.remove(); headstones.delete(key); }
          continue;
        }
        const placed = anchor.after
          ? existing?.previousElementSibling === anchor.node
          : existing?.nextElementSibling === anchor.node;
        if (!redraw && existing?.isConnected && placed) continue;
        existing?.remove();
        const node = buildStone(entry);
        if (anchor.after) anchor.node.after(node);
        else anchor.node.before(node);
        headstones.set(key, node);
      }
    };

    // ------------------------------------------------------------- the sweeps

    const record = (events) => {
      if (events.length === 0) return;
      const channelName = document.querySelector('[data-qa="channel_name"]')?.textContent?.trim() ?? null;
      const here = api.slack.currentChannelId();
      if (here && channelName) channelNames.set(here, channelName);
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

    /**
     * What happened in this channel while you were somewhere else.
     *
     * Reading the screen can only ever know what your client drew, which is the
     * first thing anybody notices about this mod: a message edited in a channel
     * you were not in was never in front of you. `conversations.history` is
     * asked once per channel you open, compared against what it looked like
     * when you left, and the difference is written down -- including who took a
     * reaction back, which Slack says here and nowhere the screen can read.
     *
     * The first visit to a channel is the baseline and never an event, or
     * opening a busy channel would write a hundred rows about things that
     * happened before this mod existed.
     */
    let catchingUp = false;
    /** Channels asked for while one was already in flight, so none is dropped. */
    const queued = new Set();
    const catchUpOn = async (channelId) => {
      if (!channelId || !api.slack.web.available) return;
      if (document.documentElement.classList.contains(DEMO_ON)) return;
      if (catchingUp) { queued.add(channelId); return; }
      catchingUp = true;
      try {
        const answer = await api.slack.web.call('conversations.history', {
          channel: channelId,
          limit: CATCH_UP_LIMIT,
        });
        const list = Array.isArray(answer?.messages) ? answer.messages : [];
        if (list.length === 0) return;
        const channelName = document.querySelector('[data-qa="channel_name"]')?.textContent?.trim() ?? null;
        record(catchUp(snapshots.get(channelId) ?? null, list, { channelId, channelName }));
        snapshots.set(channelId, snapshotOf(list));
      } catch {
        // A conversation this token cannot read is not a failure worth saying
        // anything about: it simply has no history to compare.
      } finally {
        catchingUp = false;
        const [next] = queued;
        if (next) { queued.delete(next); void catchUpOn(next); }
      }
    };

    /**
     * Channels where a reaction moved and nobody has been named yet.
     *
     * Asked at a floor rather than on the sweep that noticed: a busy channel
     * would otherwise be a request every second and a half, against a rate
     * limit shared with Slack's own client. Nothing is lost by waiting -- the
     * snapshot only moves when the answer arrives, so a second reaction landing
     * in the meantime is in the same diff.
     */
    const wantsAsking = new Set();
    const askedAt = new Map();
    const askWhoReacted = () => {
      const now = Date.now();
      for (const channelId of [...wantsAsking]) {
        if (now - (askedAt.get(channelId) ?? 0) < ASK_MS) continue;
        wantsAsking.delete(channelId);
        askedAt.set(channelId, now);
        void catchUpOn(channelId);
      }
    };

    /** The channel the last sweep saw, so opening another one triggers a look. */
    let lastChannel = null;

    api.helpers.poll(() => {
      const here = api.slack.currentChannelId();
      if (here && here !== lastChannel) {
        lastChannel = here;
        void catchUpOn(here);
      }

      if (document.documentElement.classList.contains(DEMO_ON)) return;
      const drawn = harvest(document);
      if (Object.keys(drawn).length) {
        const next = merge(emojiTable, drawn);
        if (Object.keys(next).length !== Object.keys(emojiTable).length) saveEmoji();
        emojiTable = next;
      }

      /*
       * A reaction seen on screen is a question, not an answer.
       *
       * Slack draws a count and names nobody -- who reacted is in a tooltip it
       * builds on hover, in the reader's language, with names rather than ids.
       * So a row written from the screen could only ever say "somebody", which
       * is the one thing a history is no use for: knowing something was taken
       * back and not by whom is worse than not knowing at all.
       *
       * `conversations.history` does name them, so a count moving is what
       * sends this to ask. The answer is diffed against the snapshot from the
       * last look and recorded there, with the person on it. Nothing is
       * written from the sighting itself.
       */
      const seen = messages.sweep(readMessages());
      const changes = [];
      for (const change of seen) {
        if (change.kind === 'reaction-added' || change.kind === 'reaction-removed') {
          if (change.channelId) wantsAsking.add(change.channelId);
          continue;
        }
        changes.push(change);
      }
      record([...changes, ...names.sweep(readNames())]);
      askWhoReacted();
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

    sweepUp = () => {
      for (const [key, node] of headstones) { node.remove(); headstones.delete(key); }
    };
  },

  stop() {
    sweepUp?.();
    sweepUp = null;
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

/**
 * Somebody's face, at the size a row draws it.
 *
 * `avatarUrl` rewrites the `<base>-<size>` shape a message's avatar has and
 * answers null for anything else -- a profile's `image_72` ends in `.png`, so
 * it comes back null and every row drew a coloured square instead of a face.
 * It is already a URL, so it is used as it is where the rewrite declines.
 */
function avatarOf(api, user) {
  const url = user?.profile?.image_72 ?? user?.profile?.image_48 ?? null;
  return api.slack.avatarUrl(url, 72) ?? url;
}

/** The name a person would recognise, in the order Slack's own client prefers. */
function displayName(user) {
  if (!user) return null;
  return user.profile?.display_name || user.real_name || user.name || null;
}

export { reactionChanges };
