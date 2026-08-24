// The kit's stylesheet, as a string: a mod injects it into a document of its
// own, where no <link> to anything in this repository can reach.
//
// NEVER put a backtick in here, comments included. This is a template literal;
// a backticked class name closes the string and the rest of the file parses as
// JavaScript, which builds cleanly and then throws at boot with no styling on
// the failure. It has happened twice in this repository.

import { CODE_CSS } from './code.js';

export const KIT_CSS = `/* The design system, as a stylesheet.
 *
 * Injected by a mod into whatever document it is building in -- a window it
 * opened, most often, where none of Slack's own stylesheet exists. Everything
 * is prefixed sm- so it cannot collide with Slack's classes if it is put into
 * the client itself.
 *
 * The palette below is Slack's own dark one, fixed rather than read from the
 * app's tokens: a tool that repaints itself with the theme being edited becomes
 * unreadable exactly when the theme is wrong, which is the moment you need it.
 * A mod that wants to follow the theme can override these five variables.
 */

:root {
  --sm-bg: #1a1d21;
  --sm-raised: #222529;
  --sm-raised-2: #27292d;
  --sm-hover: rgba(255, 255, 255, .04);
  --sm-line: rgba(255, 255, 255, .13);
  --sm-line-soft: rgba(255, 255, 255, .07);
  --sm-text: #d1d2d3;
  --sm-bright: #f8f8f8;
  --sm-muted: #9a9b9d;
  --sm-accent: #1d9bd1;
  --sm-primary: #007a5a;
  --sm-primary-hover: #148567;
  --sm-danger: #e01e5a;
  --sm-good: #2bac76;
  --sm-focus: #1264a3;
  --sm-font: Lato, Slack-Lato, appleLogo, -apple-system, sans-serif;
  --sm-mono: Monaco, Menlo, Consolas, monospace;

  /* How the kit moves.
   *
   * Values, not rules, so the whole design system has one tempo and anything
   * that wants to change it changes six numbers rather than forty
   * declarations. A mod with an opinion -- the Motion mod is the one this was
   * built for -- redefines these on the root of whatever document the kit is
   * in, and every control below follows without knowing it exists.
   *
   * Set to 0 and the kit is still: sm-motion-shift and sm-motion-pop are the
   * only sources of travel in here.
   */
  --sm-motion-quick: 120ms;
  --sm-motion-base: 200ms;
  --sm-motion-ease: cubic-bezier(.2, .9, .25, 1);
  --sm-motion-spring: cubic-bezier(.22, 1.4, .36, 1);
  --sm-motion-shift: 8px;
  --sm-motion-pop: .06;
}

/* ================================================================== motion */

/* A design system with no transitions is a design system that is finished
 * everywhere except in time. Every rule here is additive -- it sets transition,
 * animation or transform and nothing else -- so a document that zeroes the
 * tokens above gets exactly the layout it had before. */

.sm-btn,
.sm-icon-btn,
.sm-input,
.sm-select,
.sm-swatch,
.sm-segmented__item {
  transition:
    background-color var(--sm-motion-quick) var(--sm-motion-ease),
    border-color var(--sm-motion-quick) var(--sm-motion-ease),
    color var(--sm-motion-quick) var(--sm-motion-ease),
    box-shadow var(--sm-motion-quick) var(--sm-motion-ease),
    transform var(--sm-motion-quick) var(--sm-motion-ease);
}

.sm-swatch:hover {
  transform: translateY(calc(var(--sm-motion-shift) * -.35))
             scale(calc(1 + var(--sm-motion-pop) * .8));
}

.sm-btn:active,
.sm-icon-btn:active,
.sm-swatch:active,
.sm-segmented__item:active {
  transform: scale(calc(1 - var(--sm-motion-pop)));
  transition-duration: 60ms;
}

@keyframes sm-motion-arrive {
  from {
    opacity: 0;
    transform: translateY(calc(var(--sm-motion-shift) * .8))
               scale(calc(1 - var(--sm-motion-pop)));
  }
  to { opacity: 1; transform: none; }
}

@keyframes sm-motion-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}

.sm-dialog, .sm-popover { animation: sm-motion-arrive var(--sm-motion-base) var(--sm-motion-spring); }
.sm-scrim { animation: sm-motion-fade var(--sm-motion-base) var(--sm-motion-ease); }

/* The kit is used in windows a mod opened, which have no other stylesheet and
 * so no other chance to honour this. Fades stay; travel goes -- which is what
 * reduced motion asks for, rather than stillness. */
@media (prefers-reduced-motion: reduce) {
  :root { --sm-motion-shift: 0px; --sm-motion-pop: 0; }
}

/* ================================================================ controls */

.sm-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 12px 1px;
  border-radius: 4px;
  border: none;
  font: 900 15px/1 var(--sm-font);
  color: var(--sm-bright);
  background: transparent;
  cursor: pointer;
  white-space: nowrap;
}
.sm-btn--primary { background: var(--sm-primary); }
.sm-btn--primary:hover { background: var(--sm-primary-hover); }
.sm-btn--default { box-shadow: inset 0 0 0 1px var(--sm-line); }
.sm-btn--default:hover { background: var(--sm-hover); }
.sm-btn--ghost { color: var(--sm-text); box-shadow: inset 0 0 0 1px var(--sm-line); }
.sm-btn--ghost:hover { background: var(--sm-hover); color: var(--sm-bright); }
.sm-btn[data-on="true"] { background: var(--sm-danger); color: #fff; box-shadow: none; }
.sm-btn--wide { width: 100%; justify-content: center; }
.sm-btn:disabled { opacity: .55; cursor: default; }
.sm-btn:focus-visible, .sm-segmented__item:focus-visible {
  outline: none;
  box-shadow: 0 0 0 4px rgba(29, 155, 209, .5);
}
.sm-btn__icon { display: flex; }
.sm-btn__icon svg { width: 16px; height: 16px; }

.sm-icon-btn {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--sm-muted);
  font-size: 17px;
  line-height: 1;
  cursor: pointer;
}
.sm-icon-btn:hover { background: var(--sm-hover); color: var(--sm-bright); }
.sm-icon-btn--danger:hover { background: rgba(224, 30, 90, .16); color: #ff8ba7; }

.sm-input {
  width: 100%;
  min-width: 0;
  height: 36px;
  padding: 0 11px;
  border-radius: 4px;
  border: 1px solid var(--sm-line);
  background: var(--sm-bg);
  color: var(--sm-bright);
  font: 15px/1 var(--sm-font);
}
.sm-input:focus { outline: none; border-color: var(--sm-focus); box-shadow: 0 0 0 1px var(--sm-focus); }
.sm-input::placeholder { color: var(--sm-muted); }
.sm-select { appearance: none; padding-right: 30px;
  background-image: linear-gradient(45deg, transparent 50%, var(--sm-muted) 50%),
                    linear-gradient(135deg, var(--sm-muted) 50%, transparent 50%);
  background-position: calc(100% - 15px) 15px, calc(100% - 10px) 15px;
  background-size: 5px 5px, 5px 5px;
  background-repeat: no-repeat;
}

.sm-field { margin-bottom: 14px; }
.sm-field__label { display: block; font-weight: 700; color: var(--sm-bright); margin-bottom: 4px; font-size: 14px; }
.sm-field__hint { margin: 4px 0 0; font-size: 13px; color: var(--sm-muted); }

.sm-segmented {
  display: flex;
  gap: 2px;
  padding: 2px;
  background: var(--sm-bg);
  border: 1px solid var(--sm-line-soft);
  border-radius: 6px;
  margin: 10px 0 0;
  overflow-x: auto;
}
.sm-segmented__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--sm-muted);
  font: 700 13px/1 var(--sm-font);
  cursor: pointer;
  white-space: nowrap;
}
.sm-segmented__item:hover { color: var(--sm-bright); background: var(--sm-hover); }
.sm-segmented__item[aria-selected="true"] { background: var(--sm-raised-2); color: var(--sm-bright); }
.sm-segmented__item em {
  font-style: normal;
  font-size: 11px;
  color: var(--sm-muted);
  background: rgba(255, 255, 255, .08);
  border-radius: 8px;
  padding: 1px 6px;
}


/* ================================================================= swatches */

.sm-swatch {
  display: block;
  flex: 0 0 auto;
  border-radius: 4px;
  border: 1px solid var(--sm-line);
  background-size: 10px 10px;
  background-position: 0 0, 0 5px, 5px -5px, -5px 0;
}
.sm-swatch--sm { width: 18px; height: 18px; border-radius: 3px; }
.sm-swatch--md { width: 30px; height: 30px; }
.sm-swatch--lg { width: 46px; height: 46px; border-radius: 6px; }

/* ================================================================== popover */

.sm-popover {
  position: fixed;
  z-index: 50;
  width: 260px;
  padding: 12px;
  border-radius: 8px;
  background: var(--sm-raised-2);
  border: 1px solid var(--sm-line);
  box-shadow: 0 12px 32px rgba(0, 0, 0, .55);
}
/* =================================================================== dialog */

.sm-scrim {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, .6);
}
.sm-dialog {
  width: min(440px, calc(100vw - 32px));
  padding: 20px;
  border-radius: 8px;
  background: var(--sm-raised);
  border: 1px solid var(--sm-line);
  box-shadow: 0 18px 48px rgba(0, 0, 0, .6);
}
.sm-dialog h2 { margin: 0 0 8px; font-size: 20px; font-weight: 900; color: var(--sm-bright); }
.sm-dialog p { margin: 0 0 18px; font-size: 15px; color: var(--sm-text); }
.sm-dialog__actions { display: flex; justify-content: flex-end; gap: 8px; }
.sm-btn--danger { background: var(--sm-danger); color: #fff; }
.sm-btn--danger:hover { background: #c4184a; }


`+ CODE_CSS;
