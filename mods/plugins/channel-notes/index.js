/**
 * Channel Notes — a private scratchpad per channel.
 *
 * This is also the reference example for the SlackMod API. It uses one of
 * everything and does not contain a single line of CSS:
 *
 *   api.slack.addToolbarButton  a native-looking button in the channel header
 *   api.ui.modal                a dialog with your own content and actions
 *   api.ui.toast                confirmation
 *   api.ui.confirm              a yes/no before destroying something
 *   api.settings                persisted through the loader, per plugin
 *   api.dom.h / onShortcut      element building and a keyboard shortcut
 *
 * Notes live in this plugin's settings, in ~/.slackmod/settings.json. They
 * never touch the network.
 */

const ICON = `<svg viewBox="0 0 20 20" aria-hidden="true">
  <path fill="currentColor" fill-rule="evenodd" d="M5 2.75A1.75 1.75 0 0 0 3.25 4.5v11A1.75 1.75 0 0 0 5 17.25h10a1.75 1.75 0 0 0 1.75-1.75V7.31a1.75 1.75 0 0 0-.51-1.23l-2.82-2.82a1.75 1.75 0 0 0-1.24-.51H5Zm-.25 1.75A.25.25 0 0 1 5 4.25h6.25v2.5c0 .97.78 1.75 1.75 1.75h2.25v7a.25.25 0 0 1-.25.25H5a.25.25 0 0 1-.25-.25v-11Zm8 .31 2.19 2.19H13a.25.25 0 0 1-.25-.25V4.81Z" clip-rule="evenodd"/>
  <path fill="currentColor" d="M6.75 10a.75.75 0 0 1 .75-.75h5a.75.75 0 0 1 0 1.5h-5a.75.75 0 0 1-.75-.75Zm0 3a.75.75 0 0 1 .75-.75h3a.75.75 0 0 1 0 1.5h-3a.75.75 0 0 1-.75-.75Z"/>
</svg>`;

function currentChannelName() {
  const el = document.querySelector('[data-qa="channel_name"]');
  return el?.textContent?.trim() || 'this channel';
}

const STRINGS = {
  en: {
    openChannelFirst: 'Open a channel first',
    placeholder: 'Anything you want to remember about this channel…',
    title: 'Notes — {channel}',
    subtitle: 'Stored on this machine only. Nothing is sent to Slack.',
    clear: 'Clear',
    clearTitle: 'Clear these notes?',
    clearMessage: 'The notes for {channel} will be deleted. This cannot be undone.',
    cleared: 'Notes cleared',
    save: 'Save',
    saved: 'Notes saved',
    button: 'Channel notes',
    buttonHint: 'A private scratchpad for this channel',
  },
  fr: {
    openChannelFirst: 'Ouvrez d’abord un canal',
    placeholder: 'Tout ce que vous voulez retenir sur ce canal…',
    title: 'Notes — {channel}',
    subtitle: 'Conservées sur cette machine uniquement. Rien n’est envoyé à Slack.',
    clear: 'Effacer',
    clearTitle: 'Effacer ces notes ?',
    clearMessage: 'Les notes de {channel} seront supprimées. Cette action est irréversible.',
    cleared: 'Notes effacées',
    save: 'Enregistrer',
    saved: 'Notes enregistrées',
    button: 'Notes du canal',
    buttonHint: 'Un bloc-notes privé pour ce canal',
  },
};

export default {
  /**
   * @param {import('../../../src/runtime/api.js').PluginApi} api
   */
  start(api) {
    const t = api.i18n.strings(STRINGS);
    const notesFor = (channelId) => {
      const all = api.settings.get('notes', {}) ?? {};
      return all[channelId] ?? '';
    };

    const saveNotes = async (channelId, text) => {
      const all = { ...(api.settings.get('notes', {}) ?? {}) };
      if (text.trim() === '') delete all[channelId];
      else all[channelId] = text;
      await api.settings.set('notes', all);
    };

    const open = () => {
      const channelId = api.slack.currentChannelId();
      if (!channelId) {
        api.ui.toast(t('openChannelFirst'), { variant: 'warning' });
        return;
      }

      const textarea = api.dom.h('textarea', {
        rows: '12',
        spellcheck: 'false',
        placeholder: t('placeholder'),
        style:
          'width:100%; resize:vertical; padding:10px; border-radius:8px; font:13px/1.6 inherit;' +
          ' color:inherit; background:var(--dt_color-base-sec, #f8f8f8);' +
          ' border:1px solid var(--dt_color-otl-sec, rgba(94,93,96,.4));',
      });
      textarea.value = notesFor(channelId);

      const handle = api.ui.modal({
        title: t('title', { channel: currentChannelName() }),
        subtitle: t('subtitle'),
        content: textarea,
        width: 560,
        actions: [
          {
            label: t('clear'),
            variant: 'default',
            onClick: async () => {
              if (textarea.value.trim() === '') return false;
              const sure = await api.ui.confirm({
                title: t('clearTitle'),
                message: t('clearMessage', { channel: currentChannelName() }),
                confirmLabel: t('clear'),
                danger: true,
              });
              if (!sure) return false; // keep the modal open
              await saveNotes(channelId, '');
              api.ui.toast(t('cleared'));
              return true;
            },
          },
          {
            label: t('save'),
            variant: 'primary',
            onClick: async () => {
              await saveNotes(channelId, textarea.value);
              api.ui.toast(t('saved'), { variant: 'success' });
            },
          },
        ],
      });

      queueMicrotask(() => textarea.focus());
      return handle;
    };

    api.slack.addToolbarButton('channelHeader', {
      id: 'notes',
      label: t('button'),
      description: t('buttonHint'),
      icon: ICON,
      onClick: open,
    });

    api.helpers.hotkey('mod+shift+n', open);
  },

  stop() {},
};
