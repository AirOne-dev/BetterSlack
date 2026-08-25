// Slack's quick switcher, with everything else in it too.
//
// This takes ⌘K, which Slack binds to its own switcher, and that is only
// defensible if it can do what Slack's does. So it does: the conversations you
// are in, anyone in the workspace -- through Slack's own search, not just the
// DMs you happen to have open -- and the same in-place navigation Slack uses.
// On top of that it carries what Slack has no idea about: every BetterSlack
// action, every command a mod registered, and every mod in the catalogue,
// installed or not, with its settings one Enter away.
//
// It is a plugin rather than part of the app on purpose. Taking a key that
// belongs to Slack should be something you switch on, and switch off again if
// you disagree -- and the whole thing is then an example of what a mod can do
// with the API rather than a special case wired into the core.
//
// The shape is Raycast's, including the prefixes: `/` for actions, `@` for
// people, `#` for channels. They are shown under an empty list rather than
// documented, because a shortcut nobody is told about is a shortcut nobody
// uses. Typing one turns it into a chip in front of the field, and Backspace
// takes it off again.
//
// What it deliberately does not do: search messages. That is a real search over
// data this cannot page through, and Slack's own search field does it properly
// one keystroke away. Offering a worse copy in a list that otherwise navigates
// instantly would make the list less trustworthy.

import { STRINGS } from './strings.js';
import { openShortcutEditor, parseShortcuts } from './shortcuts.js';
import { createDirectory } from './directory.js';
import { createActions } from './actions.js';
import { createSlackActions } from './slack.js';
import { renderMessage } from './message.js';

/** Rows per kind in the everything view, so no one kind buries the others. */
const MIXED_LIMIT = 6;

/*
 * What a drawn message looks like inside a row.
 *
 * The mod's own, rather than the runtime's: the palette component knows nothing
 * about Slack's markup, and a mod that draws something new brings the rules for
 * drawing it. Everything is `inline` and inherits its size -- a row is one line
 * and a `<code>` or an emoji that changes the line height makes the whole list
 * jump as you type.
 */
const CSS = `
.betterslack-palette .betterslack-emoji {
  width: 1.1em;
  height: 1.1em;
  vertical-align: -0.2em;
  object-fit: contain;
}
.betterslack-palette .betterslack-code {
  font-family: Monaco, Menlo, Consolas, monospace;
  font-size: 0.92em;
  padding: 0 3px;
  border-radius: 3px;
  background: var(--dt_color-base-inv, rgba(255, 255, 255, .08));
  color: var(--dt_color-content-destructive, #e01e5a);
}
.betterslack-palette .betterslack-link { color: var(--dt_color-content-highlight, #1d9bd1); }
.betterslack-palette .betterslack-mention {
  color: var(--dt_color-content-highlight, #1d9bd1);
  background: color-mix(in srgb, var(--dt_color-content-highlight, #1d9bd1) 14%, transparent);
  border-radius: 3px;
  padding: 0 2px;
}
.betterslack-palette .betterslack-palette__title b { font-weight: 700; }
`;

