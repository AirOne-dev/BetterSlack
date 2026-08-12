// Styles for the Mods panel.
//
// The panel lives in a shadow root, so none of this leaks into Slack and none
// of Slack's CSS leaks in -- which also means a broken user theme cannot make
// the panel unusable and trap someone with no way to turn it off.
//
// Custom properties do cross the shadow boundary, so Slack's design tokens are
// used where they exist, each with a fallback for when they get renamed. Using
// them is also what makes the panel follow Slack's own light/dark switch for
// free -- Slack swaps the token values, the panel just reads them.
//
// Two families, two conventions: the semantic tokens (--dt_color-base-*,
// -content-*, -otl-*) hold CSS colours, while the palette tokens
// (--dt_color-plt-*) hold bare "r,g,b" triplets and only work inside rgb().

export const PANEL_CSS = `
:host {
  --sm-bg: var(--dt_color-base-pry, #ffffff);
  --sm-bg-raised: var(--dt_color-base-sec, #f8f8f8);
  --sm-bg-hover: var(--dt_color-base-pry-hover, rgba(69, 68, 71, 0.06));
  --sm-text: var(--dt_color-content-pry, #1d1c1d);
  --sm-text-dim: var(--dt_color-content-sec, #454447);
  --sm-border: var(--dt_color-otl-sec, rgba(94, 93, 96, 0.45));
  --sm-accent: #611f69;
  --sm-accent-text: #ffffff;
  --sm-green: var(--dt_color-content-hgl-2, #007a5a);
  --sm-danger: var(--dt_color-content-imp, #c01343);
  --sm-radius: 10px;
  --sm-font: Lato, Slack-Lato, appleLogo, sans-serif;
  all: initial;
}

* { box-sizing: border-box; }

.backdrop {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  font-family: var(--sm-font);
  color: var(--sm-text);
}
/* Only on the way in. The panel re-renders on every toggle and tab change, and
 * animating those replays the fade as a flicker. */
.backdrop.entering { animation: sm-fade 120ms ease-out; }
@keyframes sm-fade { from { opacity: 0; } to { opacity: 1; } }

.dialog {
  width: min(920px, 92vw);
  height: min(640px, 88vh);
  display: flex;
  flex-direction: column;
  background: var(--sm-bg);
  border: 1px solid var(--sm-border);
  border-radius: var(--sm-radius);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}

header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--sm-border);
  flex: 0 0 auto;
}
header h1 { font-size: 17px; font-weight: 900; margin: 0; letter-spacing: -0.2px; }
header .version { font-size: 11px; color: var(--sm-text-dim); padding-top: 3px; }
header .spacer { flex: 1; }

.body { display: flex; flex: 1; min-height: 0; }

nav {
  flex: 0 0 172px;
  padding: 12px 10px;
  border-right: 1px solid var(--sm-border);
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}
nav button {
  all: unset;
  cursor: pointer;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 14px;
  color: var(--sm-text-dim);
  display: flex;
  align-items: center;
  gap: 8px;
}
nav button:hover { background: var(--sm-bg-hover); color: var(--sm-text); }
nav button[aria-selected="true"] { background: var(--sm-accent); color: var(--sm-accent-text); font-weight: 700; }
nav .count { margin-left: auto; font-size: 11px; opacity: 0.7; }

main { flex: 1; overflow-y: auto; padding: 18px 20px; min-width: 0; }
main h2 { font-size: 15px; margin: 0 0 4px; font-weight: 900; }

/* Installed / Enabled / Browse */
.shelf_bar {
  display: flex; align-items: center; gap: 12px; margin-bottom: 14px;
  position: sticky; top: -18px; z-index: 1; padding: 6px 0 8px;
  background: var(--sm-bg);
}
.shelves { display: flex; gap: 2px; }
.shelf {
  all: unset; cursor: pointer; display: flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-radius: 7px; font-size: 13px; font-weight: 700;
  color: var(--sm-text-dim);
}
.shelf:hover { background: var(--sm-bg-hover); color: var(--sm-text); }
.shelf[aria-selected="true"] { background: var(--sm-bg-raised); color: var(--sm-text); }
.shelf .count {
  font-size: 11px; font-weight: 700; padding: 1px 6px; border-radius: 999px;
  background: var(--sm-bg-hover); color: var(--sm-text-dim);
}
.shelf[aria-selected="true"] .count { color: var(--sm-text); }
.search {
  flex: 1; min-width: 0; font-size: 13px; padding: 7px 10px; border-radius: 7px;
  color: var(--sm-text); background: var(--sm-bg-raised);
  border: 1px solid var(--sm-border);
}
.search:focus { outline: 2px solid var(--sm-accent); outline-offset: -1px; }
.shelf_list { display: block; }
main .hint { font-size: 12.5px; color: var(--sm-text-dim); margin: 0 0 16px; line-height: 1.5; }
main .hint a { color: inherit; }

.card {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 13px 14px;
  border: 1px solid var(--sm-border);
  border-radius: 8px;
  margin-bottom: 10px;
  background: var(--sm-bg-raised);
}
.card .meta { flex: 1; min-width: 0; }
.card .name { font-size: 14px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
.card .desc { font-size: 12.5px; color: var(--sm-text-dim); margin-top: 3px; line-height: 1.45; }
.card .sub { font-size: 11px; color: var(--sm-text-dim); margin-top: 6px; opacity: 0.85; }
.card .actions { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }

.badge {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--sm-border);
  color: var(--sm-text-dim);
}
.badge.builtin { border-color: var(--sm-green); color: var(--sm-green); }

.switch { position: relative; width: 38px; height: 22px; flex: 0 0 auto; cursor: pointer; }
.switch input { opacity: 0; width: 0; height: 0; position: absolute; }
.switch .track {
  position: absolute; inset: 0; border-radius: 999px;
  background: var(--dt_color-otl-pry, #7c7a7f); transition: background 120ms ease;
}
.switch .thumb {
  position: absolute; top: 3px; left: 3px; width: 16px; height: 16px;
  border-radius: 50%; background: #fff; transition: transform 120ms ease;
}
.switch input:checked + .track { background: var(--sm-green); }
.switch input:checked + .track .thumb { transform: translateX(16px); }
.switch input:focus-visible + .track { outline: 2px solid var(--sm-text); outline-offset: 2px; }

button.btn {
  all: unset;
  cursor: pointer;
  font-size: 12.5px;
  font-weight: 700;
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid var(--sm-border);
  color: var(--sm-text);
}
button.btn:hover { background: var(--sm-bg-hover); }
button.btn.primary { background: var(--sm-green); border-color: transparent; color: #fff; }
button.btn.danger { color: var(--sm-danger); border-color: var(--sm-danger); }
button.btn[disabled] { opacity: 0.45; cursor: default; }

button.icon {
  all: unset; cursor: pointer; width: 30px; height: 30px; border-radius: 6px;
  display: grid; place-items: center; color: var(--sm-text-dim); font-size: 18px;
}
button.icon:hover { background: var(--sm-bg-hover); color: var(--sm-text); }

textarea {
  width: 100%;
  min-height: 300px;
  resize: vertical;
  background: var(--dt_color-base-sec, #f8f8f8);
  color: var(--sm-text);
  border: 1px solid var(--sm-border);
  border-radius: 8px;
  padding: 12px;
  font-family: Monaco, Menlo, Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.55;
}
textarea:focus { outline: 2px solid var(--sm-accent); outline-offset: -1px; }

.row { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
.row .spacer { flex: 1; }
.status { font-size: 12px; color: var(--sm-text-dim); }
.status.error { color: var(--sm-danger); }

.empty {
  padding: 34px 16px;
  text-align: center;
  color: var(--sm-text-dim);
  font-size: 13px;
  border: 1px dashed var(--sm-border);
  border-radius: 8px;
  line-height: 1.6;
}

dl.info { display: grid; grid-template-columns: auto 1fr; gap: 6px 16px; font-size: 12.5px; margin: 0; }
dl.info dt { color: var(--sm-text-dim); }
dl.info dd { margin: 0; font-family: Monaco, Menlo, monospace; font-size: 11.5px; word-break: break-all; }
`;

