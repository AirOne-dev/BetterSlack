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
 * `watch-names.js`, away from the DOM, because that is the part that has to be
 * right and the part worth a test.
 */

import { createView } from './view.js';
import { STRINGS } from './strings.js';
import { add, tally, view, without } from './store.js';
import { createMessageStore } from './messages.js';
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
    const { message: MESSAGE, channelSidebar: SIDEBAR } = api.slack.selectors;

    const keep = Math.max(50, Number(api.settings.get('keep', 500)) || 500);
    const showDeleted = api.settings.get('showDeleted', true) !== false;
    const watchPeople = api.settings.get('people', true) !== false;
    /*
     * What an app does to its own messages.
     *
     * A deploy status moving through its stages, an alert resolving, a bot
     * rewriting the same message six times a minute: every one of those is an
     * edit, and none of them is somebody taking something back. It is the
     * loudest thing on Slack's socket and it fills the log with changes nobody
     * made.
     *
     * Only an app's *own* changes. A person reacting to an alert, or the
     * message arriving in the first place, is not this.
     */
    const watchApps = api.settings.get('apps', false) === true;

    api.css(api.assets.text('view.css'));

    const messages = createMessageStore();
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
    /**
     * Channel ids to names, as the log learns them, so `<#C…>` reads as one.
     *
     * Keyed by workspace as well as by id, because two workspaces can use the
     * same channel id -- and a name is what the reader trusts to know which
     * conversation a card is about.
     */
    const channelNames = new Map();
    const nameKey = (channelId, teamId) => `${teamId ?? api.slack.currentTeamId() ?? '?'}:${channelId}`;
    const nameOfChannel = (channelId, teamId) => channelNames.get(nameKey(channelId, teamId)) ?? null;

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
    /** A time, the way the page writes one. */
    const time = (at) => new Date(at).toLocaleTimeString(api.i18n.locale, { hour: '2-digit', minute: '2-digit' });

    const drawText = (text, people) => api.slack.renderMrkdwn(text, {
      userName: (id) => people?.get(id)?.name ?? null,
      channelName: (id) => nameOfChannel(id),
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
      return stored.filter((entry) => {
        /*
         * Sidebar sections used to be told apart by where they sat in the
         * list, so every reorder -- and every workspace switch, where they are
         * different sections entirely -- was written down as a rename. Not one
         * of the stored ones can be told from a real rename, so the class goes.
         */
        if (entry?.kind === 'section-renamed') return false;
        if (entry?.kind !== 'reaction-added' && entry?.kind !== 'reaction-removed') return true;
        return Boolean(entry.userId || entry.who);
      });
    })();
    let openedAt = Number(api.settings.get('openedAt', 0)) || 0;
    // Every channel the log has already named, so a `<#C…>` in a message read
    // today is drawn as a name even in a channel this session never opened.
    for (const entry of log) {
      if (entry.channelId && entry.channelName) {
        channelNames.set(nameKey(entry.channelId, entry.teamId), entry.channelName);
      }
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

    /** Every name on screen, with what it names. */
    const readNames = () => {
      const out = [];
      const channelId = api.slack.currentChannelId();
      const channelName = document.querySelector('[data-qa="channel_name"]')?.textContent?.trim();
      if (channelId && channelName) out.push({ scope: 'channel', key: channelId, name: channelName });

      /*
       * Sections are named by the person who made them, and the heading is the
       * only place that name is written down.
       *
       * Keyed by Slack's own id for the section, never by where it sits in the
       * list. Measured on a live sidebar: every heading carries
       * `data-qa-channel-sidebar-section-heading` -- `L05HHTHH4H4` for one you
       * made, `channels`, `direct_messages`, `slack_connect`, `recent_apps`
       * for Slack's own. Keyed by position instead, anything that reorders the
       * list reads as a rename: dragging a section, collapsing one, and above
       * all switching workspace, where the sections are different sections
       * entirely and every index lands on somebody else's heading.
       *
       * The team goes in the key as well, so a workspace with more sections
       * than the one you left cannot be read as the same ones renamed.
       */
      const team = api.slack.currentTeamId() ?? '?';
      for (const heading of document.querySelectorAll(`${SIDEBAR} .p-channel_sidebar__section_heading`)) {
        const id = heading.getAttribute('data-qa-channel-sidebar-section-heading');
        // No id is no identity, and a guess at one is what this is fixing.
        if (!id) continue;
        out.push({ scope: 'section', key: `${team}:${id}`, name: heading.textContent?.trim() ?? '' });
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
      /*
       * Nothing newer is drawn, so hanging it under the newest that is only
       * works if that really was the end of the conversation.
       *
       * The screen watcher records `nextTs` as null when there was nothing
       * after it, which is the deletion this covers. A stored neighbour *older*
       * than the message itself says nothing about what followed -- it is a
       * remembered order that was wrong -- and neither does a deletion Slack's
       * socket reported, which names no neighbours at all. Both are treated as
       * "unknown, and the bottom is the best guess", which is right unless the
       * window is scrolled away from the bottom.
       */
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
        // Every deletion, including one Slack's socket reported with no
        // neighbours at all: where it goes is worked out from the screen. It
        // still needs to say which conversation it was in, which is what the
        // line is hung off.
        if (entry.kind !== 'deleted' || !entry.channelId || !entry.ts) continue;
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

      /*
       * A message that is on screen was never deleted.
       *
       * Whatever wrote that entry was wrong -- and one of them was: working a
       * deletion out from the screen turned every edit into a deletion, since
       * Slack takes the message out of the document while you type. The line
       * it draws then sits beside the message it claims is gone, with the same
       * words in it, which reads as the message having been posted twice.
       *
       * Provably wrong is worth more than not drawn: the entry is on the page
       * as well, saying the same untrue thing. So it goes, rather than being
       * quietly skipped here and left there.
       */
      const wrong = [...wanted.values()].filter((entry) => document.querySelector(
        `${MESSAGE}[data-msg-channel-id="${CSS.escape(entry.channelId)}"][data-msg-ts="${CSS.escape(entry.ts)}"]`,
      ));
      if (wrong.length > 0) {
        const bad = new Set(wrong.map((entry) => entry.id));
        log = log.filter((entry) => !bad.has(entry.id));
        for (const entry of wrong) {
          const key = `${entry.channelId}:${entry.ts}`;
          wanted.delete(key);
          headstones.get(key)?.remove();
          headstones.delete(key);
        }
        save();
        page.refresh();
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
      if (here && channelName) channelNames.set(nameKey(here), channelName);
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

        /*
         * The same check, for the whole page rather than for what is drawn.
         *
         * A message this answer still carries was never deleted, whatever the
         * log says -- and this reaches the ones you would have to scroll to,
         * which the screen never shows.
         */
        const alive = new Set(list.map((message) => message?.ts).filter(Boolean));
        const wrong = log.filter((entry) => entry.kind === 'deleted'
          && entry.channelId === channelId && alive.has(entry.ts));
        if (wrong.length > 0) {
          const bad = new Set(wrong.map((entry) => entry.id));
          log = log.filter((entry) => !bad.has(entry.id));
          save();
          page.refresh();
        }
        const channelName = document.querySelector('[data-qa="channel_name"]')?.textContent?.trim() ?? null;
        record(catchUp(snapshots.get(channelId) ?? null, list, { channelId, channelName }, { apps: watchApps }));
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

    /*
     * Everything Slack tells this client, for every conversation it is in.
     *
     * This is what makes the mod work in a channel you have not opened. The
     * screen only ever knew what was drawn, and the catch-up only ever knew
     * the channels you visited; Slack's own socket carries a message, an edit,
     * a deletion and a reaction for every conversation you are a member of,
     * open or not, in every workspace you are signed into.
     *
     * **Nothing is marked read by any of it.** Slack marks a conversation read
     * when its client sends `conversations.mark`; being told a message exists
     * sends nothing. That is the difference between this and the obvious
     * alternative of opening conversations to look at them, which would empty
     * every unread badge you have.
     *
     * The screen and the catch-up stay. They are what covers the case this
     * cannot: a conversation you are *not* in, and anything that happened
     * while Slack was closed.
     */
    /*
     * Which conversation a socket event was about.
     *
     * The workspace travels with it: the event names the socket it arrived on,
     * and two workspaces can use the same channel id, so an entry that only
     * said `C0BQ8AG3771` could not be told apart from another workspace's.
     */
    const where = (channelId, teamId) => ({
      channelId,
      teamId: teamId ?? null,
      channelName: nameOfChannel(channelId, teamId),
    });

    const events = api.slack.events;

    // A message, remembered rather than recorded. Nobody wants "somebody said
    // something" in a history, and it is the only thing that can say what a
    // message said before it is edited or deleted in a channel this client
    // never drew.
    events.onMessage((message) => {
      messages.remember(`${message.channelId}:${message.ts}`, message.text, message.userId, message.botId);
    });

    events.onMessageChanged((edit) => {
      if (edit.botId && !watchApps) return;
      record([{
        kind: 'edited',
        ...where(edit.channelId, edit.teamId),
        ts: edit.ts,
        before: edit.before,
        after: edit.after,
        subject: edit.after,
        userId: edit.userId,
        subjectUser: edit.userId,
      }]);
    });

    events.onMessageDeleted((gone) => {
      // An app removing its own message is the same non-event as an app
      // rewriting one, and Slack names the app on the message it deleted.
      if ((gone.botId ?? messages.appFor(`${gone.channelId}:${gone.ts}`)) && !watchApps) return;
      // Slack sends `previous_message` with a deletion, so the words are its
      // own account of them. What it does not send is what the message said
      // when the client never received the frame that carried it -- an app
      // restarted since, most often -- and there the fallback is what this
      // client happened to hear.
      const said = gone.text || messages.textFor(`${gone.channelId}:${gone.ts}`) || '';
      if (!said) return;
      record([{
        kind: 'deleted',
        ...where(gone.channelId, gone.teamId),
        ts: gone.ts,
        before: said,
        subject: said,
        userId: gone.userId,
        subjectUser: gone.userId,
      }]);
    });

    events.onReaction((reaction) => record([{
      kind: reaction.added ? 'reaction-added' : 'reaction-removed',
      ...where(reaction.channelId, reaction.teamId),
      ts: reaction.ts,
      emoji: `:${reaction.emoji}:`,
      userId: reaction.userId,
    }]));

    /*
     * Somebody arriving or leaving, said outright.
     *
     * The slow sweep works this out by comparing two member lists, which is
     * one request per channel and only for the channel you are looking at.
     * Slack says it for every conversation you are in, the moment it happens.
     * Both are kept: the sweep is what catches somebody who left while Slack
     * was closed, and the log writes an event once however many halves saw it.
     */
    events.onMembership((change) => record([{
      kind: change.joined ? 'joined' : 'left',
      ...where(change.channelId, change.teamId),
      userId: change.userId,
    }]));

    /*
     * A channel renamed, which Slack never tells you about.
     *
     * The event carries the new name and not the old one, so the first sighting
     * seeds and never reports -- the same rule every watcher here follows.
     */
    events.onConversation((change) => {
      if (change.kind !== 'renamed' || !change.name) return;
      const was = nameOfChannel(change.channelId, change.teamId);
      channelNames.set(nameKey(change.channelId, change.teamId), change.name);
      if (!was || was === change.name) return;
      record([{
        kind: 'channel-renamed',
        channelId: change.channelId,
        teamId: change.teamId ?? null,
        channelName: change.name,
        before: was,
        after: change.name,
      }]);
    });

    /*
     * A name or a status changing, for everybody rather than for the sixty
     * people this client happened to draw.
     *
     * `user_change` carries the profile as Slack now has it and nothing about
     * what it was, so the maps the slow sweep already keeps are what make it a
     * change. Unknown means seeded, never reported: a first sighting is not
     * something that happened.
     */
    events.onUserChanged((change) => {
      const name = displayName(change.user) ?? '';
      const status = String(change.user?.profile?.status_text ?? '');
      const events_ = [];
      const knownName = people.get(change.userId);
      const knownStatus = statuses.get(change.userId);
      if (knownName !== undefined && name && knownName !== name) {
        events_.push({ kind: 'name-changed', userId: change.userId, who: knownName, before: knownName, after: name });
      }
      if (knownStatus !== undefined && knownStatus !== status) {
        events_.push({ kind: 'status-changed', userId: change.userId, who: name || knownName || null, before: knownStatus, after: status });
      }
      people.set(change.userId, name);
      statuses.set(change.userId, status);
      if (events_.length) record(events_);
    });

    /*
     * A different workspace, and everything held about the last one is wrong.
     *
     * The log itself stays -- it names the workspace's channels and is the
     * whole point of the mod -- but nothing that is a *reading* of the
     * workspace survives: the members of a channel, what somebody was called,
     * the faces, the emoji table, and the snapshot of what a channel looked
     * like. Two workspaces can use the same channel id, so a roster kept
     * across a switch is compared against the wrong one and reads as everybody
     * leaving and a different everybody arriving.
     *
     * The message watcher goes too. It holds what is on screen, and the screen
     * is about to be replaced wholesale.
     */
    api.slack.onTeamChange(() => {
      roster.clear();
      statuses.clear();
      people.clear();
      faces.clear();
      peopleSeen.length = 0;
      messages.forget();
      names.forget();
      customEmoji = null;
      lastChannel = null;
      for (const [key, node] of headstones) { node.remove(); headstones.delete(key); }
      page.refresh();
    });

    /*
     * Every wording a message has had, in the conversation itself.
     *
     * Slack writes "(edited)" and shows you the current wording; what it
     * replaced is gone. The log has it, and a page you have to go and open is
     * the wrong place to answer "what did that say before" -- the question is
     * asked while looking at the message.
     *
     * A chain rather than a list of changes: an edit is a pair, so the
     * wordings are the first `before` followed by every `after`. Two edits of
     * one message share a wording, and printing that twice would read as an
     * edit that changed nothing.
     */
    const wordingsOf = (channelId, ts) => {
      const edits = log
        .filter((entry) => entry.kind === 'edited' && entry.channelId === channelId && entry.ts === ts)
        .sort((a, b) => a.at - b.at);
      if (edits.length === 0) return [];
      const chain = [
        // The first wording is the one that was posted, so its time is the
        // message's own -- which `ts` is, in seconds. Every row then carries a
        // real time, and two wordings a minute apart read as a minute apart
        // rather than as the same thing written twice.
        { text: edits[0].before, at: Number(String(ts).split('.')[0]) * 1000 },
        ...edits.map((edit) => ({ text: edit.after, at: edit.at })),
      ];
      // Two wordings running that say the same thing read as an edit that
      // changed nothing. One entry cannot produce that; two halves both
      // catching the same edit can.
      return chain.filter((wording, index) => index === 0 || wording.text !== chain[index - 1].text);
    };

    /**
     * Slack's own "(edited)", turned into the way in.
     *
     * Slack already marks an edited message and already puts the mark exactly
     * where the question is asked -- it just does not answer it. So the label
     * becomes the control rather than a button being added beside three of
     * Slack's own, and what it opens unfolds under the message instead of over
     * it: a dialog would cover the conversation the wording belongs to.
     *
     * Only where there is something to show. Slack marks every edit, including
     * ones made before this mod was installed, and a control that opens an
     * empty panel is worse than a label that never looked like one.
     *
     * Decorated from the poll rather than from an observer. This is the list
     * Slack re-renders most, and an observer that reacts to Slack's own
     * re-render by putting a node back into that list is the shape that has
     * frozen this renderer before. Slack replacing the label is what undoes
     * the decoration, and the next sweep is what puts it back.
     */
    const EDITED_LABEL = '.c-message__edited_label';
    /** Which messages have their wordings unfolded, so a re-render keeps them. */
    const unfolded = new Set();
    /** The panels on screen, keyed the way everything here is keyed. */
    const panels = new Map();

    /*
     * A time and what it said, on one line each.
     *
     * The wordings of one message are usually a few words apart, so anything
     * that separates them -- a heading, a rule, a label saying which is
     * current -- makes two nearly identical lines look like the same line
     * printed twice. Side by side under a time, they read as a sequence, and
     * the only mark left is that the wording on screen now is at full
     * strength while what it replaced is not.
     */
    const wordingsNode = (wordings, people) => {
      const list = api.dom.h('div', { class: 'bsh-wordings' });
      for (const [index, wording] of wordings.entries()) {
        const last = index === wordings.length - 1;
        const words = api.dom.h('div', { class: 'bsh-wording__text' }, []);
        words.append(drawText(wording.text, people));
        list.append(api.dom.h('div', { class: `bsh-wording${last ? ' bsh-wording--now' : ''}` }, [
          api.dom.h('span', { class: 'bsh-wording__when bsh-dim' }, [time(wording.at)]),
          words,
        ]));
      }
      return list;
    };

    const foldAway = (key) => {
      panels.get(key)?.remove();
      panels.delete(key);
    };

    const unfold = async (message, channelId, ts) => {
      const key = `${channelId}:${ts}`;
      const wordings = wordingsOf(channelId, ts);
      if (wordings.length < 2) return;
      foldAway(key);
      const panel = api.dom.h('div', { class: 'bsh-fold' }, []);
      // Drawn with what is known, so it opens on the click rather than after a
      // request. The names arrive a moment later and replace it.
      panel.append(wordingsNode(wordings, faces));
      // Under the words, inside the message, which is where "what did this say
      // before" belongs -- and where Slack's own thread and reaction rows go.
      const body = message.querySelector('[data-qa="message-text"]')
        ?? message.querySelector('.p-rich_text_section');
      if (!body) return;
      body.after(panel);
      panels.set(key, panel);

      const people = await peopleFor(log.filter((entry) => entry.channelId === channelId && entry.ts === ts));
      if (panels.get(key) !== panel || !panel.isConnected) return;
      panel.replaceChildren(wordingsNode(wordings, people.size ? people : faces));
    };

    const markEdits = () => {
      const wanted = new Set();
      for (const label of document.querySelectorAll(EDITED_LABEL)) {
        const message = label.closest(MESSAGE);
        const channelId = message?.getAttribute('data-msg-channel-id');
        const ts = message?.getAttribute('data-msg-ts');
        if (!channelId || !ts || wordingsOf(channelId, ts).length < 2) continue;
        const key = `${channelId}:${ts}`;
        wanted.add(key);

        if (!label.hasAttribute('data-betterslack-wordings')) {
          label.setAttribute('data-betterslack-wordings', '');
          label.classList.add('bsh-edited');
          label.setAttribute('role', 'button');
          label.setAttribute('tabindex', '0');
          label.setAttribute('title', t('wordingsHint'));
          const toggle = () => {
            if (unfolded.has(key)) { unfolded.delete(key); foldAway(key); }
            else { unfolded.add(key); void unfold(message, channelId, ts); }
            label.setAttribute('aria-expanded', String(unfolded.has(key)));
          };
          label.addEventListener('click', toggle);
          label.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            toggle();
          });
        }
        label.setAttribute('aria-expanded', String(unfolded.has(key)));
        // Slack re-renders and takes the panel with it; put it back where it
        // was rather than making somebody click twice.
        if (unfolded.has(key) && !panels.get(key)?.isConnected) void unfold(message, channelId, ts);
      }
      // A message that scrolled away takes its panel with it, and keeps its
      // place in `unfolded` so coming back to it opens it again.
      for (const key of [...panels.keys()]) if (!wanted.has(key)) foldAway(key);
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
       * The sidebar's section names, which is all the screen is read for now.
       *
       * Slack pushes messages, edits, deletions, reactions, renames and people
       * down its socket; it says nothing about the sections *you* made in your
       * own sidebar, because they are yours and no other client has them. So
       * the heading is still the only place those names are written down.
       */
      record(names.sweep(readNames()));
      placeStones();
      markEdits();

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
      for (const [key, node] of panels) { node.remove(); panels.delete(key); }
      for (const label of document.querySelectorAll(EDITED_LABEL)) {
        // Slack's own label, put back as Slack's own.
        label.removeAttribute('data-betterslack-wordings');
        label.removeAttribute('aria-expanded');
        label.removeAttribute('role');
        label.removeAttribute('tabindex');
        label.classList.remove('bsh-edited');
      }
    };
  },

  stop() {
    sweepUp?.();
    sweepUp = null;
  },
};

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
