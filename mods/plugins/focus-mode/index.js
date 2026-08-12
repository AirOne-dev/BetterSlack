/**
 * Focus Mode
 *
 * Everything is CSS driven off one class on <html>, so toggling costs nothing
 * and Slack re-rendering underneath cannot knock it out of sync.
 */

const FLAG = 'slackmod-focus-mode';
const INDICATOR_ID = 'slackmod-focus-indicator';

export default {
  /**
   * @param {import('../../../src/runtime/api.js').PluginApi} api
   */
  start(api) {
    const maxWidth = api.settings.get('maxWidth', 920);

    api.css(`
      html.${FLAG} [data-qa="channel-sidebar"],
      html.${FLAG} .p-channel_sidebar,
      html.${FLAG} [data-qa="tab_rail_desktop"],
      html.${FLAG} .p-tab_rail {
        display: none !important;
      }

      /* Keep the top bar's height so the traffic-light buttons stay reachable
       * on macOS, but strip it back to nothing visible. */
      html.${FLAG} .p-ia4_top_nav {
        background: transparent !important;
        box-shadow: none !important;
        border-bottom: none !important;
      }
      html.${FLAG} .p-ia4_top_nav > *:not(.p-ia4_top_nav__native_ui_spacer) {
        opacity: 0;
        pointer-events: none;
        transition: opacity 120ms ease;
      }
      html.${FLAG} .p-ia4_top_nav:hover > * {
        opacity: 1;
        pointer-events: auto;
      }

      /* A comfortable measure instead of full-bleed text on a wide display. */
      html.${FLAG} .c-virtual_list__scroll_container,
      html.${FLAG} [data-qa="message_input"] {
        max-width: ${maxWidth}px;
        margin-left: auto !important;
        margin-right: auto !important;
      }

      #${INDICATOR_ID} {
        position: fixed;
        bottom: 18px;
        right: 18px;
        z-index: 2147482000;
        padding: 6px 12px;
        border-radius: 999px;
        font-family: Lato, Slack-Lato, sans-serif;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.3px;
        color: var(--dt_color-content-sec, #454447);
        background: var(--dt_color-base-sec, #f8f8f8);
        border: 1px solid var(--dt_color-otl-sec, rgba(94, 93, 96, 0.3));
        opacity: 0;
        pointer-events: none;
        transition: opacity 160ms ease;
      }
      html.${FLAG} #${INDICATOR_ID} { opacity: 0.75; }
    `);

    const indicator = api.dom.h('div', { id: INDICATOR_ID, role: 'status' }, [
      'Focus mode · ⌘⇧F to exit',
    ]);
    document.body.append(indicator);

    const toggle = () => {
      const on = document.documentElement.classList.toggle(FLAG);
      api.log.info(on ? 'on' : 'off');
    };

    api.dom.onShortcut(
      (event) =>
        event.shiftKey && (event.metaKey || event.ctrlKey) && !event.altKey && event.code === 'KeyF',
      toggle,
    );

    // Escape is the reflex for "get me out of this", but only when nothing else
    // is claiming it -- otherwise it would fight Slack's own dialogs.
    api.dom.onShortcut(
      (event) =>
        event.key === 'Escape' &&
        document.documentElement.classList.contains(FLAG) &&
        !document.querySelector('.ReactModal__Content') &&
        !(document.activeElement && document.activeElement.closest('[data-qa="message_input"]')),
      toggle,
    );

    api.onDispose(() => {
      document.documentElement.classList.remove(FLAG);
      indicator.remove();
    });
  },

  stop() {},
};
