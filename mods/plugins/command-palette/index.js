// Slack's quick switcher, with everything else in it too.
//
// This takes ⌘K, which Slack binds to its own switcher, and that is only
// defensible if it can do what Slack's does. So it does: the conversations you
// are in, the people you talk to, and the same in-place navigation Slack uses
// (its deep links, which move the client without a reload). On top of that it
// carries what Slack has no idea about -- every BetterSlack action, every
// command a mod registered, and every mod in the catalogue, installed or not.
//
// It is a plugin rather than part of the app on purpose. Taking a key that
// belongs to Slack should be something you switch on, and switch off again if
// you disagree -- and the whole thing is then an example of what a mod can do
// with the API rather than a special case wired into the core.
//
// What it deliberately does not do: search messages. That is a real search over
// data this cannot page through, and Slack's own search field does it properly
// one keystroke away. Offering a worse copy in a list that otherwise navigates
// instantly would make the list less trustworthy.

import { STRINGS } from './strings.js';

/** Conversations to hold in memory. Slack's own switcher shows far fewer. */
const CONVERSATION_LIMIT = 200;

export default {
  async start(api) {
    const t = api.i18n.strings(STRINGS);
    const shortcut = api.settings.get('shortcut', 'mod+k');

    /** Conversations and people, read once and refreshed while the palette is closed. */
    let conversations = [];
    let loaded = 0;

    /**
     * What Slack's switcher lists: the conversations you are in.
     *
     * `users.conversations` answers with every kind in one call -- channels,
     * groups, group DMs and direct messages -- and the direct ones carry a user
     * id rather than a name, so those are resolved through the API's cached
     * directory. Failing here is not fatal: the palette still has everything
     * BetterSlack knows, which is the half Slack cannot offer.
     */
    const loadConversations = async () => {
      if (!api.slack.web.available) return;
      if (Date.now() - loaded < 60_000) return;
      loaded = Date.now();

      try {
        const res = await api.slack.web.call('users.conversations', {
          types: 'public_channel,private_channel,mpim,im',
          exclude_archived: true,
          limit: CONVERSATION_LIMIT,
        });
        const channels = Array.isArray(res.channels) ? res.channels : [];

        const directIds = channels.filter((c) => c.is_im && c.user).map((c) => c.user);
        const people = directIds.length ? await api.slack.web.users(directIds) : new Map();

        conversations = channels.map((channel) => {
          if (channel.is_im) {
            const user = people.get(channel.user);
            const profile = user?.profile ?? {};
            const name = profile.display_name || profile.real_name || user?.name || channel.user;
            return {
              id: channel.id,
              title: name,
              kind: 'dm',
              // Their face, which is the whole reason a list of people is
              // scannable at all. 48 is what Slack itself serves the sidebar.
              icon: profile.image_48 || profile.image_72 || profile.image_192 || '',
              hint: profile.title || profile.status_text || '',
            };
          }
          return {
            id: channel.id,
            title: channel.name,
            kind: 'channel',
            icon: channel.is_private ? '🔒' : '#',
            hint: channel.purpose?.value || channel.topic?.value || '',
          };
        });
      } catch (err) {
        api.log.warn('could not list conversations:', err.message);
      }
    };

    /** Everything, in the order someone would want it. */
    const entries = () => {
      const list = [];

      // Slack's own job first: this replaced its switcher, so what its switcher
      // did has to be what this does first.
      for (const conversation of conversations) {
        list.push({
          id: `slack:${conversation.id}`,
          title: conversation.title,
          section: t('sectionSlack'),
          icon: conversation.icon,
          source: t(conversation.kind === 'dm' ? 'directMessage' : 'channel'),
          subtitle: conversation.hint || undefined,
          run: () => api.slack.openConversation(conversation.id),
        });
      }

      // Then what mods offered themselves, and BetterSlack's own doors.
      for (const command of api.app.commands()) {
        list.push({ ...command, section: t('sectionCommands'), icon: command.icon ?? '⌘' });
      }
      list.push(
        { id: 'panel', title: t('openPanel'), section: t('sectionCommands'), icon: '⌘', source: 'BetterSlack', run: () => api.app.openPanel() },
        { id: 'themes', title: t('browseThemes'), section: t('sectionCommands'), icon: '🎨', source: 'BetterSlack', run: () => api.app.openPanel('themes') },
        { id: 'plugins', title: t('browsePlugins'), section: t('sectionCommands'), icon: '🧩', source: 'BetterSlack', run: () => api.app.openPanel('plugins') },
        { id: 'css', title: t('customCss'), section: t('sectionCommands'), icon: '{}', source: 'BetterSlack', run: () => api.app.openPanel('css') },
      );

      // And every mod: a switch for the installed, an install for the rest.
      // The whole catalogue on purpose -- searching a theme by name and being
      // told nothing matches, because it is not installed yet, is what makes
      // people stop opening a palette.
      for (const mod of api.app.mods()) {
        const kind = mod.type === 'theme' ? t('theme') : t('plugin');
        const icon = mod.type === 'theme' ? '🎨' : '🧩';
        list.push(mod.installed
          ? {
            id: `mod:${mod.id}`,
            title: `${mod.enabled ? t('disable') : t('enable')} ${mod.name}`,
            section: t('sectionMods'),
            icon,
            source: kind,
            subtitle: mod.description,
            run: () => void api.app.setEnabled(mod.id, !mod.enabled),
          }
          : {
            id: `install:${mod.id}`,
            title: `${t('install')} ${mod.name}`,
            section: t('sectionCatalogue'),
            icon,
            source: kind,
            subtitle: mod.description,
            run: () => void api.app
              .setInstalled(mod.id, true)
              .then(() => api.app.setEnabled(mod.id, true)),
          });
      }

      return list;
    };

    const open = () => {
      api.ui.palette(entries(), {
        placeholder: t('placeholder'),
        empty: t('empty'),
        openHint: t('hintOpen'),
        closeHint: t('hintClose'),
      });
      // Refreshed behind the open palette rather than before it: a switcher
      // that waits on the network before drawing is a switcher people stop
      // using. The next ⌘K gets the newer list.
      void loadConversations();
    };

    api.helpers.hotkey(shortcut, open);
    api.commands.add({ id: 'open', title: t('command'), subtitle: api.helpers.describeHotkey(shortcut), run: open });

    void loadConversations();
    api.log.info(`ready — ${api.helpers.describeHotkey(shortcut)}`);
  },
};
