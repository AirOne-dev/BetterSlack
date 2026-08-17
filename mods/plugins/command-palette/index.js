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
import { createDirectory } from './directory.js';
import { createActions } from './actions.js';

/** Rows per kind in the everything view, so no one kind buries the others. */
const MIXED_LIMIT = 6;

export default {
  async start(api) {
    const t = api.i18n.strings(STRINGS);
    const shortcut = api.settings.get('shortcut', 'mod+k');

    /** The open palette, so a search that lands late can repaint it. */
    let handle = null;

    const directory = createDirectory(api, {
      onResults: () => handle?.refresh(),
    });
    const actions = createActions(api, t);

    /** Group DMs are not channels, and a heading that says they are misleads. */
    const sectionFor = (entry) => (entry.kind === 'group' ? t('sectionGroups') : t('sectionChannels'));

    /** A conversation or a person, as a row. */
    const asRow = (entry, section) => ({
      id: `slack:${entry.kind}:${entry.id}`,
      title: entry.title,
      section,
      icon: entry.icon,
      source: entry.kind === 'person'
        ? t('directMessage')
        : (entry.kind === 'group' ? t('groupMessage') : t('channel')),
      subtitle: entry.handle && entry.hint ? `${entry.handle} · ${entry.hint}` : entry.handle || entry.hint || undefined,
      // Only what Slack matched server-side: a person found by their email, or
      // by a real name behind a nickname, has none of the query on screen and
      // the client ranking would drop them again. Everything local has already
      // been narrowed by the same query, so it needs no such exemption -- and
      // exempting it was worse than useless: it kept every channel you are in,
      // whatever you typed.
      always: entry.remote === true,
      run: () => (entry.kind === 'person'
        // The DM if there is one, and Slack creates it if there is not, which
        // is what its own switcher does with someone you have never written to.
        ? void api.slack.openDirectMessage(entry.id)
        : api.slack.openConversation(entry.conversationId ?? entry.id)),
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

      if (mode === 'actions') return actions.list(query);
      if (mode === 'people') {
        return directory.people(query).map((entry) => asRow(entry, t('sectionPeople')));
      }
      if (mode === 'channels') {
        return directory.channels(query).map((entry) => asRow(entry, sectionFor(entry)));
      }

      // Everything, in the order someone would want it: where you were going,
      // then who you meant, then what you can do.
      const people = directory.people(query);
      const channels = directory.channels(query);
      const cap = asked ? MIXED_LIMIT : MIXED_LIMIT + 2;
      return [
        ...channels.slice(0, cap).map((entry) => asRow(entry, sectionFor(entry))),
        ...people.slice(0, cap).map((entry) => asRow(entry, t('sectionPeople'))),
        ...actions.list(query),
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
        ],
      });
      // Refreshed behind the open palette rather than before it: a switcher
      // that waits on the network before drawing is a switcher people stop
      // using. The next ⌘K gets the newer list.
      void directory.load().then(() => handle?.refresh());
    };

    api.helpers.hotkey(shortcut, open);
    api.commands.add({ id: 'open', title: t('command'), subtitle: api.helpers.describeHotkey(shortcut), icon: '⌘', run: open });
    api.onDispose(() => directory.dispose());

    void directory.load();
    api.log.info(`ready — ${api.helpers.describeHotkey(shortcut)}`);
  },
};
