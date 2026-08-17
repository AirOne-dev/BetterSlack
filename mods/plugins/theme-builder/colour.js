// Colour, for the theme builder.
//
// The part with rules rather than opinions: parsing, formatting, contrast, and
// the relationships that turn two chosen colours into a palette of twelve. All
// pure, so all testable without a browser -- and in its own file, now that a mod
// is a folder rather than a single script.

/**
 * Colour is carried as {r, g, b, a}, a in 0..1.
 *
 * Two formats come out the other end and the difference matters: Slack's
 * modern families take a CSS colour, so alpha survives, while its legacy
 * `--sk_*` family takes a bare "r, g, b" triplet with nowhere to put alpha at
 * all. A theme that hands rgba() to the legacy family paints nothing.
 */
export function parseColour(input) {
  const text = String(input ?? '').trim();
  const hex = text.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    let digits = hex[1];
    if (digits.length === 3 || digits.length === 4) digits = [...digits].map((d) => d + d).join('');
    if (digits.length !== 6 && digits.length !== 8) return null;
    const n = parseInt(digits.slice(0, 6), 16);
    const a = digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a };
  }
  const fn = text.match(/^rgba?\(([^)]+)\)$/i);
  if (fn) {
    const parts = fn[1].split(/[,/]/).map((p) => parseFloat(p));
    if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null;
    const a = parts.length > 3 && !Number.isNaN(parts[3]) ? parts[3] : 1;
    const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
    return { r: clamp(parts[0]), g: clamp(parts[1]), b: clamp(parts[2]), a: Math.max(0, Math.min(1, a)) };
  }
  return null;
}

export function formatCss({ r, g, b, a }) {
  if (a >= 1) return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
  return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`;
}

export function formatHex({ r, g, b }) {
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

/** Alpha is dropped here, deliberately: the legacy family has nowhere for it. */
export function formatTriplet({ r, g, b }) {
  return `${r}, ${g}, ${b}`;
}

export function flatten(colour, backdrop) {
  if (colour.a >= 1) return { ...colour, a: 1 };
  const a = colour.a;
  return {
    r: Math.round(colour.r * a + backdrop.r * (1 - a)),
    g: Math.round(colour.g * a + backdrop.g * (1 - a)),
    b: Math.round(colour.b * a + backdrop.b * (1 - a)),
    a: 1,
  };
}

function channel(value) {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function luminance({ r, g, b }) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG ratio, 1 to 21. Translucent foregrounds are flattened first. */
export function contrast(foreground, background) {
  const fg = flatten(foreground, background);
  const [light, dark] = [luminance(fg), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

export function readability(ratio) {
  if (ratio >= 7) return { grade: 'AAA', ok: true };
  if (ratio >= 4.5) return { grade: 'AA', ok: true };
  if (ratio >= 3) return { grade: 'AA Large', ok: false };
  return { grade: 'Fail', ok: false };
}

export function toHsv({ r, g, b, a = 1 }) {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const d = max - Math.min(rn, gn, bn);
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max, a };
}

export function fromHsv({ h, s, v, a = 1 }) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255), a };
}

export function shade(colour, amount) {
  const target = amount >= 0 ? 255 : 0;
  const k = Math.abs(amount);
  return {
    r: Math.round(colour.r + (target - colour.r) * k),
    g: Math.round(colour.g + (target - colour.g) * k),
    b: Math.round(colour.b + (target - colour.b) * k),
    a: colour.a,
  };
}

/** Twelve roles from two decisions. The direction reverses on a light base. */
export function derivePalette(background, accent) {
  const dark = luminance(background) < 0.4;
  const step = (amount) => shade(background, dark ? amount : -amount);
  return {
    bg: background,
    raised: step(0.05),
    chrome: dark ? shade(background, -0.35) : shade(background, -0.06),
    surface: step(0.1),
    selected: step(0.13),
    hover: step(0.03),
    text: dark ? shade(background, 0.92) : shade(background, -0.85),
    bright: dark ? shade(background, 0.98) : shade(background, -0.95),
    muted: dark ? shade(background, 0.5) : shade(background, -0.45),
    accent,
    accentText: dark ? shade(accent, 0.45) : shade(accent, -0.25),
    danger: dark ? { r: 221, g: 61, b: 72, a: 1 } : { r: 192, g: 19, b: 67, a: 1 },
  };
}

