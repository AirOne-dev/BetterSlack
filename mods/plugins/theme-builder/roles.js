// The twelve roles, and the CSS they become.
//
// A theme is asked for a background and an accent; the other ten are derived
// from how far each surface should sit from the background and how much
// contrast text needs against it. Choosing is the hard part -- the rest is
// arithmetic, and the arithmetic reverses for a light background, which is why
// a light theme built by hand usually looks wrong on the first try.
//
// buildThemeCss is where the roles meet Slack's four token families. Read
// tokens.js first if you are changing it: what a value has to look like, and
// whether it needs !important, depends on which family it lands in.

import { formatCss, formatTriplet, luminance } from './colour.js';
import { tokenCss } from './tokens.js';

/**
 * The twelve, in the order they are shown. Label and hint are i18n keys
 * (`role_bg`, `role_bg_hint`): a role named in English inside an otherwise
 * French window is the kind of seam that makes a tool feel bolted together.
 */
export const ROLES = [
  { key: 'bg', seed: true },
  { key: 'accent', seed: true },
  { key: 'chrome' },
  { key: 'raised' },
  { key: 'surface' },
  { key: 'selected' },
  { key: 'hover' },
  { key: 'text' },
  { key: 'bright' },
  { key: 'muted' },
  { key: 'accentText' },
  { key: 'danger' },
];

/**
 * The pairs worth checking, and they are pairs the app really puts together.
 * A ratio against a colour Slack never places behind that text is a number that
 * looks like diligence and means nothing.
 */
export const CONTRAST_CHECKS = [
  ['text', 'bg', 'checkMessage'],
  ['muted', 'bg', 'checkTimestamps'],
  ['bright', 'chrome', 'checkSidebar'],
  ['accentText', 'bg', 'checkMentions'],
];

/**
 * The whole stylesheet: derived roles, then hand-picked tokens, then whatever
 * was typed by hand. Later wins, which is what "override" has to mean.
 */
export function buildThemeCss(palette, name = 'Custom', extra = '', tokens = {}) {
  // Named for what they emit, not for brevity: `t` in every other file of this
  // mod is the translator, and a second meaning for it here reads as a bug.
  const hex = (key) => formatCss(palette[key]);
  const rgb = (key) => formatTriplet(palette[key]);
  const dark = luminance(palette.bg) < 0.4;
  return `/*
 * ${name} — built with BetterSlack's theme builder.
 *
 * Twelve roles across the four families Slack paints from. The chrome
 * (--dt_color-theme-*) and legacy (--sk_*) families need !important because
 * Slack sets them on more specific selectors; the legacy one takes bare
 * "r, g, b" triplets, which is why any alpha is dropped there and only there.
 */

:root,
.sk-client-theme--light,
.sk-client-theme--dark {
  --dt_color-base-pry: ${hex('bg')};
  --dt_color-base-sec: ${hex('raised')};
  --dt_color-base-ter: ${hex('surface')};
  --dt_color-base-modal: rgba(0, 0, 0, ${dark ? '0.8' : '0.4'});

  --dt_color-base-pry-hover: ${hex('hover')};
  --dt_color-base-pry-pressed: ${hex('surface')};
  --dt_color-base-sec-hover: ${hex('surface')};
  --dt_color-base-sec-pressed: ${hex('selected')};
  --dt_color-base-ter-hover: ${hex('selected')};
  --dt_color-base-ter-pressed: ${hex('selected')};

  --dt_color-content-pry: ${hex('text')};
  --dt_color-content-sec: ${hex('muted')};
  --dt_color-content-ter: ${hex('muted')};

  --dt_color-otl-pry: ${hex('surface')};
  --dt_color-otl-sec: ${hex('surface')};
  --dt_color-otl-ter: ${hex('surface')};

  --dt_color-content-hgl-1: ${hex('accentText')};
  --dt_color-content-imp: ${hex('danger')};
  --dt_color-base-hgl-1: ${hex('selected')};

  --dt_color-base-inv-pry: ${hex('chrome')};
  --dt_color-content-inv-pry: ${hex('bright')};
  --dt_color-content-inv-sec: ${hex('muted')};
}

/* Chrome and legacy families; both need !important. */
:root,
.sk-client-theme--light,
.sk-client-theme--dark {
  --dt_color-theme-base-inv-pry: ${hex('chrome')} !important;
  --dt_color-theme-base-inv-sec: ${hex('chrome')} !important;
  --dt_color-theme-content-inv-pry: ${hex('bright')} !important;
  --dt_color-theme-content-inv-sec: ${hex('muted')} !important;
  --dt_color-theme-content-inv-ter: ${hex('muted')} !important;
  --dt_color-theme-otl-inv-pry: ${hex('surface')} !important;

  --dt_color-theme-surf-inv-pry: ${hex('selected')} !important;
  --dt_color-theme-surf-inv-sec: ${hex('chrome')} !important;
  --dt_color-theme-surf-inv-ter: ${hex('hover')} !important;
  --dt_color-theme-surf-pry: ${hex('selected')} !important;
  --dt_color-theme-surf-sec: ${hex('hover')} !important;
  --dt_color-theme-surf-ter: ${hex('bg')} !important;

  --dt_color-theme-base-pry: ${hex('bg')} !important;
  --dt_color-theme-base-sec: ${hex('raised')} !important;
  --dt_color-theme-base-hgl-1: ${hex('selected')} !important;
  --dt_color-theme-content-pry: ${hex('text')} !important;
  --dt_color-theme-content-sec: ${hex('muted')} !important;
  --dt_color-theme-content-ter: ${hex('muted')} !important;

  --sk_primary_background: ${rgb('bg')} !important;
  --sk_primary_foreground: ${rgb('text')} !important;
  --sk_inverted_background: ${rgb('text')} !important;
  --sk_inverted_foreground: ${rgb('bg')} !important;
  --sk_foreground_max: ${rgb('bright')} !important;
  --sk_foreground_high: ${rgb('text')} !important;
  --sk_foreground_mid: ${rgb('muted')} !important;
  --sk_foreground_low: ${rgb('muted')} !important;
  --sk_foreground_min: ${rgb('muted')} !important;
  --sk_foreground_max_solid: ${rgb('bright')} !important;
  --sk_foreground_high_solid: ${rgb('muted')} !important;
  --sk_foreground_mid_solid: ${rgb('selected')} !important;
  --sk_foreground_low_solid: ${rgb('surface')} !important;
  --sk_foreground_min_solid: ${rgb('raised')} !important;
  --sk_highlight: ${rgb('accent')} !important;
  --sk_highlight_hover: ${rgb('accentText')} !important;
  --sk_highlight_accent: ${rgb('accent')} !important;
}

html, body { background-color: ${hex('bg')}; }
/* A full-viewport opaque layer sits above <body>; without this nothing shows. */
.p-theme_background { background: ${hex('bg')} !important; }

.p-tab_rail,
.p-channel_sidebar,
.p-ia4_home_header { background: ${hex('chrome')} !important; border: none !important; }

.p-client_container,
.p-message_pane,
.p-view_contents { background: ${hex('bg')} !important; }
${tokenCss(tokens)}${extra ? `\n/* Your own rules. */\n${extra}\n` : ''}`;
}


