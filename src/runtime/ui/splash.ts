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

/*
 * The still mark, and the animation over it.
 *
 * The mark is what is on screen for the first few milliseconds, while the
 * animation is being asked for -- and it is what stays if the answer never
 * comes or the video will not decode. So there is never an empty box, and
 * there is no second animation to keep in step with the first.
 */
.stage { position: relative; width: 88px; height: 88px; }
.mark, .art {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
.mark svg { width: 100%; height: 100%; display: block; }
.art { opacity: 0; transition: opacity 180ms ease-out; object-fit: contain; }

/* Swapped only once the video can actually play, so a decode that fails leaves
   the mark where it was rather than replacing it with nothing. */
.stage--art .art { opacity: 1; }
.stage--art .mark { opacity: 0; }

.label {
  min-height: 18px;
  font-size: 13px;
  line-height: 18px;
  letter-spacing: .2px;
  color: var(--dt_color-content-ter, rgba(209, 210, 211, .62));
}

/*
 * Reduced motion is honoured by never asking for the video at all, since CSS
 * cannot stop one playing -- see wantsStillness below. What is left is the
 * still mark, breathing, which says "working" without moving anything.
 *
 * The Motion mod deliberately ignores this setting. Installing a mod called
 * Motion is a statement of intent about animation; starting Slack is not.
 *
 * No backticks anywhere in this string, comments included: one closes the
 * template literal and the runtime throws at boot with nothing styled to show
 * for it.
 */
@media (prefers-reduced-motion: reduce) {
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

/** True when the machine has asked for as little movement as possible. */
function wantsStillness(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
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
export function showSplash(art?: Promise<string | null>): Splash {
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
      const stage = document.createElement('div');
      stage.className = 'stage';
      const mark = document.createElement('div');
      mark.className = 'mark';
      mark.innerHTML = MARK_SVG;
      stage.append(mark);
      void playArt(stage);
      label = document.createElement('div');
      label.className = 'label';
      // Asked for again here rather than trusted from above: the first attempt
      // happened at document-start, where there is no <html> to read a language
      // off and the translator answers with nothing.
      label.textContent = pending || t('splashLoading');
      root.append(style, stage, label);
      document.body.append(host);
    } catch {
      // A splash that throws must cost nothing: the app behind it is fine.
      host = null;
    }
  };

  /**
   * Put the animation over the mark, once there is one and it will play.
   *
   * Never awaited by anything that matters, and every step of it is allowed to
   * come to nothing: the still mark underneath is the whole fallback, so a
   * refused request, a codec that is gone or a screen that has already lifted
   * all end the same way -- with what was already on screen.
   */
  const playArt = async (stage: HTMLElement): Promise<void> => {
    // CSS cannot stop a video playing, so the setting is honoured by not asking
    // for one. The mark breathes instead.
    if (!art || wantsStillness()) return;
    let base64: string | null = null;
    try {
      base64 = await art;
    } catch {
      return;
    }
    if (!base64 || finished || !stage.isConnected) return;

    const video = document.createElement('video');
    video.className = 'art';
    video.muted = true;
    video.loop = true;
    video.autoplay = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('aria-hidden', 'true');
    /*
     * A data: URL rather than a blob:, and both were measured against a live
     * client -- Slack's policy names base-uri, object-src and script-src and no
     * default-src, so media is unrestricted and either works. This one needs
     * nothing revoking afterwards.
     */
    video.src = `data:video/webm;base64,${base64}`;
    // Only then is the mark swapped out: a video that cannot decode leaves the
    // mark on screen rather than an empty square.
    video.addEventListener('canplay', () => stage.classList.add('stage--art'), { once: true });
    stage.append(video);
    /*
     * Optional-chained on purpose: `play()` returns a promise in a browser and
     * nothing at all where media is not implemented, and an autoplay that is
     * refused is not a failure worth reporting -- the video is muted and looping
     * and the still mark is underneath it either way.
     */
    try {
      void video.play()?.catch(() => undefined);
    } catch {
      // Same again: there is nothing to do about it and nothing to say.
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
