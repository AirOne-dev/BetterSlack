/**
 * Focus Mode — fold everything away but the conversation.
 *
 * The whole mod is `api.helpers.toggle`: a persisted flag that drives a class
 * on <html>, so the behaviour is pure CSS and the state survives a restart.
 */

const INDICATOR_ID = 'slackmod-focus-indicator';

export default {
  /**
   * @param {import('../../../src/runtime/api.js').PluginApi} api
   */
  start(api) {
    const maxWidth = api.settings.get('maxWidth', 920);
    const combo = 'mod+shift+f';
    const shortcut = api.helpers.describeHotkey(combo);

    const focus = api.helpers.toggle({
      key: 'on',
      className: 'slackmod-focus-mode',
      // `&` is the flag class; this CSS only applies while the toggle is on.
      whenOn: `
        & [data-qa="channel-sidebar"],
        & .p-channel_sidebar,
        & [data-qa="tab_rail_desktop"],
        & .p-tab_rail { display: none !important; }

        /* Keep the top bar's height so macOS traffic lights stay reachable,
         * but strip it back to nothing visible until hovered. */
        & .p-ia4_top_nav {
          background: transparent !important;
          box-shadow: none !important;
          border-bottom: none !important;
        }
        & .p-ia4_top_nav > *:not(.p-ia4_top_nav__native_ui_spacer) {
          opacity: 0; pointer-events: none; transition: opacity 120ms ease;
        }
        & .p-ia4_top_nav:hover > * { opacity: 1; pointer-events: auto; }

        /* A comfortable measure instead of full-bleed text on a wide display. */
        & .c-virtual_list__scroll_container,
        & [data-qa="message_input"] {
          max-width: ${maxWidth}px;
          margin-left: auto !important;
          margin-right: auto !important;
        }

        & #${INDICATOR_ID} { opacity: 0.75; }
      `,
    });

    api.css(`
      #${INDICATOR_ID} {
        position: fixed; bottom: 18px; right: 18px; z-index: 2147482000;
        padding: 6px 12px; border-radius: 999px;
        font-family: Lato, Slack-Lato, sans-serif; font-size: 11px;
        font-weight: 700; letter-spacing: 0.3px;
        color: var(--dt_color-content-sec, #454447);
        background: var(--dt_color-base-sec, #f8f8f8);
        border: 1px solid var(--dt_color-otl-sec, rgba(94, 93, 96, 0.3));
        opacity: 0; pointer-events: none; transition: opacity 160ms ease;
      }
    `);

    const indicator = api.dom.h('div', { id: INDICATOR_ID, role: 'status' }, [
      `Focus mode · ${shortcut} to exit`,
    ]);
    document.body.append(indicator);
    api.onDispose(() => indicator.remove());

    api.helpers.hotkey(combo, () => void focus.toggle());

    // Escape is the reflex for "get me out of this", but only when nothing
    // else is claiming it. The guard goes in `when` so an Escape that does not
    // apply is not swallowed -- otherwise this would break Slack's dialogs.
    api.helpers.hotkey('escape', () => void focus.set(false), {
      when: () =>
        focus.on &&
        !document.querySelector('.ReactModal__Content') &&
        !document.activeElement?.closest('[data-qa="message_input"]'),
    });
  },

  stop() {},
};