let roleTargets = null;

function buildRoleTargets() {
  const sentinels = new Map();
  const palette = {};
  ROLES.forEach((role, index) => {
    // One channel each, so a triplet and a hex both stay unambiguous.
    palette[role.key] = { r: index + 1, g: 0, b: 0, a: 1 };
    sentinels.set(formatCss(palette[role.key]), role.key);
    sentinels.set(formatTriplet(palette[role.key]), role.key);
  });

  const targets = new Map(ROLES.map((role) => [role.key, { tokens: [], selectors: [] }]));
  const css = buildThemeCss(palette).replace(/\/\*[\s\S]*?\*\//g, '');

  // Blocks, so a declaration can be attributed to the selector above it: a
  // role reaches Slack both through tokens and through the handful of rules
  // this file writes directly (the rail, the sidebar, the opaque layer over
  // <body>), and hovering "Chrome" has to light up the rail either way.
  for (const [, selectorText, declarations] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    for (const [, property, value] of declarations.matchAll(/([\w-]+)\s*:\s*([^;!]+)/g)) {
      const owner = sentinels.get(value.trim());
      if (!owner) continue;
      const target = targets.get(owner);
      if (property.startsWith('--')) target.tokens.push(property);
      else {
        for (const part of selectorText.split(',')) {
          const selector = part.trim();
          if (selector && !selector.startsWith('@')) target.selectors.push(selector);
        }
      }
    }
  }
  return targets;
}

/**
 * Everything a role reaches: the tokens it writes, and the selectors this file
 * paints directly.
 *
 * Worked out by generating the stylesheet with a sentinel colour per role and
 * reading back which declaration got which sentinel, rather than by keeping a
 * second table beside buildThemeCss. A hand-written map would be correct on the
 * day it was written and quietly wrong after the next edit above.
 */
export function targetsForRole(key) {
  if (!roleTargets) roleTargets = buildRoleTargets();
  return roleTargets.get(key) ?? { tokens: [], selectors: [] };
}

/** Just the token names, for callers that only need those. */
export function tokensForRole(key) {
  return targetsForRole(key).tokens;
}
