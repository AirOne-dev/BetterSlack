/**
 * Quote Reply
 *
 * Slack gives you threads, which move the conversation off to the side. This
 * gives you the other thing: an answer that stays in the channel but still
 * shows what it is answering, using Slack's own link unfurl of the original
 * message.
 *
 * Hovering a message gets you a Reply button. Pressing it puts a "." into the
 * composer, linked to that message, and focuses it. You type your answer after
 * it and send:
 *
 *     . En effet tu as raison
 *      ^ this dot is a link, so Slack unfurls the message underneath
 */

const ICON = `<svg viewBox="0 0 20 20" aria-hidden="true" style="--s:20px;width:20px;height:20px">
  <path fill="currentColor" d="M8.5 4.2a.75.75 0 0 0-1.28-.53l-4.5 4.5a.75.75 0 0 0 0 1.06l4.5 4.5A.75.75 0 0 0 8.5 13.2v-2.02c2.3.1 4.1.7 5.44 1.8 1.03.85 1.79 2 2.3 3.46a.75.75 0 0 0 1.45-.26c0-3.2-.9-5.79-2.76-7.6C13.3 7 11.1 6.2 8.5 6.05V4.2Zm-1.5 1.6v1a.75.75 0 0 0 .72.75c2.62.1 4.7.83 6.2 2.28 1.06 1.03 1.79 2.4 2.16 4.12a8.2 8.2 0 0 0-1.19-1.3c-1.72-1.42-3.98-2.09-6.72-2.09a.75.75 0 0 0-.75.75v1.06L4.84 9.2 7 5.8Z"/>
</svg>`;

/** How the quoted line looks once it is in the composer. */
const QUOTE_TEXT = '.';

const STRINGS = {
  en: { action: 'Reply in channel (quote)' },
  fr: { action: 'Répondre dans le canal (citation)' },
};

export default {
  /**
   * @param {import('../../../src/runtime/api.js').PluginApi} api
   */
  start(api) {
    const t = api.i18n.strings(STRINGS);
    // Slack sizes its own action buttons through classes we reuse, so this only
    // needs to cover the icon itself.
    api.css(`
      .betterslack-action svg { width: 20px; height: 20px; display: block; }
    `);

    api.slack.addMessageAction({
      id: 'reply',
      label: t('action'),
      icon: ICON,
      onClick: (message) => {
        if (!message.permalink) {
          api.log.warn('no permalink on this message — nothing to link to');
          return;
        }

        const composer = api.slack.composer;
        if (!composer.element()) {
          api.log.warn('no composer on screen');
          return;
        }

        // Start a fresh line when there is already a draft, so an existing
        // message in progress is never mangled.
        if (!composer.isEmpty()) composer.insertText('\n');

        if (!composer.insertLink(message.permalink, QUOTE_TEXT)) {
          api.log.error('could not insert the link into the composer');
          return;
        }

        // A trailing space puts the caret clear of the link, so what you type
        // next is plain text rather than an extension of the anchor.
        composer.insertText(' ');
        composer.focus();
        composer.caretToEnd();
      },
    });

    api.log.info('ready — hover a message and press Reply');
  },

  stop() {
    // The button and its observer are registered through api and removed for us.
  },
};
