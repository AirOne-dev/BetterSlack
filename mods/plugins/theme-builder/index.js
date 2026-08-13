// A theme workbench, in a window of its own.
//
// WHY A SEPARATE WINDOW
//
// A theme is judged against the whole app, and a panel covering half of it
// hides the thing being judged. `window.open` works from Slack's renderer and
// the child inherits the origin, so parent and child hold direct references to
// each other: the controls live in the new window and call straight into this
// module. No message passing, no serialisation, and the preview is the real
// application. The window marks itself with `data-slackmod-window`, which the
// loader checks before painting a theme into Slack's other windows -- a builder
// repainted by the theme being edited becomes unreadable exactly when you need
// to read it.
//
// WHY IT ASKS FOR TWO COLOURS AND NOT TWELVE
//
// The first version put twelve pickers in a column and called it a tool. It was
// a spreadsheet. This one asks for a background and an accent, derives the other
// ten from how far each surface should sit from the background and how much
// contrast text needs against it, and lets any of them be overridden
// afterwards. Choosing is the hard part; the rest is arithmetic, and the
// arithmetic reverses for a light background, which is why a light theme built
// by hand usually looks wrong on the first try.
//
// EVERYTHING IS SHOWN, NOTHING IS DESCRIBED
//
// Beside the palette are the pieces of Slack each role actually paints -- a
// channel row, a message, a mention, a badge, the composer -- rendered from the
// current values, plus the contrast ratios that decide whether the result is
// readable. The real app updates too, but you should not have to look away to
// see what a colour did.
//
// The colour maths lives in ./colour.js. That import is the reason mods became
// folders: a blob URL has no directory, so the runtime rewrites relative
// specifiers to the blob it built for each file before loading the entry.

import {
  contrast, derivePalette, formatCss, formatTriplet, fromHsv,
  luminance, parseColour, readability, toHsv,
} from './colour.js';

import { STRINGS } from './strings.js';

// Re-exported for this mod's own tests, which assert on the colour maths
// through the entry the app loads.
export { contrast, derivePalette, formatCss, formatTriplet, parseColour, readability } from './colour.js';

const WINDOW_NAME = 'slackmod-theme-builder';
const OVERLAY_ID = 'slackmod-inspect-overlay';

// ---------------------------------------------------------------- roles

const ROLES = [
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

const CONTRAST_CHECKS = [
  ['text', 'bg', 'Message text'],
  ['muted', 'bg', 'Timestamps'],
  ['bright', 'chrome', 'Sidebar titles'],
  ['accentText', 'bg', 'Mentions'],
];

const PALETTE_ICON =
  '<svg viewBox="0 0 20 20" aria-hidden="true" style="height:20px;width:20px">' +
  '<path fill="currentColor" d="M10 2.5a7.5 7.5 0 0 0 0 15c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1a1.5 1.5 0 0 1 1.09-2.5h1.8A4.5 4.5 0 0 0 18.5 8c0-3.03-3.81-5.5-8.5-5.5M4 10a6 6 0 0 1 6-6c3.95 0 7 2.02 7 4a3 3 0 0 1-3 3h-1.8a3 3 0 0 0-2.18 5.06.5.5 0 0 1-.52.44A6 6 0 0 1 4 10"/>' +
  '<circle cx="6.75" cy="9.75" r="1.25" fill="currentColor"/><circle cx="9.25" cy="6.25" r="1.25" fill="currentColor"/>' +
  '<circle cx="13.25" cy="6.75" r="1.25" fill="currentColor"/></svg>';

/** Rules that match an element, by walking the sheets: there is no API for it. */
export function matchedRules(element, sheets) {
  const out = [];
  for (const sheet of sheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // another origin, and not ours to read
    }
    for (const rule of rules) {
      if (!rule.selectorText) continue;
      for (const part of rule.selectorText.split(',')) {
        const selector = part.trim();
        if (!selector) continue;
        let hit = false;
        try {
          hit = element.matches(selector);
        } catch {
          continue;
        }
        if (hit) {
          out.push({ selector, text: rule.style.cssText });
          break;
        }
      }
    }
  }
  return out;
}

