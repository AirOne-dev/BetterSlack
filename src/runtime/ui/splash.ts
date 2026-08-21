// The screen that covers Slack while BetterSlack is starting.
//
// Between the renderer coming up and the last plugin mounting there are several
// seconds in which Slack draws itself, then a theme repaints it, then buttons
// appear one at a time as their mods start. Every one of those is correct and
// the sequence looks like something going wrong. This covers it, and lifts when
// the mods are in.
//
// Three rules, each of which is the reason it is written this way rather than
// as fifteen lines of innerHTML:
//
//   * It runs at document-start, where `document.body` is genuinely null. So
//     nothing is built until there is somewhere to put it, and `done()` before
//     that simply cancels the whole thing.
//   * It covers the entire app, so it may never be what traps somebody. There
//     is a hard ceiling on how long it can stay, it is removed in a `finally`,
//     and it stops taking pointer events the moment it starts fading.
//   * It is in a shadow root with its own colours. At document-start Slack's
//     stylesheet has not loaded and its tokens do not exist yet -- so every
//     colour here carries a literal fallback, and picks the token up by itself
//     a moment later when a theme lands.

import { createI18n } from '../i18n.js';
import { MARK_SVG } from './mark.js';
import { PANEL_STRINGS } from './strings.js';

const HOST_ID = 'betterslack-splash';

/** Long enough for a slow client, short enough that a wedged one still clears. */
const CEILING_MS = 20_000;

/**
 * Below this it is a blink rather than a screen.
 *
 * Safe mode applies nothing at all, so without a floor the overlay would appear
 * and vanish inside one frame, which reads as a flash of something broken.
 */
const FLOOR_MS = 500;

const FADE_MS = 260;

