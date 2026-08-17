/**
 * Composer Character Count
 *
 * A worked example of the BetterSlack plugin API:
 *   - anchors on `data-qa` attributes rather than Slack's hashed class names
 *   - keeps its node mounted across Slack's re-renders without duplicating it
 *   - reads a threshold from persisted settings
 *   - registers every listener through the api so disabling it leaves no trace
 *
 * Plugins are ES modules. They are loaded through a blob: URL and a dynamic
 * import() -- Slack's CSP has no 'unsafe-eval', so eval() and new Function()
 * are not available to you here.
 */

// Slack silently splits anything past this into a second message.
const SLACK_LIMIT = 4000;

const COMPOSER = '[data-qa="message_input"]';
const EDITOR = '.ql-editor';
const NODE_ID = 'betterslack-char-count';

export default {
  /**
   * @param {import('../../../src/runtime/api.js').PluginApi} api
   */
  start(api) {
    const warnAt = api.settings.get('warnAt', Math.floor(SLACK_LIMIT * 0.9));
    const alwaysShow = api.settings.get('alwaysShow', true) !== false;

    api.css(`
      #${NODE_ID} {
        position: absolute;
        right: 12px;
        bottom: 6px;
        z-index: 5;
        pointer-events: none;
        font-family: Lato, Slack-Lato, sans-serif;
        font-size: 11px;
        font-variant-numeric: tabular-nums;
        color: var(--dt_color-content-ter, #5e5d60);
        opacity: 0;
        transition: opacity 120ms ease, color 120ms ease;
      }
      #${NODE_ID}[data-state="visible"] { opacity: 1; }
      #${NODE_ID}[data-state="warn"] { opacity: 1; color: var(--dt_color-content-hgl-3, #6b5000); font-weight: 700; }
      #${NODE_ID}[data-state="over"] { opacity: 1; color: var(--dt_color-content-imp, #c01343); font-weight: 700; }
      ${COMPOSER} { position: relative; }
    `);

    const counter = api.dom.h('div', { 'aria-hidden': 'true' });

    // keepMounted re-creates the node only when it is actually missing, so
    // Slack swapping the composer out on a channel change cannot leave several
    // counters stacked on top of each other.
    api.dom.keepMounted(COMPOSER, NODE_ID, () => counter);

    const update = () => {
      const editor = document.querySelector(EDITOR);
      const node = document.getElementById(NODE_ID);
      if (!editor || !node) return;

      // innerText rather than textContent: it collapses the <br> Quill inserts
      // for empty trailing lines, which textContent would count as characters.
      // It is not universally implemented though, and this runs inside a
      // MutationObserver — throwing here would fire on every keystroke.
      const raw = editor.innerText ?? editor.textContent ?? '';
      const length = raw.replace(/\n$/, '').length;

      node.textContent = length > SLACK_LIMIT
        ? `${length} / ${SLACK_LIMIT} — will be split`
        : String(length);

      node.dataset.state =
        length === 0 ? 'hidden'
          : length > SLACK_LIMIT ? 'over'
            : length >= warnAt ? 'warn'
              // Quiet until it matters, unless someone asked to always see it.
              : alwaysShow ? 'visible'
                : 'hidden';
    };

    // The composer is a contenteditable, so there is no `input` event to bind
    // on a form control; observing the subtree is the reliable route.
    const observer = new MutationObserver(update);
    const attach = () => {
      const editor = document.querySelector(EDITOR);
      if (!editor) return;
      observer.observe(editor, { childList: true, subtree: true, characterData: true });
      update();
    };
    attach();

    // Re-attach when Slack replaces the editor (channel switch, thread open).
    api.dom.onEach(EDITOR, () => {
      observer.disconnect();
      attach();
    });

    api.onDispose(() => {
      observer.disconnect();
      document.getElementById(NODE_ID)?.remove();
    });

    api.log.info(`ready — warning at ${warnAt} characters`);
  },

  stop() {
    // Everything registered through the api is torn down automatically; this
    // hook is only for state the api does not know about.
  },
};