export default {
  async start(api) {
    const t = api.i18n.strings(STRINGS);
    api.css(CSS);
    /*
     * However many the user asked for.
     *
     * The old setting offered a choice of two, which answered the wrong
     * question: the interesting one is not "which of ours" but "which of
     * yours". `shortcut` is still read so an upgrade keeps whatever was
     * chosen back when it was a menu.
     */
    const stored = () => api.settings.get('shortcuts', api.settings.get('shortcut', 'mod+k'));

    /** The open palette, so a search that lands late can repaint it. */
    let handle = null;

    const directory = createDirectory(api, {
      onResults: () => {
        handle?.setBusy(false);
        handle?.refresh();
      },
    });
    const actions = createActions(api, t);
    const slack = createSlackActions(api, t, { directory });
    /** BetterSlack's own rows and Slack's, as one list. */
    const allActions = (query) => [...slack.list(query), ...actions.list(query)];

    /** Group DMs are not channels, and a heading that says they are misleads. */
    const sectionFor = (entry) => (entry.kind === 'group' ? t('sectionGroups') : t('sectionChannels'));

    /** What the message renderer needs, read at draw time rather than cached. */
    const drawContext = () => ({
      doc: document,
      emoji: directory.emoji,
      users: directory.authors,
      emojiUrl: (name, map) => api.slack.emojiUrl?.(name, map) ?? null,
      // Slack's markup is drawn by the runtime, so the palette and History
      // read a mention, a link and an ampersand the same way.
      renderMrkdwn: (text, options) => api.slack.renderMrkdwn(text, options),
    });

    /** When something was said, as short as it can be and still be useful. */
    const said = (ts) => {
      const at = new Date(Number(String(ts).split('.')[0]) * 1000);
      if (Number.isNaN(at.getTime())) return '';
      const today = new Date();
      const sameDay = at.toDateString() === today.toDateString();
      return new Intl.DateTimeFormat(api.i18n.locale, sameDay
        ? { hour: '2-digit', minute: '2-digit' }
        : { day: 'numeric', month: 'short' }).format(at);
    };

    /**
     * Who said it, and where.
     *
     * The face is the row's icon and the name is here, because that is the pair
     * you scan a list of results by -- `erwan.martin` is neither. The status
     * emoji comes along for the same reason it does everywhere else in this
     * palette: it is one glyph and it says whether asking now is a good idea.
     */
    const whoSaidIt = (entry) => {
      const line = document.createElement('span');
      const author = directory.authors.get(entry.authorId);
      const profile = author?.profile ?? {};
      const name = profile.display_name || profile.real_name || author?.name || entry.username;
      if (name) line.append(name);

      const status = author ? api.slack.describeStatus(author, directory.emoji) : null;
      const url = status?.emoji ? api.slack.emojiUrl?.(status.emoji, directory.emoji) : null;
      if (url) {
        const img = document.createElement('img');
        img.className = 'betterslack-emoji';
        img.src = url;
        img.alt = `:${status.emoji}:`;
        if (status.text) img.title = status.text;
        line.append(' ', img);
      }

      const where = entry.channelName ? `#${entry.channelName}` : '';
      for (const part of [where, said(entry.ts)].filter(Boolean)) line.append(` · ${part}`);
      return line;
    };

    /** A message Slack found, as a row that opens it where it was said. */
    const asMessageRow = (entry) => ({
      id: `slack:message:${entry.id}`,
      // The plain reading: what the ranking sorts by and what is announced.
      title: entry.title,
      // And the drawn one, with the bold, the link's label and the emoji in it.
      titleNode: () => renderMessage(entry.message, drawContext()),
      subtitleNode: () => whoSaidIt(entry),
      section: t('sectionMessages'),
      icon: api.slack.avatarUrl(
        directory.authors.get(entry.authorId)?.profile?.image_48, 48,
      ) ?? directory.authors.get(entry.authorId)?.profile?.image_48 ?? (entry.isIm ? '💬' : '#'),
      source: t('message'),
      // Slack matched it; the client ranking reads only what is on screen and
      // would drop a line whose match is in a word the extract cut off.
      always: true,
      run: () => api.slack.openMessage(entry.channelId, entry.ts, { team: entry.team }),
    });

    /**
     * The line under the title: who they are, and what is waiting there.
     *
     * A mention count goes first because it is the part that decides whether
     * you go: "3 mentions" and "someone posted" are different errands.
     */
    const subtitleFor = (entry) => {
      const said = entry.handle && entry.hint
        ? `${entry.handle} · ${entry.hint}`
        : entry.handle || entry.hint || '';
      const waiting = entry.mentions > 0
        ? (entry.mentions === 1 ? t('mention') : t('mentions', { count: entry.mentions }))
        : '';
      return [waiting, said].filter(Boolean).join(' · ') || undefined;
    };

    /** A conversation or a person, as a row. */
    const asRow = (entry, section) => ({
      id: `slack:${entry.kind}:${entry.id}`,
      title: entry.title,
      section,
      icon: entry.icon,
      source: entry.kind === 'person'
        ? t('directMessage')
        : (entry.kind === 'group' ? t('groupMessage') : t('channel')),
      subtitle: subtitleFor(entry),
      // Somebody's Slack status, after their name, the way Slack draws it. The
      // directory resolves the emoji; this only carries it.
      status: entry.status ?? null,
      // Only what Slack matched server-side: a person found by their email, or
      // by a real name behind a nickname, has none of the query on screen and
      // the client ranking would drop them again. Everything local has already
      // been narrowed by the same query, so it needs no such exemption -- and
      // exempting it was worse than useless: it kept every channel you are in,
      // whatever you typed.
      always: entry.remote === true,
      run: () => {
        // Remembered before it is opened: the ordering is what this palette was
        // used for, and the navigation may not come back (a DM Slack has to
        // create first is a round trip that can fail).
        directory.remember(entry);
        return entry.kind === 'person'
          // The DM if there is one, and Slack creates it if there is not, which
          // is what its own switcher does with someone you have never written to.
          ? void api.slack.openDirectMessage(entry.id)
          : api.slack.openConversation(entry.conversationId ?? entry.id);
      },
    });

    /*
     * What the palette shows, for what has been typed.
     *
     * Called on every keystroke and answers synchronously: the local index is
     * already in memory, so the list never waits. `directory.search` is fired
     * alongside and paints again when Slack answers, which is the only part
     * that costs a round trip.
     */
    const provider = (query, mode) => {
      const asked = query.trim().length > 0;
      if (asked) directory.search(query);
      /*
       * Say whether anything is still out, so an empty list can say "looking"
       * rather than "nothing matches" -- two different answers, and the second
       * one was being given for the first. The palette cannot know this: it
       * does not fetch anything, the mod that opened it does.
       */
      handle?.setBusy(directory.searching);

      if (mode === 'actions') return allActions(query);
      if (mode === 'people') {
        return directory.people(query).map((entry) => asRow(entry, t('sectionPeople')));
      }
      if (mode === 'channels') {
        return directory.channels(query).map((entry) => asRow(entry, sectionFor(entry)));
      }
      if (mode === 'messages') return directory.messages(query).map(asMessageRow);

      // Everything, in the order someone would want it: where you were going,
      // then who you meant, then what you can do.
      const people = directory.people(query);
      const channels = directory.channels(query);
      const cap = asked ? MIXED_LIMIT : MIXED_LIMIT + 2;
      /*
       * What is waiting for you, first, and only on an untyped palette.
       *
       * Opening ⌘K without typing is the "where should I be" question, and the
       * honest answer is the conversations with something new in them. Once
       * there is a query it is a search again and the unread ones take no
       * precedence -- you asked for a name, not for your inbox.
       */
      const unread = asked
        ? []
        : [...channels, ...people].filter((entry) => entry.unread).slice(0, cap);
      const isUnread = new Set(unread.map((entry) => entry.id));
      const rest = (list) => list.filter((entry) => !isUnread.has(entry.id));
      return [
        ...unread.map((entry) => asRow(entry, t('sectionUnread'))),
        ...rest(channels).slice(0, cap).map((entry) => asRow(entry, sectionFor(entry))),
        ...rest(people).slice(0, cap).map((entry) => asRow(entry, t('sectionPeople'))),
        /*
         * A way into the messages rather than the messages themselves.
         *
         * Mixed in, a handful of lines of somebody's conversation would crowd
         * out the eight places you were actually going -- and a switcher is for
         * going somewhere. One row that hands over to the mode keeps it
         * findable without paying for it on every keystroke.
         */
        ...(asked && directory.messages(query).length > 0
          ? [{
            id: 'palette:messages',
            title: t('searchMessages', { query: query.trim() }),
            section: t('sectionMessages'),
            icon: '🔎',
            source: t('message'),
            always: true,
            keepOpen: true,
            run: () => handle?.setMode('messages'),
          }]
          : []),
        ...allActions(query),
      ];
    };

    const open = () => {
      handle = api.ui.palette(provider, {
        placeholder: t('placeholder'),
        empty: t('empty'),
        openHint: t('hintOpen'),
        closeHint: t('hintClose'),
        searching: t('searching'),
        modes: [
          { id: 'actions', prefix: '/', label: t('modeActions'), placeholder: t('placeholderActions') },
          { id: 'people', prefix: '@', label: t('modePeople'), placeholder: t('placeholderPeople') },
          { id: 'channels', prefix: '#', label: t('modeChannels'), placeholder: t('placeholderChannels') },
          { id: 'messages', prefix: '>', label: t('modeMessages'), placeholder: t('placeholderMessages') },
        ],
      });
      // Refreshed behind the open palette rather than before it: a switcher
      // that waits on the network before drawing is a switcher people stop
      // using. The next ⌘K gets the newer list.
      void directory.load().then(() => handle?.refresh());
    };

    /** The bindings in force, so they can be swapped without a reload. */
    let bound = [];
    const bindShortcuts = () => {
      for (const off of bound) off();
      const combos = parseShortcuts(stored());
      bound = combos.map((combo) => api.helpers.hotkey(combo, open));
      return combos;
    };
    let combos = bindShortcuts();
    api.onDispose(() => { for (const off of bound) off(); });

    const describe = () => combos.map((combo) => api.helpers.describeHotkey(combo)).join('  ·  ');
    const openCommand = { id: 'open', title: t('command'), subtitle: describe(), icon: '⌘', run: open };
    api.commands.add(openCommand);

    api.commands.add({
      id: 'shortcuts',
      title: t('shortcutsCommand'),
      subtitle: t('shortcutsSubtitle'),
      icon: '⌨️',
      run: () => openShortcutEditor(api, t, {
        current: combos,
        onSave: async (next) => {
          await api.settings.set('shortcuts', next.join(', '));
          combos = bindShortcuts();
          openCommand.subtitle = describe();
          api.ui.toast(t('shortcutsSaved', { list: describe() }), { variant: 'success' });
        },
      }),
    });

    // The panel writes the same key, and a mod that hears about it keeps
    // running rather than being reloaded mid-keystroke.
    api.settings.onChange(() => {
      combos = bindShortcuts();
      openCommand.subtitle = describe();
    });

    api.onDispose(() => directory.dispose());

    void directory.load();
    api.log.info(`ready — ${describe()}`);
  },
};