const CSS = `
:host {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 22px;
  /* Slack's own surface once it exists, and its shade until then. */
  background: var(--dt_color-base-pry, #1a1d21);
  opacity: 1;
  transition: opacity ${FADE_MS}ms ease-out;
  font-family: Lato, Slack-Lato, -apple-system, BlinkMacSystemFont, sans-serif;
}
:host(.betterslack-splash--out) { opacity: 0; pointer-events: none; }

.mark { width: 84px; height: 84px; }
.mark svg { width: 100%; height: 100%; display: block; overflow: visible; }

/*
 * The mark is a circuit, and this runs a light around it.
 *
 * Worked out from the drawing rather than invented for it. The four bars are
 * 121 wide and 421 long, and each one is a side of an open square with the
 * corners left out:
 *
 *   cyan    top     y 139..260   drawn x 139 -> 560
 *   green   right   x 588..709   drawn y 139 -> 560
 *   yellow  bottom  y 589..710   drawn x 709 -> 288
 *   red     left    x 139..260   drawn y 710 -> 289
 *
 * Which is one clockwise lap, ending where it began. So each bar grows from the
 * end the lap arrives at, holds for an instant, then retracts from the far end
 * -- a stroke travelling round rather than four shapes pulsing in place. The
 * origin flips at the moment the bar is at full length, where moving it cannot
 * be seen.
 *
 * THE TRAP, and it is the reason every bar is wrapped in a group first: three
 * of the four rects are placed by a transform ATTRIBUTE, and a CSS transform
 * replaces it outright rather than composing with it. Animating the rects
 * directly threw cyan, green and yellow back to their unrotated positions for
 * the whole animation -- which looked like a logo coming apart, and was.
 */
.mark svg > g {
  transform-box: view-box;
  animation-duration: 2.2s;
  animation-timing-function: cubic-bezier(.4, 0, .2, 1);
  animation-iteration-count: infinite;
}

.mark svg > g:nth-child(3) { animation-name: lap-top;    animation-delay: 0s; }
.mark svg > g:nth-child(5) { animation-name: lap-right;  animation-delay: .55s; }
.mark svg > g:nth-child(7) { animation-name: lap-bottom; animation-delay: 1.1s; }
.mark svg > g:nth-child(1) { animation-name: lap-left;   animation-delay: 1.65s; }

@keyframes lap-top {
  0%        { transform-origin: 139px 199.5px; transform: scaleX(0); }
  20%       { transform-origin: 139px 199.5px; transform: scaleX(1); }
  21%       { transform-origin: 560px 199.5px; transform: scaleX(1); }
  44%, 100% { transform-origin: 560px 199.5px; transform: scaleX(0); }
}
@keyframes lap-right {
  0%        { transform-origin: 648.5px 139px; transform: scaleY(0); }
  20%       { transform-origin: 648.5px 139px; transform: scaleY(1); }
  21%       { transform-origin: 648.5px 560px; transform: scaleY(1); }
  44%, 100% { transform-origin: 648.5px 560px; transform: scaleY(0); }
}
@keyframes lap-bottom {
  0%        { transform-origin: 709px 649.5px; transform: scaleX(0); }
  20%       { transform-origin: 709px 649.5px; transform: scaleX(1); }
  21%       { transform-origin: 288px 649.5px; transform: scaleX(1); }
  44%, 100% { transform-origin: 288px 649.5px; transform: scaleX(0); }
}
@keyframes lap-left {
  0%        { transform-origin: 199.5px 710px; transform: scaleY(0); }
  20%       { transform-origin: 199.5px 710px; transform: scaleY(1); }
  21%       { transform-origin: 199.5px 289px; transform: scaleY(1); }
  44%, 100% { transform-origin: 199.5px 289px; transform: scaleY(0); }
}

/*
 * The four elbows are the still centre, and they are what keeps this a mark
 * rather than a spinner: with only the bars animating there is a moment in
 * every lap when almost nothing is drawn. They brighten as the light passes
 * their own corner and settle back.
 */
.mark svg > g:nth-child(2n) {
  opacity: .55;
  animation: elbow 2.2s ease-in-out infinite;
}
.mark svg > g:nth-child(4) { animation-delay: 0s; }
.mark svg > g:nth-child(6) { animation-delay: .55s; }
.mark svg > g:nth-child(8) { animation-delay: 1.1s; }
.mark svg > g:nth-child(2) { animation-delay: 1.65s; }

@keyframes elbow {
  0%, 60%, 100% { opacity: .5; }
  18%           { opacity: 1; }
}

.label {
  min-height: 18px;
  font-size: 13px;
  line-height: 18px;
  letter-spacing: .2px;
  color: var(--dt_color-content-ter, rgba(209, 210, 211, .62));
}

/*
 * The system setting is honoured here, unlike in the Motion mod.
 *
 * Installing a mod called Motion is a statement of intent about animation;
 * starting Slack is not. What is left is the same chase without the movement,
 * so the screen still says "working" to somebody who cannot have it spin.
 */
@media (prefers-reduced-motion: reduce) {
  /* No lap: the whole animation is travel. The mark stands whole and breathes,
     which still says "working" to somebody who cannot have it move. */
  .mark svg > g { animation: none !important; opacity: 1; }
  .mark { animation: breathe 2s ease-in-out infinite; }
  @keyframes breathe { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }
}
`;

/**
 * Built on first use, never at module scope.
 *
 * This file is evaluated at document-start, where `document.documentElement` is
 * null -- and `createI18n` reads the language off it. A translator built as the
 * module loads threw there and took the whole bundle down with it, which is the
 * bug that made both renderer freezes reachable.
 */
let translator: ReturnType<ReturnType<typeof createI18n>['strings']> | null = null;
const t = (key: string, vars?: Record<string, string>): string => {
  try {
    translator ??= createI18n().strings(PANEL_STRINGS);
    return translator(key, vars);
  } catch {
    return '';
  }
};

export interface Splash {
  /** Say what is starting, so a slow mod is named rather than guessed at. */
  progress(name: string, done: number, total: number): void;
  /** Fade and remove. Safe to call twice, and before it ever appeared. */
  done(): void;
}

