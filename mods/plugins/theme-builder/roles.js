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

export const ROLES = [
  { key: 'bg', label: 'Background', hint: 'The conversation', seed: true },
  { key: 'accent', label: 'Accent', hint: 'Links, focus, active tab', seed: true },
  { key: 'chrome', label: 'Chrome', hint: 'Rail and sidebar' },
  { key: 'raised', label: 'Raised', hint: 'Composer, menus' },
  { key: 'surface', label: 'Surface', hint: 'Dividers, pills' },
  { key: 'selected', label: 'Selected', hint: 'Open channel' },
  { key: 'hover', label: 'Hover', hint: 'Row under the pointer' },
  { key: 'text', label: 'Text', hint: 'Message body' },
  { key: 'bright', label: 'Headings', hint: 'Names and titles' },
  { key: 'muted', label: 'Muted', hint: 'Timestamps' },
  { key: 'accentText', label: 'Accent text', hint: 'Mentions' },
  { key: 'danger', label: 'Danger', hint: 'Badges' },
];

/**
 * The pairs worth checking, and they are pairs the app really puts together.
 * A ratio against a colour Slack never places behind that text is a number that
 * looks like diligence and means nothing.
 */
export const CONTRAST_CHECKS = [
  ['text', 'bg', 'Message text'],
  ['muted', 'bg', 'Timestamps'],
  ['bright', 'chrome', 'Sidebar titles'],
  ['accentText', 'bg', 'Mentions'],
];

/**
 * The whole stylesheet: derived roles, then hand-picked tokens, then whatever
 * was typed by hand. Later wins, which is what "override" has to mean.
 */
export function buildThemeCss(palette, name = 'Custom', extra = '', tokens = {}) {
  const c = (key) => formatCss(palette[key]);
  const t = (key) => formatTriplet(palette[key]);
  const dark = luminance(palette.bg) < 0.4;
  return `/*
 * ${name} — built with SlackMod's theme builder.
 *
 * Twelve roles across the four families Slack paints from. The chrome
 * (--dt_color-theme-*) and legacy (--sk_*) families need !important because
 * Slack sets them on more specific selectors; the legacy one takes bare
 * "r, g, b" triplets, which is why any alpha is dropped there and only there.
 */

:root,
.sk-client-theme--light,
.sk-client-theme--dark {
  --dt_color-base-pry: ${c('bg')};
  --dt_color-base-sec: ${c('raised')};
  --dt_color-base-ter: ${c('surface')};
  --dt_color-base-modal: rgba(0, 0, 0, ${dark ? '0.8' : '0.4'});

  --dt_color-base-pry-hover: ${c('hover')};
  --dt_color-base-pry-pressed: ${c('surface')};
  --dt_color-base-sec-hover: ${c('surface')};
  --dt_color-base-sec-pressed: ${c('selected')};
  --dt_color-base-ter-hover: ${c('selected')};
  --dt_color-base-ter-pressed: ${c('selected')};

  --dt_color-content-pry: ${c('text')};
  --dt_color-content-sec: ${c('muted')};
  --dt_color-content-ter: ${c('muted')};

  --dt_color-otl-pry: ${c('surface')};
  --dt_color-otl-sec: ${c('surface')};
  --dt_color-otl-ter: ${c('surface')};

  --dt_color-content-hgl-1: ${c('accentText')};
  --dt_color-content-imp: ${c('danger')};
  --dt_color-base-hgl-1: ${c('selected')};

  --dt_color-base-inv-pry: ${c('chrome')};
  --dt_color-content-inv-pry: ${c('bright')};
  --dt_color-content-inv-sec: ${c('muted')};
}

/* Chrome and legacy families; both need !important. */
:root,
.sk-client-theme--light,
.sk-client-theme--dark {
  --dt_color-theme-base-inv-pry: ${c('chrome')} !important;
  --dt_color-theme-base-inv-sec: ${c('chrome')} !important;
  --dt_color-theme-content-inv-pry: ${c('bright')} !important;
  --dt_color-theme-content-inv-sec: ${c('muted')} !important;
  --dt_color-theme-content-inv-ter: ${c('muted')} !important;
  --dt_color-theme-otl-inv-pry: ${c('surface')} !important;

  --dt_color-theme-surf-inv-pry: ${c('selected')} !important;
  --dt_color-theme-surf-inv-sec: ${c('chrome')} !important;
  --dt_color-theme-surf-inv-ter: ${c('hover')} !important;
  --dt_color-theme-surf-pry: ${c('selected')} !important;
  --dt_color-theme-surf-sec: ${c('hover')} !important;
  --dt_color-theme-surf-ter: ${c('bg')} !important;

  --dt_color-theme-base-pry: ${c('bg')} !important;
  --dt_color-theme-base-sec: ${c('raised')} !important;
  --dt_color-theme-base-hgl-1: ${c('selected')} !important;
  --dt_color-theme-content-pry: ${c('text')} !important;
  --dt_color-theme-content-sec: ${c('muted')} !important;
  --dt_color-theme-content-ter: ${c('muted')} !important;

  --sk_primary_background: ${t('bg')} !important;
  --sk_primary_foreground: ${t('text')} !important;
  --sk_inverted_background: ${t('text')} !important;
  --sk_inverted_foreground: ${t('bg')} !important;
  --sk_foreground_max: ${t('bright')} !important;
  --sk_foreground_high: ${t('text')} !important;
  --sk_foreground_mid: ${t('muted')} !important;
  --sk_foreground_low: ${t('muted')} !important;
  --sk_foreground_min: ${t('muted')} !important;
  --sk_foreground_max_solid: ${t('bright')} !important;
  --sk_foreground_high_solid: ${t('muted')} !important;
  --sk_foreground_mid_solid: ${t('selected')} !important;
  --sk_foreground_low_solid: ${t('surface')} !important;
  --sk_foreground_min_solid: ${t('raised')} !important;
  --sk_highlight: ${t('accent')} !important;
  --sk_highlight_hover: ${t('accentText')} !important;
  --sk_highlight_accent: ${t('accent')} !important;
}

html, body { background-color: ${c('bg')}; }
/* A full-viewport opaque layer sits above <body>; without this nothing shows. */
.p-theme_background { background: ${c('bg')} !important; }

.p-tab_rail,
.p-channel_sidebar,
.p-ia4_home_header { background: ${c('chrome')} !important; border: none !important; }

.p-client_container,
.p-message_pane,
.p-view_contents { background: ${c('bg')} !important; }
${tokenCss(tokens)}${extra ? `\n/* Your own rules. */\n${extra}\n` : ''}`;
}