/**
 * Styles for the widgets mods get from `api.ui` — toasts, modals, confirms.
 *
 * Loaded inside each widget's shadow root, so a theme cannot break them and
 * they cannot leak into Slack. Colours read Slack's design tokens, which do
 * cross the shadow boundary, so widgets follow the active theme.
 */
export const WIDGET_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }

:host, .toast-stack, .modal__backdrop {
  --w-bg: var(--dt_color-base-pry, #ffffff);
  --w-raised: var(--dt_color-base-sec, #f8f8f8);
  --w-text: var(--dt_color-content-pry, #1d1c1d);
  --w-dim: var(--dt_color-content-sec, #454447);
  --w-border: var(--dt_color-otl-sec, rgba(94, 93, 96, 0.45));
  --w-green: var(--dt_color-content-hgl-2, #007a5a);
  --w-danger: var(--dt_color-content-imp, #c01343);
  --w-warn: var(--dt_color-content-hgl-3, #6b5000);
  --w-info: var(--dt_color-content-hgl-1, #1264a3);
  --w-font: Lato, Slack-Lato, appleLogo, sans-serif;
}

/* ---- toasts ---- */
.toast-stack {
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  z-index: 2147482000;
  display: flex;
  flex-direction: column-reverse;
  gap: 8px;
  align-items: center;
  pointer-events: none;
  font-family: var(--w-font);
}
.toast {
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: min(560px, 86vw);
  padding: 9px 16px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 700;
  color: #fff;
  background: #1d1c1d;
  box-shadow: 0 8px 26px rgba(0, 0, 0, 0.32);
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 150ms ease, transform 150ms ease;
  pointer-events: auto;
}
.toast[data-shown="true"] { opacity: 1; transform: translateY(0); }
.toast[data-leaving="true"] { opacity: 0; transform: translateY(6px); }
.toast--success { background: var(--w-green); }
.toast--error { background: var(--w-danger); }
.toast--warning { background: var(--w-warn); }
.toast--info { background: var(--w-info); }
.toast__text { min-width: 0; }
.toast__action {
  all: unset;
  cursor: pointer;
  font-weight: 900;
  text-decoration: underline;
  white-space: nowrap;
}
.toast__action:focus-visible { outline: 2px solid #fff; outline-offset: 2px; border-radius: 3px; }

/* ---- modals ---- */
.modal__backdrop {
  position: fixed;
  inset: 0;
  z-index: 2147482500;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  font-family: var(--w-font);
  color: var(--w-text);
  animation: w-fade 120ms ease-out;
}
@keyframes w-fade { from { opacity: 0 } to { opacity: 1 } }

.modal {
  display: flex;
  flex-direction: column;
  max-height: 86vh;
  background: var(--w-bg);
  /* A glass theme makes --dt_color-base-pry translucent, which is fine behind a
   * message list and unreadable behind a dialog. Frosting keeps the theme's
   * look without losing the text. */
  backdrop-filter: blur(24px) saturate(140%);
  -webkit-backdrop-filter: blur(24px) saturate(140%);
  border: 1px solid var(--w-border);
  border-radius: 12px;
  box-shadow: 0 20px 52px rgba(0, 0, 0, 0.42);
  overflow: hidden;
}
.modal__header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 18px 20px 12px;
}
.modal__titles { flex: 1; min-width: 0; }
.modal__title { margin: 0; font-size: 18px; font-weight: 900; letter-spacing: -0.2px; }
.modal__subtitle { margin: 4px 0 0; font-size: 13px; color: var(--w-dim); line-height: 1.5; }
.modal__close {
  all: unset; cursor: pointer; width: 30px; height: 30px; border-radius: 6px;
  display: grid; place-items: center; font-size: 20px; color: var(--w-dim); flex: 0 0 auto;
}
.modal__close:hover { background: var(--dt_color-base-pry-hover, rgba(0,0,0,0.06)); color: var(--w-text); }

.modal__body { padding: 0 20px 4px; overflow-y: auto; font-size: 14px; line-height: 1.55; }
.modal__text { margin: 0 0 12px; }

.modal__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 20px 18px;
}

.btn {
  all: unset;
  cursor: pointer;
  font-size: 14px;
  font-weight: 700;
  padding: 8px 16px;
  border-radius: 6px;
  border: 1px solid var(--w-border);
  color: var(--w-text);
  text-align: center;
}
.btn:hover { background: var(--dt_color-base-pry-hover, rgba(0,0,0,0.06)); }
.btn--primary { background: var(--w-green); border-color: transparent; color: #fff; }
.btn--primary:hover { filter: brightness(1.08); background: var(--w-green); }
.btn--danger { background: var(--w-danger); border-color: transparent; color: #fff; }
.btn--danger:hover { filter: brightness(1.08); background: var(--w-danger); }
.btn:focus-visible { outline: 2px solid var(--w-info); outline-offset: 2px; }

@media (prefers-reduced-motion: reduce) {
  .toast, .modal__backdrop { transition: none; animation: none; }
}
`;

/**
 * The launcher button.
 *
 * Almost nothing here on purpose: the button wears Slack's own
 * `p-control_strip__circle_button`, so its size, colour, hover, active state
 * and transition come from Slack and stay in step with the buttons beside it.
 * All that is left is sizing the icon, which Slack's own icons get from a
 * wrapper this button does not use.
 */
export const LAUNCHER_CSS = `
.slackmod-launcher svg,
.slackmod-toolbar-button svg,
.slackmod-action svg {
  width: 20px;
  height: 20px;
  display: block;
}

/*
 * Slack sizes its channel-header buttons from a per-page class
 * (p-view_header_search_action_button and friends) rather than from a shared
 * modifier, so a generic icon button lands at 36px next to their 28px. Borrow
 * one of theirs and the name would lie about what the button is; this states
 * the size directly instead.
 */
.p-view_header__actions .slackmod-toolbar-button {
  width: 28px;
  height: 28px;
}
`;
