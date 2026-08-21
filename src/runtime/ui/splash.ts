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

.mark { width: 76px; height: 76px; animation: turn 9s linear infinite; }
.mark svg { width: 100%; height: 100%; display: block; }

/*
 * Each arm and its elbow, breathing in turn.
 *
 * The scale is about the mark's own centre rather than each shape's, so an arm
 * grows outward along the axis it already lies on instead of swelling in place
 * -- which is what makes this read as the mark assembling rather than as four
 * shapes pulsing. That is why the origin is written in the drawing's own
 * coordinates and needs transform-box view-box to be understood in them.
 */
.mark svg > * {
  transform-box: view-box;
  transform-origin: 424px 424px;
  animation: arm 1.7s ease-in-out infinite;
}
.mark svg > :nth-child(1), .mark svg > :nth-child(2) { animation-delay: 0s; }
.mark svg > :nth-child(3), .mark svg > :nth-child(4) { animation-delay: .13s; }
.mark svg > :nth-child(5), .mark svg > :nth-child(6) { animation-delay: .26s; }
.mark svg > :nth-child(7), .mark svg > :nth-child(8) { animation-delay: .39s; }

/*
 * A shimmer, not a scatter.
 *
 * The scale was .82 for one revision and a still frame of it looks like four
 * loose shapes rather than one mark: pulled that far toward the centre, an arm
 * no longer reads as belonging where it is. .93 keeps every shape recognisably
 * in place and lets the opacity carry the chase, which is what the eye follows
 * anyway.
 *
 * The dim end of that chase is .42 rather than .25 for the same reason: below
 * about a third, an arm against this background is gone rather than quiet, and
 * what is left reads as a logo with pieces missing instead of one with a wave
 * running over it. The mark has to stay a mark the whole way round.
 */
@keyframes arm {
  0%, 100% { opacity: .42; transform: scale(.93); }
  40%      { opacity: 1;   transform: scale(1); }
}
@keyframes turn { to { transform: rotate(360deg); } }

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
  .mark { animation: none; }
  @keyframes arm { 0%, 100% { opacity: .3; } 40% { opacity: 1; } }
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
