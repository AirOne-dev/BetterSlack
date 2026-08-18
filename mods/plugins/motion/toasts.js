// Giving `api.ui.toast` the same tempo as everything else.
//
// Toasts are the one component from `api.ui` a stylesheet in the document
// cannot reach: they live in a shadow root, deliberately, because Slack has no
// toast to borrow classes from and an unreadable error message is worse than
// an off-brand one. So they arrive with a timing of their own -- 150ms, fixed,
// written before this mod existed -- and ignore the speed and amplitude dials
// that move everything else.
//
// One fact makes this fixable in about ten lines rather than by rewriting
// them: custom properties inherit *through* a shadow boundary. Measured in the
// client -- a property set on <html> read back as 0.321s on an element inside
// a shadow root.
//
// The first attempt also used `:host-context(html.betterslack-motion-arrivals)`
// so the arrivals switch would still govern these rules. It does not work:
// measured in the same client, the rule never matched and the whole sheet was
// inert. Chromium has dropped the selector. So the group switch is carried by
// the *presence* of a custom property instead -- motion.css defines
// `--bsm-toast-*` only under the group classes, and the fallbacks below are
// the runtime's own values, which is what toasts get when the group is off.

const HOST_ID = 'betterslack-toast-host';
const STYLE_ID = 'betterslack-motion-toasts';

/*
 * Only timings and the travel distance. The colours, the shape and the layout
 * stay the runtime's, which is the whole point: this is a mod tuning a
 * component, not a mod reimplementing one.
 */
const TOAST_CSS = `
.toast {
  transition-duration: var(--bsm-toast-duration, 150ms);
  transition-timing-function: var(--bsm-toast-ease, ease);
  transform: translateY(var(--bsm-toast-shift, 8px));
}
.toast[data-shown="true"] { transform: translateY(0); }
.toast[data-leaving="true"] { transform: translateY(calc(var(--bsm-toast-shift, 8px) * 0.6)); }
.toast__action { transition: opacity var(--bsm-toast-action-duration, 0s) ease; }
.toast__action:hover { opacity: var(--bsm-toast-action-hover, 1); }
`;

/**
 * Put the stylesheet in the toast host's shadow root, if there is one yet.
 *
 * Idempotent, and called on a slow interval rather than once, because the host
 * is created lazily by the first toast anyone shows and `disposeWidgets`
 * removes it again when the runtime tears widgets down. A single `waitFor`
 * would therefore win a race it does not always win, and lose the sheet the
 * first time a host was replaced. Two id lookups every couple of seconds is
 * not a cost worth optimising, and `api.helpers.poll` stops them entirely
 * while the window is hidden.
 */
export function paintToasts(api) {
  const inject = () => {
    const root = document.getElementById(HOST_ID)?.shadowRoot;
    if (!root || root.querySelector(`#${STYLE_ID}`)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = TOAST_CSS;
    root.append(style);
  };

  api.helpers.poll(inject, 2000);
  api.onDispose(() => {
    document.getElementById(HOST_ID)?.shadowRoot?.querySelector(`#${STYLE_ID}`)?.remove();
  });
}
