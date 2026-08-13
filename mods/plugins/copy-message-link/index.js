/**
 * Copy Message Link
 *
 * Slack already has "Copy link", two clicks deep in the overflow menu. This
 * puts it in the hover row.
 *
 * Also the shortest mod in the repository: one message action and one helper,
 * no CSS and no DOM of its own.
 */

const ICON = `<svg viewBox="0 0 20 20" aria-hidden="true">
  <path fill="currentColor" d="M8.6 11.4a.75.75 0 0 1 0-1.06l1.74-1.75a2.5 2.5 0 1 1 3.54 3.54l-1.4 1.4a.75.75 0 1 1-1.06-1.07l1.4-1.4a1 1 0 0 0-1.42-1.41l-1.74 1.75a.75.75 0 0 1-1.06 0Z"/>
  <path fill="currentColor" d="M11.4 8.6a.75.75 0 0 1 0 1.06l-1.75 1.75a2.5 2.5 0 0 1-3.53-3.54l1.4-1.4a.75.75 0 0 1 1.06 1.06l-1.4 1.4a1 1 0 0 0 1.41 1.42l1.75-1.75a.75.75 0 0 1 1.06 0Z"/>
  <path fill="currentColor" d="M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15ZM4 10a6 6 0 1 1 12 0 6 6 0 0 1-12 0Z" opacity=".35"/>
</svg>`;

export default {
  /**
   * @param {import('../../../src/runtime/api.js').PluginApi} api
   */
  start(api) {
    api.slack.addMessageAction({
      id: 'copy-link',
      label: 'Copy link to message',
      icon: ICON,
      onClick: async (message) => {
        if (!message.permalink) {
          api.ui.toast('No link for this message', { variant: 'error' });
          return;
        }
        // copy() handles the clipboard, the confirmation and the failure toast.
        await api.helpers.copy(message.permalink, 'Link copied');
      },
    });
  },

  stop() {},
};