export function variablesIn(rules, resolve) {
  const names = new Set();
  for (const rule of rules) {
    for (const match of String(rule.text).matchAll(/var\((--[\w-]+)/g)) names.add(match[1]);
  }
  return [...names].sort().map((name) => ({ name, value: resolve(name) }));
}

export function buildThemeCss(palette, name = 'Custom', extra = '') {
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
${extra ? `\n/* Your own rules. */\n${extra}\n` : ''}`;
}

export default {
  async start(api) {
    const t = api.i18n.strings(STRINGS);
    let child = null;
    let stopPicking = null;
    const marks = [];

    const clearMarks = () => { while (marks.length) marks.pop().remove(); };

    const overlay = () => {
      let node = document.getElementById(OVERLAY_ID);
      if (!node) {
        node = api.dom.h('div', { id: OVERLAY_ID });
        Object.assign(node.style, {
          position: 'fixed', pointerEvents: 'none', zIndex: '99999',
          border: '2px solid #6b7cf0', background: 'rgba(107,124,240,.18)',
          borderRadius: '3px', display: 'none',
        });
        document.body.append(node);
      }
      return node;
    };

    const startPicking = (onPicked) => {
      stopPicking?.();
      const node = overlay();
      const move = (event) => {
        const rect = event.target?.getBoundingClientRect?.();
        if (!rect) return;
        Object.assign(node.style, {
          display: 'block', left: `${rect.left}px`, top: `${rect.top}px`,
          width: `${rect.width}px`, height: `${rect.height}px`,
        });
      };
      const click = (event) => { event.preventDefault(); event.stopPropagation(); stop(); onPicked(event.target); };
      const key = (event) => { if (event.key === 'Escape') stop(); };
      const stop = () => {
        document.removeEventListener('mousemove', move, true);
        document.removeEventListener('click', click, true);
        document.removeEventListener('keydown', key, true);
        node.style.display = 'none';
        stopPicking = null;
      };
      // Capture, so choosing a channel row does not also open that channel.
      document.addEventListener('mousemove', move, true);
      document.addEventListener('click', click, true);
      document.addEventListener('keydown', key, true);
      stopPicking = stop;
    };

    const markAll = (selector) => {
      clearMarks();
      let elements = [];
      try { elements = [...document.querySelectorAll(selector)]; } catch { return 0; }
      for (const element of elements.slice(0, 300)) {
        const rect = element.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) continue;
        const mark = api.dom.h('div', {});
        Object.assign(mark.style, {
          position: 'fixed', pointerEvents: 'none', zIndex: '99998',
          left: `${rect.left}px`, top: `${rect.top}px`,
          width: `${rect.width}px`, height: `${rect.height}px`,
          outline: '2px solid #f0a94a', background: 'rgba(240,169,74,.12)',
        });
        document.body.append(mark);
        marks.push(mark);
      }
      return elements.length;
    };

    const open = () => {
      if (child && !child.closed) { child.focus(); api.ui.toast(t('already')); return; }
      // Two columns of content, so the window has to be wide enough for both.
      child = window.open('', WINDOW_NAME, 'width=1040,height=780,resizable=yes');
      if (!child) { api.ui.toast(t('blocked'), { variant: 'error' }); return; }

      const doc = child.document;
      doc.open();
      doc.write('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
      doc.close();
      doc.documentElement.setAttribute('data-slackmod-window', 'theme-builder');
      doc.title = t('title');
      const style = doc.createElement('style');
      style.textContent = api.assets.text('window.css');
      doc.head.append(style);

      const el = (tag, props = {}, children = []) => {
        const node = doc.createElement(tag);
        for (const [k, v] of Object.entries(props)) {
          if (k === 'class') node.className = v;
          else if (k.includes('-')) node.setAttribute(k, v);
          else node[k] = v;
        }
        for (const c of children) node.append(typeof c === 'string' ? doc.createTextNode(c) : c);
        return node;
      };

      // -- state
      let seeds = { bg: parseColour('#1a1a1e'), accent: parseColour('#536aed') };
      let overrides = {};
      let baseCss = '';
      let extraCss = '';
      let editing = null;

      const palette = () => ({ ...derivePalette(seeds.bg, seeds.accent), ...overrides });

      const preview = () => {
        // Base first, then the palette, then hand-written rules: last wins,
        // which is what "override an existing theme" has to mean.
        api.css(`${baseCss}\n${buildThemeCss(palette(), nameInput.value || 'Custom', extraCss)}`);
        paintUi();
      };

      // -- colour picker, built here because <input type=color> has no alpha
      const picker = el('div', { class: 'picker' });
      const sv = el('div', { class: 'sv' });
      const svKnob = el('div', { class: 'knob' });
      sv.append(svKnob);
      const hue = el('div', { class: 'slider' });
      const hueKnob = el('div', { class: 'knob' });
      hue.append(hueKnob);
      hue.style.background =
        'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)';
      const alpha = el('div', { class: 'slider checker' });
      const alphaKnob = el('div', { class: 'knob' });
      alpha.append(alphaKnob);
      const hexField = el('input', { type: 'text', spellcheck: false });
      picker.append(sv, hue, alpha, hexField);

      const current = () => (editing ? palette()[editing] : seeds.bg);

      const setColour = (colour) => {
        if (!editing) return;
        if (editing === 'bg' || editing === 'accent') seeds[editing] = colour;
        else overrides[editing] = colour;
        drawPicker();
        preview();
      };

      const drawPicker = () => {
        const colour = current();
        const hsv = toHsv(colour);
        sv.style.background =
          `linear-gradient(to top, #000, rgba(0,0,0,0)), ` +
          `linear-gradient(to right, #fff, hsl(${hsv.h}, 100%, 50%))`;
        svKnob.style.left = `${hsv.s * 100}%`;
        svKnob.style.top = `${(1 - hsv.v) * 100}%`;
        hueKnob.style.left = `${(hsv.h / 360) * 100}%`;
        hueKnob.style.top = '50%';
        alpha.style.backgroundImage =
          `linear-gradient(to right, rgba(${colour.r},${colour.g},${colour.b},0), ` +
          `rgb(${colour.r},${colour.g},${colour.b})), ` + alphaChecker;
        alphaKnob.style.left = `${colour.a * 100}%`;
        alphaKnob.style.top = '50%';
        hexField.value = formatCss(colour);
      };
      const alphaChecker =
        'linear-gradient(45deg,#555 25%,transparent 25%),' +
        'linear-gradient(-45deg,#555 25%,transparent 25%),' +
        'linear-gradient(45deg,transparent 75%,#555 75%),' +
        'linear-gradient(-45deg,transparent 75%,#555 75%)';

      /** Pointer dragging on a strip or square, clamped to it. */
      const drag = (surface, onMove) => {
        const handle = (event) => {
          const rect = surface.getBoundingClientRect();
          const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
          const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
          onMove(x, y);
        };
        surface.addEventListener('pointerdown', (event) => {
          surface.setPointerCapture(event.pointerId);
          handle(event);
          const move = (e) => handle(e);
          const up = () => {
            surface.removeEventListener('pointermove', move);
            surface.removeEventListener('pointerup', up);
          };
          surface.addEventListener('pointermove', move);
          surface.addEventListener('pointerup', up);
        });
      };

      drag(sv, (x, y) => {
        const hsv = toHsv(current());
        setColour(fromHsv({ h: hsv.h, s: x, v: 1 - y, a: current().a }));
      });
      drag(hue, (x) => {
        const hsv = toHsv(current());
        setColour(fromHsv({ h: x * 360, s: hsv.s, v: hsv.v, a: current().a }));
      });
      drag(alpha, (x) => setColour({ ...current(), a: Math.round(x * 100) / 100 }));
      hexField.addEventListener('input', () => {
        const parsed = parseColour(hexField.value);
        if (parsed) setColour(parsed);
      });

      // -- layout
      const nameInput = el('input', { type: 'text', value: 'My theme', spellcheck: false });
      const status = el('div', { class: 'status' });

      const baseSelect = el('select');
      baseSelect.append(el('option', { value: '', textContent: t('scratch') }));
      for (const theme of api.themes.list()) {
        baseSelect.append(el('option', { value: theme.id, textContent: theme.name }));
      }
      baseSelect.addEventListener('change', () => {
        const id = baseSelect.value;
        if (!id) { baseCss = ''; preview(); return; }
        void api.themes.source(id).then((css) => { baseCss = css; preview(); });
      });

      const toolsButton = el('button', { class: 'action', textContent: t('tools') });
      doc.body.append(el('div', { class: 'top' }, [
        el('h1', { textContent: t('title') }),
        baseSelect,
        toolsButton,
      ]));

      const left = el('div', { class: 'left' });
      const right = el('div', { class: 'right' });
      doc.body.append(el('div', { class: 'cols' }, [left, right]));

      // -- palette column
      const seedRow = el('div', { class: 'seeds' });
      const swatchGrid = el('div', { class: 'swatches' });
      const reroll = el('button', { class: 'action', textContent: t('reroll'), title: t('rerollHint') });
      reroll.addEventListener('click', () => { overrides = {}; editing = null; picker.setAttribute('data-open', 'false'); preview(); });

      left.append(
        el('h2', { textContent: t('palette') }), seedRow,
        el('h2', { textContent: t('derived') }), swatchGrid,
        el('div', { style: 'margin-top:10px' }, [reroll]),
        picker,
      );

      const chooseRole = (key) => {
        editing = key;
        picker.setAttribute('data-open', 'true');
        drawPicker();
        paintUi();
      };

      // -- preview column
      const demo = el('div', { class: 'demo' });
      const checks = el('div', { class: 'checks' });
      const previewWrap = el('div', {}, [
        el('h2', { textContent: t('preview') }), demo,
        el('h2', { textContent: t('readable') }), checks,
      ]);
      right.append(previewWrap);

      const paintUi = () => {
        const p = palette();
        const css = (key) => formatCss(p[key]);

        // seeds
        seedRow.replaceChildren();
        for (const role of ROLES.filter((r) => r.seed)) {
          const chip = el('div', { class: 'chip checker' });
          chip.style.backgroundImage = `linear-gradient(${css(role.key)}, ${css(role.key)}), ${alphaChecker}`;
          const card = el('div', { class: 'seed' }, [
            chip,
            el('div', { class: 'meta' }, [
              el('strong', { textContent: role.label }),
              el('small', { textContent: formatCss(p[role.key]) }),
            ]),
          ]);
          card.addEventListener('click', () => chooseRole(role.key));
          seedRow.append(card);
        }

        // derived
        swatchGrid.replaceChildren();
        for (const role of ROLES.filter((r) => !r.seed)) {
          const chip = el('div', { class: 'chip checker' });
          chip.style.backgroundImage = `linear-gradient(${css(role.key)}, ${css(role.key)}), ${alphaChecker}`;
          const button = el('button', { class: 'sw' }, [chip, el('span', { textContent: role.label })]);
          button.setAttribute('data-own', String(Boolean(overrides[role.key])));
          button.title = `${role.hint} — ${formatCss(p[role.key])}`;
          button.addEventListener('click', () => chooseRole(role.key));
          swatchGrid.append(button);
        }

        // the fragments of Slack each role paints
        demo.replaceChildren();
        const side = el('div', { class: 'side' });
        side.style.background = css('chrome');
        for (const [label, state] of [[t('sampleChannel'), 'selected'], ['random', 'hover'], ['design', '']]) {
          const row = el('div', { class: 'row' }, [`# ${label}`]);
          row.style.color = state === 'selected' ? css('bright') : css('muted');
          if (state) row.style.background = css(state);
          side.append(row);
        }
        const badgeRow = el('div', { class: 'row' }, ['# alerts ']);
        badgeRow.style.color = css('muted');
        const badge = el('span', { class: 'badge', textContent: '3' });
        badge.style.background = css('danger');
        badgeRow.append(badge);
        side.append(badgeRow);

        const main = el('div', { class: 'main' });
        main.style.background = css('bg');
        const avatar = el('div', { class: 'av' });
        avatar.style.background = css('surface');
        const mention = el('span', { class: 'chip2', textContent: '@erwan' });
        mention.style.background = css('selected');
        mention.style.color = css('accentText');
        const body = el('div', {}, [
          el('div', {}, [
            (() => { const who = el('span', { class: 'who', textContent: t('sampleName') });
              who.style.color = css('bright'); return who; })(),
            (() => { const time = el('span', { class: 'time', textContent: t('sampleTime') });
              time.style.color = css('muted'); return time; })(),
          ]),
          (() => { const line = el('div', {}, [t('sampleText'), ' ', mention]);
            line.style.color = css('text'); return line; })(),
        ]);
        main.append(el('div', { class: 'msg' }, [avatar, body]));
        const composer = el('div', { class: 'composer', textContent: t('sampleCompose') });
        composer.style.background = css('raised');
        composer.style.color = css('muted');
        composer.style.border = `1px solid ${css('surface')}`;
        main.append(composer);
        demo.append(side, main);

        // readability
        checks.replaceChildren();
        for (const [fg, bgKey, label] of CONTRAST_CHECKS) {
          const ratio = contrast(p[fg], p[bgKey]);
          const verdict = readability(ratio);
          const dot = el('div', { class: 'dot' });
          dot.style.background = css(fg);
          const grade = el('span', { class: 'grade', textContent: verdict.grade });
          grade.setAttribute('data-ok', String(verdict.ok));
          checks.append(el('div', { class: 'check' }, [
            dot,
            el('span', { class: 'name', textContent: label }),
            el('span', { class: 'ratio', textContent: `${ratio.toFixed(1)}:1` }),
            grade,
          ]));
        }
      };

      // -- tools view
      const tools = el('div', {});
      const pickButton = el('button', { class: 'action primary', textContent: t('pick') });
      const inspectOut = el('div', {}, [el('p', { class: 'empty', textContent: t('nothing') })]);
      const classInput = el('input', { type: 'text', spellcheck: false, placeholder: '.c-message_kit__background' });
      const classCount = el('span', { class: 'empty' });
      const showButton = el('button', { class: 'action', textContent: t('highlight') });
      const clearButton = el('button', { class: 'action', textContent: t('clear') });
      const cssArea = el('textarea', { spellcheck: false });
      showButton.addEventListener('click', () => {
        classCount.textContent = t('classCount', { count: markAll(classInput.value.trim()) });
      });
      clearButton.addEventListener('click', () => { clearMarks(); classCount.textContent = ''; });
      cssArea.addEventListener('input', () => { extraCss = cssArea.value; preview(); });

      const describe = (element) => {
        inspectOut.replaceChildren();
        const computed = getComputedStyle(element);
        const rules = matchedRules(element, document.styleSheets);
        const resolve = (name) =>
          getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        const label = element.tagName.toLowerCase()
          + (element.getAttribute('data-qa') ? `[data-qa="${element.getAttribute('data-qa')}"]` : '')
          + [...element.classList].map((c) => `.${c}`).join('');
        inspectOut.append(el('div', { class: 'card' }, [el('code', { textContent: label })]));

        const painted = el('div', { class: 'card' }, [el('h2', { textContent: t('paintedBy') })]);
        for (const [prop, name] of [['background-color', 'background'], ['color', 'text']]) {
          const parsed = parseColour(computed.getPropertyValue(prop));
          if (!parsed) continue;
          const dot = el('div', { class: 'dot' });
          dot.style.background = formatCss(parsed);
          const use = el('button', { class: 'action', textContent: `${name} →` });
          use.addEventListener('click', () => {
            if (editing) setColour(parsed);
          });
          painted.append(el('div', { class: 'var' }, [
            dot, el('code', { textContent: `${name}: ${formatCss(parsed)}` }), use,
          ]));
        }
        inspectOut.append(painted);

        const vars = variablesIn(rules, resolve);
        const varCard = el('div', { class: 'card' }, [el('h2', { textContent: t('variables') })]);
        if (!vars.length) varCard.append(el('p', { class: 'empty', textContent: t('noVars') }));
        for (const entry of vars.slice(0, 30)) {
          const dot = el('div', { class: 'dot' });
          dot.style.background = /^\d/.test(entry.value) ? `rgb(${entry.value})` : entry.value;
          varCard.append(el('div', { class: 'var' }, [
            dot, el('code', { textContent: `${entry.name}: ${entry.value || '—'}` }),
          ]));
        }
        inspectOut.append(varCard);

        const ruleCard = el('div', { class: 'card' }, [el('h2', { textContent: t('matchedRules') })]);
        if (!rules.length) ruleCard.append(el('p', { class: 'empty', textContent: t('noRules') }));
        else {
          const list = el('ul', { class: 'rules' });
          for (const rule of rules.slice(0, 50)) {
            list.append(el('li', {}, [el('code', { textContent: `${rule.selector} { ${rule.text.slice(0, 140)} }` })]));
          }
          ruleCard.append(list);
        }
        inspectOut.append(ruleCard);
      };

      pickButton.addEventListener('click', () => {
        pickButton.textContent = t('picking');
        child.blur();
        window.focus();
        startPicking((element) => { pickButton.textContent = t('pick'); describe(element); child.focus(); });
      });

      tools.append(
        el('h2', { textContent: t('tools') }), pickButton, inspectOut,
        el('h2', { textContent: t('classSearch') }), classInput,
        el('div', { style: 'display:flex;gap:8px;align-items:center;margin:8px 0' },
          [showButton, clearButton, classCount]),
        el('h2', { textContent: 'CSS' }),
        el('p', { class: 'empty', textContent: t('cssHint') }), cssArea,
      );

      let showingTools = false;
      toolsButton.addEventListener('click', () => {
        showingTools = !showingTools;
        right.replaceChildren(showingTools ? tools : previewWrap);
        toolsButton.textContent = showingTools ? t('back') : t('tools');
      });

      // -- bottom bar
      const save = el('button', { class: 'action primary', textContent: t('save') });
      save.addEventListener('click', () => {
        const label = nameInput.value.trim();
        if (!label) { status.textContent = t('needsName'); return; }
        const id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
          || 'custom-theme';
        void api.saveTheme({
          id, name: label,
          description: `A theme built with SlackMod's theme builder, from ${ROLES.length} colours.`,
          css: buildThemeCss(palette(), label, extraCss),
        }).then(() => { status.textContent = t('saved'); api.ui.toast(t('saved')); })
          .catch((err) => { status.textContent = err.message; });
      });
      const copy = el('button', { class: 'action', textContent: t('copy') });
      copy.addEventListener('click', () => {
        void api.helpers.copy(buildThemeCss(palette(), nameInput.value || 'Custom', extraCss), t('copied'));
      });
      const reset = el('button', { class: 'action', textContent: t('reset') });
      reset.addEventListener('click', () => { child.close(); open(); });

      doc.body.append(el('div', { class: 'bar' }, [nameInput, save, copy, reset, status]));

      preview();
      child.addEventListener('unload', () => {
        api.css('');
        stopPicking?.();
        clearMarks();
        document.getElementById(OVERLAY_ID)?.remove();
      });
    };

    api.slack.addToolbarButton('controlStrip', {
      id: 'theme-builder',
      label: t('open'),
      description: t('openHint'),
      icon: PALETTE_ICON,
      onClick: open,
    });

    api.onDispose(() => {
      stopPicking?.();
      clearMarks();
      document.getElementById(OVERLAY_ID)?.remove();
      if (child && !child.closed) child.close();
    });
  },
};
