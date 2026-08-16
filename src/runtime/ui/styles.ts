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

/**
 * What Slack has no class for.
 *
 * The panel wears Slack's own `c-dialog` / `c-menu` classes, so almost nothing
 * needs styling here — only layout, and the few controls Slack has no reusable
 * class for. Every colour comes from a Slack variable, so the panel follows the
 * active theme exactly rather than approximating it:
 *
 *   rgba(var(--sk_primary_foreground), 1)   text
 *   rgba(var(--sk_foreground_max), .7)      secondary text
 *   rgba(var(--sk_foreground_low), .13)     hairlines
 *   var(--dt_color-*)                       semantic colours
 */
import { CODE_CSS } from './code.js';

export const PANEL_CSS = CODE_CSS + `
/* .c-dialog ships opacity:0 and is faded in by Slack's own transition. */
#betterslack-panel.c-dialog { opacity: 1; }

.betterslack-content {
  display: flex;
  flex-direction: column;
  width: min(880px, calc(100% - 32px));
  max-width: min(880px, calc(100% - 32px));
  height: min(620px, calc(100% - 64px));
  max-height: min(620px, calc(100% - 64px));
  opacity: 1;
}

.betterslack-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px 24px 12px;
}
.betterslack-close { margin-left: auto; flex: 0 0 auto; }

.betterslack-layout { display: flex; flex: 1; min-height: 0; }

/* Left rail, in the shape Slack's Preferences dialog uses. */
.betterslack-nav {
  flex: 0 0 176px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 8px 16px 16px;
  overflow-y: auto;
}
.betterslack-nav__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 15px;
  line-height: 1.46667;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1);
  text-align: left;
  cursor: pointer;
}
.betterslack-nav__item:hover { background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.08); }
.betterslack-nav__item[aria-selected="true"] {
  background: rgba(var(--sk_highlight, 18, 100, 163), 1);
  color: rgba(var(--sk_primary_background, 255, 255, 255), 1);
  font-weight: var(--custom-font-weight-bold, 700);
}
.betterslack-nav__item[aria-selected="true"] .betterslack-count {
  background: rgba(255, 255, 255, 0.24);
  color: inherit;
}

.betterslack-count {
  margin-left: auto;
  min-width: 20px;
  padding: 0 6px;
  border-radius: 999px;
  font-size: 12px;
  line-height: 18px;
  text-align: center;
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.12);
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.7);
}

.betterslack-body { flex: 1; min-width: 0; padding-bottom: 20px; }

.betterslack-toolbar {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0 12px;
  background: rgba(var(--sk_primary_background, 255, 255, 255), 1);
}
.betterslack-shelves { display: flex; gap: 2px; }
.betterslack-shelf {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 14px;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.7);
  cursor: pointer;
}
.betterslack-shelf:hover { background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.08); }
.betterslack-shelf[aria-selected="true"] {
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1);
  font-weight: var(--custom-font-weight-bold, 700);
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.12);
}

.betterslack-search {
  flex: 1;
  min-width: 0;
  padding: 8px 12px;
  border-radius: 4px;
  font-family: inherit;
  font-size: 15px;
  line-height: 1.46667;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1);
  background: transparent;
  border: 1px solid rgba(var(--sk_foreground_low, 29, 28, 29), 0.3);
}
.betterslack-search:focus {
  outline: none;
  border-color: rgba(var(--sk_highlight, 18, 100, 163), 1);
  box-shadow: 0 0 0 1px rgba(var(--sk_highlight, 18, 100, 163), 1);
}
/* The CSS box is api.ui's code editor. It brings its own metrics -- the painted
 * copy and the textarea have to agree on every one of them -- so only the
 * colours are set here, from Slack's tokens, which is what makes it follow the
 * theme like the rest of the panel. Written without backticks, as everything in
 * this file must be. */
.sm-code {
  border-color: rgba(var(--sk_foreground_low, 29, 28, 29), 0.3);
  background: rgba(var(--sk_foreground_min, 29, 28, 29), 0.04);
}
.sm-code:focus-within {
  border-color: rgba(var(--sk_highlight, 18, 100, 163), 1);
  box-shadow: 0 0 0 1px rgba(var(--sk_highlight, 18, 100, 163), 1);
}
.sm-code__paint { color: rgba(var(--sk_primary_foreground, 29, 28, 29), 0.9); }
.sm-code__input { caret-color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1); }
.sm-code__input::placeholder { color: rgba(var(--sk_primary_foreground, 29, 28, 29), 0.5); }

/* The update notice: the same row as everything else, marked by an accent edge
 * rather than a colour of its own, so it reads as important without shouting. */
.betterslack-row--notice {
  border-left: 3px solid rgba(var(--sk_highlight, 18, 100, 163), 1);
  padding-left: 12px;
}

/* A mod and its settings read as one block, with the settings indented under
 * the row they belong to rather than floating beside it. */
/* The palette. Slack's quick switcher is the shape people already know here,
 * so this borrows its proportions rather than inventing any. */
.betterslack-palette {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
}
/* Centred both ways, and tall enough to be a list rather than a peek: this is
 * the thing being searched, not a hint above the app. */
.betterslack-palette__box {
  width: min(640px, calc(100vw - 48px));
  max-height: min(560px, 70vh);
  display: flex;
  flex-direction: column;
  border-radius: 8px;
  overflow: hidden;
  background: rgba(var(--sk_primary_background, 255, 255, 255), 1);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
}
.betterslack-palette__input {
  border: 0;
  border-bottom: 1px solid rgba(var(--sk_foreground_low, 29, 28, 29), 0.2);
  padding: 14px 16px;
  font-size: 17px;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1);
  background: transparent;
  outline: none;
}
.betterslack-palette__list { overflow-y: auto; padding: 6px; min-height: 120px; }
.betterslack-palette__row {
  display: flex;
  align-items: baseline;
  /* Wrapping is what puts the subtitle on its own line. Without it the title
     is squeezed into a narrow column while a description takes the rest, which
     is what this looked like before anyone saw it. */
  flex-wrap: wrap;
  gap: 2px 8px;
  width: 100%;
  padding: 8px 10px;
  border-radius: 6px;
  text-align: left;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1);
  cursor: pointer;
}
.betterslack-palette__title {
  flex: 1 1 auto;
  min-width: 0;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.betterslack-palette__row[aria-selected="true"] {
  background: rgba(var(--sk_highlight, 18, 100, 163), 1);
  color: #fff;
}
.betterslack-palette__source { flex: 0 0 auto; font-size: 12px; opacity: 0.6; }
/* One line: a mod's description is a sentence, and three of them stacked turn
   a list into a wall. */
.betterslack-palette__sub {
  flex-basis: 100%;
  font-size: 12px;
  opacity: 0.7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.betterslack-remote { padding: 0 20px 10px; }
.betterslack-remote__row { display: flex; gap: 8px; align-items: center; margin-top: 6px; }
.betterslack-tag--warn {
  background: rgba(242, 163, 94, 0.18);
  color: rgba(180, 95, 6, 1);
}
.betterslack-dialog--small { max-width: 520px; }

.betterslack-diag { padding: 12px 20px; }
.betterslack-diag__row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 3px 0;
  font-size: 13px;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 0.85);
}
.betterslack-diag__num { font-variant-numeric: tabular-nums; opacity: 0.7; }

.betterslack-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 20px 8px;
}
.betterslack-filter {
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 12px;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 0.7);
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.1);
  cursor: pointer;
}
.betterslack-filter:hover { color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1); }
.betterslack-filter[aria-pressed="true"] {
  background: rgba(var(--sk_highlight, 18, 100, 163), 1);
  color: #fff;
}

/* The one tag that is a warning rather than a label. */
.betterslack-tag--error {
  background: rgba(var(--sk_highlight_accent, 224, 30, 90), 0.16);
  color: rgba(var(--sk_highlight_accent, 224, 30, 90), 1);
}

.betterslack-settings {
  padding: 4px 0 12px 16px;
  border-left: 2px solid rgba(var(--sk_foreground_low, 29, 28, 29), 0.2);
  margin: 0 0 8px 8px;
}
.betterslack-settings__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 6px 0;
}
.betterslack-settings__meta { min-width: 0; }
.betterslack-settings__input { max-width: 200px; }
.betterslack-row__group { display: block; }

.betterslack-row {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 14px 0;
  border-bottom: 1px solid rgba(var(--sk_foreground_low, 29, 28, 29), 0.13);
}
.betterslack-row:last-child { border-bottom: none; }
.betterslack-row__meta { flex: 1; min-width: 0; }
.betterslack-row__name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: var(--custom-font-weight-bold, 700);
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1);
}
.betterslack-row__desc {
  margin-top: 2px;
  font-size: 13px;
  line-height: 1.46;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.7);
}
.betterslack-row__sub {
  margin-top: 6px;
  font-size: 12px;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.55);
}
.betterslack-row__actions { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
.betterslack-row__more { opacity: 0; transition: opacity 80ms ease; }
.betterslack-row:hover .betterslack-row__more,
.betterslack-row__more:focus-visible { opacity: 1; }

.betterslack-tag {
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: var(--custom-font-weight-bold, 700);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.6);
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.1);
}

/* A theme's required plugins, on its row and in the dialog. */
.betterslack-row__requires {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.4;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.6);
}
.betterslack-row__requires--missing {
  color: var(--dt_color-content-warn, #b8730a);
  font-weight: var(--custom-font-weight-bold, 700);
}
.betterslack-row__review {
  color: var(--dt_color-content-link, #1264a3);
  font-size: 12px;
  font-weight: var(--custom-font-weight-bold, 700);
  text-decoration: underline;
  cursor: pointer;
}

#betterslack-requires.c-dialog { opacity: 1; z-index: 1101; }
.betterslack-content--narrow {
  width: min(520px, calc(100% - 32px));
  max-width: min(520px, calc(100% - 32px));
  height: auto;
  max-height: min(560px, calc(100% - 64px));
}
.betterslack-requires { display: flex; flex-direction: column; gap: 14px; margin: 0; padding: 0; list-style: none; }
.betterslack-require {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 12px 14px;
  border-radius: 8px;
  /* A tinted card rather than a warning triangle: this is a choice to make,
     not an error the user is being blamed for. */
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.08);
}
.betterslack-require__title {
  font-size: 15px;
  font-weight: var(--custom-font-weight-bold, 700);
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1);
}
.betterslack-require__detail {
  font-size: 13px;
  line-height: 1.5;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.7);
}
.betterslack-actions--dialog {
  justify-content: flex-end;
  padding: 4px 24px 20px;
  margin-top: 0;
}

/* Slack has no reusable switch class, so this is built from its variables. */
.betterslack-switch { position: relative; width: 38px; height: 22px; flex: 0 0 auto; cursor: pointer; }
.betterslack-switch input { position: absolute; opacity: 0; width: 0; height: 0; }
.betterslack-switch__track {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  background: rgba(var(--sk_foreground_max, 29, 28, 29), 0.4);
  transition: background 120ms ease;
}
.betterslack-switch__thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  transition: transform 120ms ease;
}
.betterslack-switch input:checked + .betterslack-switch__track {
  background: var(--dt_color-content-hgl-2, #007a5a);
}
.betterslack-switch input:checked + .betterslack-switch__track .betterslack-switch__thumb {
  transform: translateX(16px);
}
.betterslack-switch input:focus-visible + .betterslack-switch__track {
  box-shadow: 0 0 0 2px rgba(var(--sk_highlight, 18, 100, 163), 1);
}

.betterslack-empty {
  padding: 32px 16px;
  text-align: center;
  font-size: 14px;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.6);
}
.betterslack-hint {
  margin: 4px 0 16px;
  font-size: 13px;
  line-height: 1.5;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.7);
}
.betterslack-actions { display: flex; align-items: center; gap: 12px; margin-top: 12px; }
.betterslack-status { font-size: 13px; color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.7); }
.betterslack-danger { color: var(--dt_color-content-imp, #c01343); }

.betterslack-info {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px 16px;
  margin: 16px 0 0;
  font-size: 13px;
}
.betterslack-info dt { color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.7); }
.betterslack-info dd {
  margin: 0;
  font-family: Monaco, Menlo, monospace;
  font-size: 12px;
  word-break: break-all;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1);
}

/* Dialogs opened by mods through api.ui.modal: the same Slack shell, sized to
   the content rather than to a fixed panel height. */
/*
 * Slack ships .c-dialog at opacity 0 and fades it in with its own transition,
 * which never runs for a dialog we built. The panel has carried this override
 * since it moved into the light DOM; api.ui.modal did not, so every dialog a
 * mod opened was in the document, focusable, and completely invisible.
 */
.betterslack-widget_dialog { z-index: 1014; opacity: 1; }
.betterslack-widget_content { height: auto; max-height: min(640px, calc(100% - 64px)); }
.betterslack-widget_content .betterslack-body { flex: 0 1 auto; padding-bottom: 8px; }
.betterslack-widget_titles { flex: 1; min-width: 0; }
.betterslack-widget_subtitle { margin: 4px 0 0; }
.betterslack-widget_footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px 24px 20px;
}

/* Slack pins the top offset on .c-popover__content, so this layer is ours. */
.betterslack-menu_layer {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 1013;
  will-change: transform;
}
.betterslack-menu_layer .c-menu {
  min-width: 180px;
  border-radius: 6px;
  background: rgba(var(--sk_primary_background, 255, 255, 255), 1);
  box-shadow: 0 0 0 1px rgba(var(--sk_foreground_low, 29, 28, 29), 0.13),
    0 4px 12px 0 rgba(0, 0, 0, 0.12);
}
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

:host, .toast-stack {
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

@media (prefers-reduced-motion: reduce) {
  .toast { transition: none; }
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
.betterslack-launcher svg,
.betterslack-toolbar-button svg,
.betterslack-action svg {
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
.p-view_header__actions .betterslack-toolbar-button {
  width: 28px;
  height: 28px;
}

/* Slack's unread badge, on our own button: the same pill, the same red, the
 * same place. Anything else in that strip would read as a Slack control that
 * had gone wrong. */
.betterslack-launcher { position: relative; }
.betterslack-launcher__badge {
  position: absolute;
  top: -2px;
  right: -2px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: rgba(var(--sk_highlight_accent, 224, 30, 90), 1);
  color: #fff;
  font: 700 11px/16px Lato, Slack-Lato, sans-serif;
  text-align: center;
  pointer-events: none;
}
`;