/**
 * Put every shape in a group of its own, so the animation has somewhere to go.
 *
 * A CSS transform on an element *replaces* the transform attribute rather than
 * composing with it, and three of the four bars are placed by that attribute --
 * so animating the rects directly threw cyan, green and yellow back to their
 * unrotated positions and the mark came apart while it played. The group takes
 * the animation, the rect keeps its placement, and neither knows about the
 * other. It also means the one mark in `ui/mark.ts` is still the one drawn.
 */
function wrapShapes(svg: SVGElement | null): void {
  if (!svg) return;
  for (const shape of [...svg.children]) {
    const group = svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'g');
    svg.insertBefore(group, shape);
    group.append(shape);
  }
}

/** A splash that was never wanted, for the paths that must not branch. */
const NOTHING: Splash = { progress: () => undefined, done: () => undefined };

/**
 * Put the screen up, and hand back the two things the caller needs.
 *
 * Returns immediately. Nothing here is awaited by `boot()`: a splash that could
 * hold up the runtime would be a decoration with the power to stop the app.
 */
export function showSplash(): Splash {
  if (typeof document === 'undefined') return NOTHING;

  let host: HTMLElement | null = null;
  let label: HTMLElement | null = null;
  let pending = t('splashLoading');
  let finished = false;
  let observer: MutationObserver | null = null;
  const shownAt = Date.now();

  const build = (): void => {
    if (finished || host || !document.body) return;
    try {
      host = document.createElement('div');
      host.id = HOST_ID;
      // Out of the accessibility tree: it says nothing a screen reader needs,
      // and it is on top of everything Slack is building underneath it.
      host.setAttribute('aria-hidden', 'true');
      const root = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = CSS;
      const mark = document.createElement('div');
      mark.className = 'mark';
      mark.innerHTML = MARK_SVG;
      wrapShapes(mark.querySelector('svg'));
      label = document.createElement('div');
      label.className = 'label';
      // Asked for again here rather than trusted from above: the first attempt
      // happened at document-start, where there is no <html> to read a language
      // off and the translator answers with nothing.
      label.textContent = pending || t('splashLoading');
      root.append(style, mark, label);
      document.body.append(host);
    } catch {
      // A splash that throws must cost nothing: the app behind it is fine.
      host = null;
    }
  };

  const stopWatching = (): void => {
    observer?.disconnect();
    observer = null;
  };

  build();
  if (!host) {
    /*
     * No body yet, which at document-start is the ordinary case rather than the
     * odd one. The Document node is observable and sees <html> itself arrive,
     * which is the same fallback `waitForClient` and `dom.waitFor` take.
     */
    try {
      observer = new MutationObserver(() => {
        build();
        if (host) stopWatching();
      });
      observer.observe(document.documentElement ?? document, { childList: true, subtree: true });
    } catch {
      stopWatching();
    }
  }

  const remove = (): void => {
    stopWatching();
    host?.classList.add('betterslack-splash--out');
    const node = host;
    host = null;
    setTimeout(() => node?.remove(), FADE_MS);
  };

  // The ceiling. A mod that never returns, a client that never builds: neither
  // may leave somebody looking at a logo with their Slack behind it.
  const ceiling = setTimeout(() => {
    if (finished) return;
    finished = true;
    console.warn('[betterslack] the start screen timed out — showing Slack anyway');
    remove();
  }, CEILING_MS);

  return {
    progress(name, done, total) {
      pending = name
        ? t('splashStarting', { name, done: String(done + 1), total: String(total) })
        : t('splashLoading');
      if (label) label.textContent = pending;
    },
    done() {
      if (finished) return;
      finished = true;
      clearTimeout(ceiling);
      const left = FLOOR_MS - (Date.now() - shownAt);
      if (left > 0) setTimeout(remove, left);
      else remove();
    },
  };
}
