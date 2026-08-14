// Slack's colour tokens, as they are in the running client.
//
// There is no manifest of these anywhere: the only honest source is the page
// itself. So the sheets are walked for custom-property declarations, and the
// computed value of each is read off the root -- which is what the app actually
// paints with, cascade already resolved.
//
// Four families, and they do not behave the same way. That is not a
// classification anyone invented for tidiness; it decides what a theme has to
// write for a token to take effect:
//
//   --dt_color-<role>    content: messages, controls, text.   Plain colour.
//   --dt_color-theme-*   chrome: rail, sidebar, headers.      Needs !important.
//   --sk_*               legacy components.                   Bare "r, g, b",
//                                                             needs !important.
//   --dt_color-plt-*     the raw palette everything else
//                        is built from.                       Bare "r, g, b".
//
// Writing a colour into a triplet family paints nothing at all, and the failure
// is silent -- the rule parses, the value is simply never used. Hence `kind`,
// and hence formatFor() rather than one formatter.

import { formatCss, formatTriplet, parseColour } from './colour.js';

export const FAMILIES = [
  { key: 'chrome', label: 'Chrome', match: (n) => n.startsWith('--dt_color-theme-'), important: true },
  { key: 'palette', label: 'Palette', match: (n) => n.startsWith('--dt_color-plt-'), important: false },
  { key: 'content', label: 'Content', match: (n) => n.startsWith('--dt_color-'), important: false },
  { key: 'legacy', label: 'Legacy', match: (n) => n.startsWith('--sk_'), important: true },
  { key: 'other', label: 'Other', match: () => true, important: false },
];

/** Which family a token belongs to. Order matters: theme- and plt- before the general dt_color-. */
export function familyOf(name) {
  return FAMILIES.find((family) => family.match(name)) ?? FAMILIES[FAMILIES.length - 1];
}

const TRIPLET = /^\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*$/;

/**
 * What shape a value has, which is what a theme must write back.
 *
 * `triplet` is the trap: it looks like nothing, it is what --sk_* and
 * --dt_color-plt-* hold, and giving one of them a real colour is a no-op.
 */
export function kindOf(value) {
  if (TRIPLET.test(value)) return 'triplet';
  if (parseColour(value)) return 'colour';
  return 'other';
}

/** A token's value written the way its own family expects it. */
export function formatFor(kind, colour) {
  return kind === 'triplet' ? formatTriplet(colour) : formatCss(colour);
}

/** A token's value as something paintable, for a swatch. */
export function swatch(value) {
  return kindOf(value) === 'triplet' ? `rgb(${value})` : value;
}

/**
 * Every colour token the client defines, resolved.
 *
 * Cross-origin sheets throw on `cssRules` and are skipped; Slack's own are
 * same-origin, which is the only reason this works at all. Names are collected
 * from the sheets rather than guessed, so a Slack release that adds tokens is
 * picked up with no change here.
 */
export function collectTokens(doc = document) {
  const names = new Set();

  const walk = (rules) => {
    for (const rule of rules) {
      if (rule.cssRules) walk(rule.cssRules); // @media, @supports, @layer
      if (!rule.style) continue;
      for (const property of rule.style) {
        if (property.startsWith('--')) names.add(property);
      }
    }
  };

  for (const sheet of doc.styleSheets) {
    try {
      walk(sheet.cssRules);
    } catch {
      continue; // another origin, and not ours to read
    }
  }

  const root = doc.documentElement;
  const computed = doc.defaultView.getComputedStyle(root);
  const tokens = [];
  for (const name of names) {
    const value = computed.getPropertyValue(name).trim();
    if (!value) continue;
    const kind = kindOf(value);
    // A theme builder edits colours. Durations, shadows and z-indexes are
    // tokens too, and listing them would bury the ones worth touching.
    if (kind === 'other') continue;
    tokens.push({ name, value, kind, family: familyOf(name).key });
  }

  return tokens.sort((a, b) => a.name.localeCompare(b.name));
}

/** Free-text filter over names, matching every word, in any order. */
export function search(tokens, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return tokens;
  return tokens.filter((token) => {
    const haystack = `${token.name} ${token.family}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/**
 * The override block for hand-picked tokens.
 *
 * Written last and, for the two families that need it, with !important: Slack
 * sets those on more specific selectors than :root, so a plain declaration
 * loses. The value is taken verbatim -- whoever edited it has already been
 * given a picker that formats for the right family.
 */
export function tokenCss(overrides) {
  const names = Object.keys(overrides);
  if (!names.length) return '';
  const lines = names.sort().map((name) => {
    const bang = familyOf(name).important ? ' !important' : '';
    return `  ${name}: ${overrides[name]}${bang};`;
  });
  return `\n/* Tokens taken over one by one. */\n:root,\n.sk-client-theme--light,\n.sk-client-theme--dark {\n${lines.join('\n')}\n}\n`;
}
