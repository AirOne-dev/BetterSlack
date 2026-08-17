// Reading a theme back into colours.
//
// A theme is a stylesheet, and this is the only way to answer two questions the
// builder cannot work without: what does this theme look like (the gallery
// cards), and what should the palette start at when you choose it as a base.
//
// Two things make it less obvious than reading declarations. Themes almost
// never write a colour into Slack's tokens -- they name their own colour once
// and point Slack's tokens at it, so `--dt_color-base-pry: var(--dc-chat)` has
// to be followed inside the file before anything can be painted. And `--sk_*`
// and `--dt_color-plt-*` hold a bare "r, g, b" triplet, which is not a colour
// until it is wrapped.

import { parseColour } from './colour.js';

/** Something that can actually be painted, rather than something CSS-shaped. */
const PAINTABLE = /^(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(|[a-z]{3,20}$)/;

/**
 * Every custom property a stylesheet declares, resolved to a real colour.
 *
 * Later declarations win, which is what the cascade would do with a file read
 * top to bottom. Anything that cannot be resolved is left out rather than
 * passed on: a value nobody can paint is worse than a missing one, because it
 * looks like a colour right up until it is on screen.
 */
export function declaredColours(css) {
  const declared = new Map();
  for (const [, name, value] of css.matchAll(/(--[\w-]+)\s*:\s*([^;!}]+)/g)) {
    const text = value.trim();
    if (text) declared.set(name, text);
  }

  const resolve = (value, depth = 0) => {
    if (depth > 4) return null; // a cycle, or a reference to something absent
    const text = value.trim();
    if (/^\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}$/.test(text)) return `rgb(${text})`;
    const reference = /^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)$/.exec(text);
    if (reference) {
      const target = declared.get(reference[1]);
      if (target) return resolve(target, depth + 1);
      return reference[2] ? resolve(reference[2], depth + 1) : null;
    }
    return PAINTABLE.test(text) ? text : null;
  };

  const colours = new Map();
  for (const [name, value] of declared) {
    const resolved = resolve(value);
    if (resolved) colours.set(name, resolved);
  }
  return colours;
}

/**
 * Which of Slack's tokens each of the twelve roles should be read from.
 *
 * In order, first hit wins. More than one because themes differ in how far they
 * go: a thorough one sets the chrome family, a light-touch one only sets
 * content, and both should still open with their own colours rather than
 * somebody else's.
 */
const ROLE_SOURCES = {
  bg: ['--dt_color-base-pry', '--sk_primary_background', '--dt_color-theme-base-pry'],
  accent: ['--sk_highlight', '--dt_color-content-hgl-1', '--dt_color-accent'],
  chrome: ['--dt_color-theme-base-inv-pry', '--dt_color-base-inv-pry', '--dt_color-theme-base-sec'],
  raised: ['--dt_color-base-sec', '--dt_color-theme-base-sec'],
  surface: ['--dt_color-base-ter', '--dt_color-otl-pry'],
  selected: ['--dt_color-base-hgl-1', '--dt_color-theme-surf-pry', '--dt_color-base-sec-pressed'],
  hover: ['--dt_color-base-pry-hover', '--dt_color-theme-surf-sec'],
  text: ['--dt_color-content-pry', '--sk_primary_foreground'],
  bright: ['--dt_color-theme-content-inv-pry', '--sk_foreground_max', '--dt_color-content-inv-pry'],
  muted: ['--dt_color-content-sec', '--sk_foreground_mid'],
  accentText: ['--dt_color-content-hgl-1', '--sk_highlight'],
  danger: ['--dt_color-content-imp', '--dt_color-danger'],
};

/** The five worth showing on a gallery card, in the order they read best. */
const STRIP = ['chrome', 'bg', 'raised', 'text', 'accentText'];

/**
 * The twelve roles, as far as a stylesheet says anything about them.
 *
 * Only what the theme really declares: a role it says nothing about is left
 * out, so the builder can derive that one instead of inventing a colour and
 * claiming the theme asked for it.
 */
export function rolesFrom(css) {
  const colours = declaredColours(css);
  const roles = {};
  for (const [role, sources] of Object.entries(ROLE_SOURCES)) {
    for (const name of sources) {
      const value = colours.get(name);
      const parsed = value && parseColour(value);
      if (parsed) {
        roles[role] = parsed;
        break;
      }
    }
  }
  return roles;
}

/** The colours to show on a theme's card. */
export function stripFrom(css) {
  const roles = rolesFrom(css);
  const strip = STRIP.map((role) => roles[role]).filter(Boolean);
  if (strip.length) return strip;

  // A theme that names none of them still has colours in it -- focus-rings sets
  // outlines and nothing else. What is literally in the file is a truer answer
  // than a blank card.
  const literals = [...css.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((match) => match[0]);
  return [...new Set(literals)].slice(0, 5).map((hex) => parseColour(hex)).filter(Boolean);
}

/**
 * The same twelve, read off the running client instead of a file.
 *
 * What "Slack's own colours" means, literally: whatever the app is painting
 * with once the user's themes are held back. Slack changes these between
 * releases and there is no list of them anywhere, so asking the page is the
 * only answer that stays true.
 */
export function rolesFromClient(doc = document) {
  const computed = doc.defaultView.getComputedStyle(doc.documentElement);
  const roles = {};
  for (const [role, sources] of Object.entries(ROLE_SOURCES)) {
    for (const name of sources) {
      const raw = computed.getPropertyValue(name).trim();
      if (!raw) continue;
      const value = /^\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}$/.test(raw) ? `rgb(${raw})` : raw;
      const parsed = parseColour(value);
      if (parsed) {
        roles[role] = parsed;
        break;
      }
    }
  }
  return roles;
}
