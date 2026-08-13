// A theme builder, in a window of its own, with the running app as the canvas.
//
// WHY A SEPARATE WINDOW
//
// A theme is judged against the whole app -- rail beside sidebar beside
// conversation -- and a panel covering half of it hides the thing being judged.
// `window.open` works from Slack's renderer and the child inherits the origin,
// so parent and child hold direct references to each other: the controls live
// in the new window and call straight into this module. No message passing, no
// serialisation, and the preview is the real application.
//
// The window marks itself with `data-slackmod-window`, which the loader looks
// for before painting a theme into Slack's other windows. A builder repainted
// by the theme being edited becomes unreadable exactly when you need to read it.
//
// WHAT IT IS MADE OF
//
//   Roles     twelve colours, mapped across Slack's four token families
//   Inspect   point at anything in Slack and see what is actually painting it
//   Classes   pick a class and see every element wearing it, lit up
//   CSS       free-hand rules on top, applied as you type
//
// The Inspect tab is the interesting one. Slack's stylesheets are readable from
// the page, so for a picked element every matching rule can be found by walking
// `document.styleSheets` and testing `element.matches(selectorText)`. Reading
// the `var(--x)` references out of those rules is what turns "this is grey" into
// "this is grey because --dt_color-base-sec is grey", which is the question a
// theme author is actually asking.

const WINDOW_NAME = 'slackmod-theme-builder';
const OVERLAY_ID = 'slackmod-inspect-overlay';

/** The roles a theme is actually made of, in the order they matter. */
const ROLES = [
  { key: 'bg', label: 'Background', hint: 'The conversation itself', value: '#1a1a1e' },
  { key: 'raised', label: 'Raised', hint: 'Composer, cards, menus', value: '#222327' },
  { key: 'chrome', label: 'Chrome', hint: 'Rail and sidebar', value: '#121214' },
  { key: 'surface', label: 'Surface', hint: 'Dividers, pills, buttons', value: '#29292d' },
  { key: 'selected', label: 'Selected', hint: 'The open channel', value: '#2d2d30' },
  { key: 'hover', label: 'Hover', hint: 'Rows under the pointer', value: '#1f1f23' },
  { key: 'text', label: 'Text', hint: 'Message body', value: '#efeff1' },
  { key: 'bright', label: 'Headings', hint: 'Names and titles', value: '#fbfbfb' },
  { key: 'muted', label: 'Muted', hint: 'Timestamps, idle channels', value: '#81828a' },
  { key: 'accent', label: 'Accent', hint: 'Links, focus, active tab', value: '#536aed' },
  { key: 'accentText', label: 'Accent text', hint: 'Mentions', value: '#a7bdfc' },
  { key: 'danger', label: 'Danger', hint: 'Badges, destructive actions', value: '#dd3d48' },
];

const STRINGS = {
  en: {
    open: 'Theme builder',
    openHint: 'Design a theme with the app as your preview',
    title: 'Theme builder',
    tabRoles: 'Roles', tabInspect: 'Inspect', tabClasses: 'Classes', tabCss: 'CSS',
    base: 'Start from',
    scratch: 'Slack’s own colours',
    intro: 'Drag a colour and Slack follows immediately. Nothing is saved until you say so.',
    pick: 'Point at something in Slack',
    picking: 'Click an element in Slack… (Escape cancels)',
    picked: 'Picked',
    nothing: 'Nothing picked yet. Press the button, then click anything in Slack.',
    paintedBy: 'Painted by',
    matchedRules: 'Rules that match it',
    noRules: 'No stylesheet rule matches this element directly.',
    variables: 'Variables it depends on',
    noVars: 'Nothing here reads a theme variable — this is a fixed colour in Slack’s CSS.',
    computed: 'Computed',
    classSearch: 'Search a class name',
    classCount: '{count} elements',
    highlight: 'Show them in Slack',
    clear: 'Clear',
    cssHint: 'Applied on top of everything, exactly as typed.',
    name: 'Theme name',
    save: 'Save as a theme', copy: 'Copy the CSS', reset: 'Start over',
    saved: 'Saved. It is in your Themes list.',
    copied: 'Theme CSS copied',
    needsName: 'Give the theme a name first.',
    blocked: 'Slack refused to open a window. Allow pop-ups for the app.',
    already: 'The builder is already open.',
    useVar: 'Use as',
  },
  fr: {
    open: 'Constructeur de thème',
    openHint: 'Concevoir un thème avec l’app comme aperçu',
    title: 'Constructeur de thème',
    tabRoles: 'Rôles', tabInspect: 'Inspecter', tabClasses: 'Classes', tabCss: 'CSS',
    base: 'Partir de',
    scratch: 'Les couleurs de Slack',
    intro: 'Bougez une couleur, Slack suit aussitôt. Rien n’est enregistré tant que vous ne le demandez pas.',
    pick: 'Pointer un élément de Slack',
    picking: 'Cliquez un élément dans Slack… (Échap annule)',
    picked: 'Sélectionné',
    nothing: 'Rien de sélectionné. Appuyez sur le bouton, puis cliquez n’importe où dans Slack.',
    paintedBy: 'Peint par',
    matchedRules: 'Règles qui le visent',
    noRules: 'Aucune règle ne vise directement cet élément.',
    variables: 'Variables dont il dépend',
    noVars: 'Rien ici ne lit de variable de thème — c’est une couleur figée dans le CSS de Slack.',
    computed: 'Calculé',
    classSearch: 'Chercher une classe',
    classCount: '{count} éléments',
    highlight: 'Les montrer dans Slack',
    clear: 'Effacer',
    cssHint: 'Appliqué par-dessus tout le reste, tel quel.',
    name: 'Nom du thème',
    save: 'Enregistrer comme thème', copy: 'Copier le CSS', reset: 'Tout reprendre',
    saved: 'Enregistré. Il est dans votre liste de thèmes.',
    copied: 'CSS du thème copié',
    needsName: 'Donnez d’abord un nom au thème.',
    blocked: 'Slack a refusé d’ouvrir une fenêtre. Autorisez les fenêtres surgissantes.',
    already: 'Le constructeur est déjà ouvert.',
    useVar: 'Utiliser comme',
  },
};

const PALETTE_ICON =
  '<svg viewBox="0 0 20 20" aria-hidden="true" style="height:20px;width:20px">' +
  '<path fill="currentColor" d="M10 2.5a7.5 7.5 0 0 0 0 15c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1a1.5 1.5 0 0 1 1.09-2.5h1.8A4.5 4.5 0 0 0 18.5 8c0-3.03-3.81-5.5-8.5-5.5M4 10a6 6 0 0 1 6-6c3.95 0 7 2.02 7 4a3 3 0 0 1-3 3h-1.8a3 3 0 0 0-2.18 5.06.5.5 0 0 1-.52.44A6 6 0 0 1 4 10"/>' +
  '<circle cx="6.75" cy="9.75" r="1.25" fill="currentColor"/><circle cx="9.25" cy="6.25" r="1.25" fill="currentColor"/>' +
  '<circle cx="13.25" cy="6.75" r="1.25" fill="currentColor"/></svg>';

/** `#rrggbb` to the bare `r, g, b` triplet Slack's legacy family wants. */
function triplet(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** `rgb(26, 26, 30)` to `#1a1a1e`, so a computed colour can seed a picker. */
export function toHex(colour) {
  const m = String(colour).match(/rgba?\(([^)]+)\)/);
  if (!m) return /^#[0-9a-f]{6}$/i.test(colour) ? colour.toLowerCase() : null;
  const [r, g, b] = m[1].split(',').map((n) => Math.max(0, Math.min(255, Math.round(parseFloat(n)))));
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Every stylesheet rule that matches an element, nearest-first.
 *
 * There is no API for this -- `getMatchedCSSRules` was removed years ago -- so
 * the sheets are walked by hand. Slack's are readable from the page, which is
 * the whole reason this tab can exist; anything that is not (a stylesheet from
 * another origin) throws on `cssRules` and is skipped rather than breaking the
 * walk.
 */
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
      // A selector list can match on one of its parts; test each so the one
      // that actually applies is what gets reported.
      for (const part of rule.selectorText.split(',')) {
        const selector = part.trim();
        if (!selector) continue;
        let hit = false;
        try {
          hit = element.matches(selector);
        } catch {
          continue; // a selector this browser will not parse
        }
        if (hit) {
          out.push({ selector, text: rule.style.cssText, specificity: selector.split(/[\s>+~]+/).length });
          break;
        }
      }
    }
  }
  return out;
}

/** The custom properties a set of rules reads, with what each resolves to. */
export function variablesIn(rules, resolve) {
  const names = new Set();
  for (const rule of rules) {
    for (const match of String(rule.text).matchAll(/var\((--[\w-]+)/g)) names.add(match[1]);
  }
  return [...names].sort().map((name) => ({ name, value: resolve(name) }));
}

export function buildThemeCss(values, name = 'Custom', extra = '') {
  const v = values;
  const dark = luminance(v.bg) < 0.4;
  return `/*
 * ${name} — built with SlackMod's theme builder.
 *
 * Twelve roles, mapped across the four families Slack paints from. The chrome
 * (--dt_color-theme-*) and legacy (--sk_*) families need !important because
 * Slack sets them on more specific selectors; the legacy one takes bare
 * "r, g, b" triplets rather than colours.
 */

:root,
.sk-client-theme--light,
.sk-client-theme--dark {
  --dt_color-base-pry: ${v.bg};
  --dt_color-base-sec: ${v.raised};
  --dt_color-base-ter: ${v.surface};
  --dt_color-base-modal: rgba(0, 0, 0, ${dark ? '0.8' : '0.4'});

  --dt_color-base-pry-hover: ${v.hover};
  --dt_color-base-pry-pressed: ${v.surface};
  --dt_color-base-sec-hover: ${v.surface};
  --dt_color-base-sec-pressed: ${v.selected};
  --dt_color-base-ter-hover: ${v.selected};
  --dt_color-base-ter-pressed: ${v.selected};

  --dt_color-content-pry: ${v.text};
  --dt_color-content-sec: ${v.muted};
  --dt_color-content-ter: ${v.muted};

  --dt_color-otl-pry: ${v.surface};
  --dt_color-otl-sec: ${v.surface};
  --dt_color-otl-ter: ${v.surface};

  --dt_color-content-hgl-1: ${v.accentText};
  --dt_color-content-imp: ${v.danger};
  --dt_color-base-hgl-1: ${v.selected};

  --dt_color-base-inv-pry: ${v.chrome};
  --dt_color-content-inv-pry: ${v.bright};
  --dt_color-content-inv-sec: ${v.muted};
}

/* Chrome and legacy families; both need !important. */
:root,
.sk-client-theme--light,
.sk-client-theme--dark {
  --dt_color-theme-base-inv-pry: ${v.chrome} !important;
  --dt_color-theme-base-inv-sec: ${v.chrome} !important;
  --dt_color-theme-content-inv-pry: ${v.bright} !important;
  --dt_color-theme-content-inv-sec: ${v.muted} !important;
  --dt_color-theme-content-inv-ter: ${v.muted} !important;
  --dt_color-theme-otl-inv-pry: ${v.surface} !important;

  --dt_color-theme-surf-inv-pry: ${v.selected} !important;
  --dt_color-theme-surf-inv-sec: ${v.chrome} !important;
  --dt_color-theme-surf-inv-ter: ${v.hover} !important;
  --dt_color-theme-surf-pry: ${v.selected} !important;
  --dt_color-theme-surf-sec: ${v.hover} !important;
  --dt_color-theme-surf-ter: ${v.bg} !important;

  --dt_color-theme-base-pry: ${v.bg} !important;
  --dt_color-theme-base-sec: ${v.raised} !important;
  --dt_color-theme-base-hgl-1: ${v.selected} !important;
  --dt_color-theme-content-pry: ${v.text} !important;
  --dt_color-theme-content-sec: ${v.muted} !important;
  --dt_color-theme-content-ter: ${v.muted} !important;

  --sk_primary_background: ${triplet(v.bg)} !important;
  --sk_primary_foreground: ${triplet(v.text)} !important;
  --sk_inverted_background: ${triplet(v.text)} !important;
  --sk_inverted_foreground: ${triplet(v.bg)} !important;
  --sk_foreground_max: ${triplet(v.bright)} !important;
  --sk_foreground_high: ${triplet(v.text)} !important;
  --sk_foreground_mid: ${triplet(v.muted)} !important;
  --sk_foreground_low: ${triplet(v.muted)} !important;
  --sk_foreground_min: ${triplet(v.muted)} !important;
  --sk_foreground_max_solid: ${triplet(v.bright)} !important;
  --sk_foreground_high_solid: ${triplet(v.muted)} !important;
  --sk_foreground_mid_solid: ${triplet(v.selected)} !important;
  --sk_foreground_low_solid: ${triplet(v.surface)} !important;
  --sk_foreground_min_solid: ${triplet(v.raised)} !important;
  --sk_highlight: ${triplet(v.accent)} !important;
  --sk_highlight_hover: ${triplet(v.accentText)} !important;
  --sk_highlight_accent: ${triplet(v.accent)} !important;
}

html, body { background-color: ${v.bg}; }
/* A full-viewport opaque layer sits above <body>; without this nothing shows. */
.p-theme_background { background: ${v.bg} !important; }

.p-tab_rail,
.p-channel_sidebar,
.p-ia4_home_header { background: ${v.chrome} !important; border: none !important; }

.p-client_container,
.p-message_pane,
.p-view_contents { background: ${v.bg} !important; }
${extra ? `\n/* Your own rules. */\n${extra}\n` : ''}`;
}

/** The builder window's own styling, deliberately independent of any theme. */
const WINDOW_CSS = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0;
    font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #17171a; color: #ececee;
  }
  header { padding: 16px 18px 0; }
  h1 { margin: 0 0 4px; font-size: 17px; }
  p.intro { margin: 0 0 12px; color: #9a9aa2; }
  .tabs { display: flex; gap: 4px; border-bottom: 1px solid #26262b; padding: 0 18px; }
  .tabs button {
    padding: 8px 12px; border: 0; border-bottom: 2px solid transparent; background: none;
    color: #9a9aa2; font: inherit; cursor: pointer;
  }
  .tabs button[aria-selected="true"] { color: #ececee; border-bottom-color: #6b7cf0; }
  main { padding: 14px 18px 0; }
  .pane { display: none; }
  .pane[data-open="true"] { display: block; }
  .row { display: grid; grid-template-columns: 44px 1fr 96px; gap: 10px; align-items: center;
         padding: 6px 0; border-bottom: 1px solid #26262b; }
  .row label { display: block; font-weight: 600; }
  .row small { color: #82828b; }
  input[type=color] { width: 44px; height: 28px; padding: 0; border: 1px solid #34343a;
                      border-radius: 6px; background: none; cursor: pointer; }
  input[type=text], select, textarea {
    width: 100%; padding: 6px 8px; border-radius: 6px; border: 1px solid #34343a;
    background: #1e1e22; color: inherit; font-family: inherit;
  }
  input.hex, textarea { font-family: ui-monospace, Menlo, monospace; }
  textarea { min-height: 220px; resize: vertical; }
  .field { margin-bottom: 12px; }
  .field label { display: block; margin-bottom: 5px; font-weight: 600; }
  button.action { padding: 7px 12px; border-radius: 6px; border: 1px solid #34343a;
                  background: #24242a; color: inherit; font: inherit; cursor: pointer; }
  button.action:hover { background: #2d2d34; }
  button.primary { background: #4a5bd0; border-color: #4a5bd0; }
  button.primary:hover { background: #5a6ae0; }
  footer { position: sticky; bottom: 0; margin-top: 14px; padding: 12px 18px;
           background: #17171a; border-top: 1px solid #26262b; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .status { margin-top: 8px; min-height: 16px; color: #7fd18d; }
  .card { border: 1px solid #26262b; border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; }
  .card h2 { margin: 0 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: .04em;
             color: #82828b; }
  code { font-family: ui-monospace, Menlo, monospace; font-size: 12px; color: #c9c9d1;
         word-break: break-all; }
  .swatch { display: inline-block; width: 14px; height: 14px; border-radius: 3px;
            border: 1px solid #3a3a42; vertical-align: -2px; margin-right: 6px; }
  .var { display: flex; align-items: center; gap: 8px; padding: 4px 0; border-bottom: 1px solid #212126; }
  .var code { flex: 1; }
  .empty { color: #82828b; padding: 8px 0; }
  ul.rules { list-style: none; margin: 0; padding: 0; max-height: 220px; overflow: auto; }
  ul.rules li { padding: 5px 0; border-bottom: 1px solid #212126; }
`;

export default {
  async start(api) {
    const t = api.i18n.strings(STRINGS);
    let child = null;
    /** Cleanup for whatever the picker installed in Slack's window. */
    let stopPicking = null;

    // ---------------------------------------------------------------- Slack side

    const overlay = () => {
      let node = document.getElementById(OVERLAY_ID);
      if (!node) {
        node = api.dom.h('div', { id: OVERLAY_ID });
        Object.assign(node.style, {
          position: 'fixed', pointerEvents: 'none', zIndex: '99999',
          border: '2px solid #6b7cf0', background: 'rgba(107,124,240,.18)',
          borderRadius: '3px', transition: 'all 60ms ease', display: 'none',
        });
        document.body.append(node);
      }
      return node;
    };

    const highlightBox = (rect) => {
      const node = overlay();
      Object.assign(node.style, {
        display: 'block', left: `${rect.left}px`, top: `${rect.top}px`,
        width: `${rect.width}px`, height: `${rect.height}px`,
      });
    };

    const hideOverlay = () => {
      const node = document.getElementById(OVERLAY_ID);
      if (node) node.style.display = 'none';
    };

    /** Extra outlines for "show me every element with this class". */
    const marks = [];
    const clearMarks = () => {
      while (marks.length) marks.pop().remove();
    };
    const markAll = (selector) => {
      clearMarks();
      let elements = [];
      try {
        elements = [...document.querySelectorAll(selector)];
      } catch {
        return 0;
      }
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

    /**
     * Point-and-click element picking, in Slack's own window.
     *
     * Listeners are on capture so Slack never sees the click that chose an
     * element -- picking a channel row should not also open that channel.
     */
    const startPicking = (onPicked) => {
      stopPicking?.();
      const move = (event) => {
        const element = event.target;
        if (element && element.getBoundingClientRect) highlightBox(element.getBoundingClientRect());
      };
      const click = (event) => {
        event.preventDefault();
        event.stopPropagation();
        stop();
        onPicked(event.target);
      };
      const key = (event) => {
        if (event.key === 'Escape') stop();
      };
      const stop = () => {
        document.removeEventListener('mousemove', move, true);
        document.removeEventListener('click', click, true);
        document.removeEventListener('keydown', key, true);
        hideOverlay();
        stopPicking = null;
      };
      document.addEventListener('mousemove', move, true);
      document.addEventListener('click', click, true);
      document.addEventListener('keydown', key, true);
      stopPicking = stop;
      return stop;
    };

    // ---------------------------------------------------------------- the window

    const open = () => {
      if (child && !child.closed) {
        child.focus();
        api.ui.toast(t('already'));
        return;
      }
      child = window.open('', WINDOW_NAME, 'width=520,height=860');
      if (!child) {
        api.ui.toast(t('blocked'), { variant: 'error' });
        return;
      }

      const values = Object.fromEntries(ROLES.map((r) => [r.key, r.value]));
      let baseCss = '';
      let extraCss = '';

      const doc = child.document;
      doc.open();
      doc.write('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
      doc.close();
      doc.documentElement.setAttribute('data-slackmod-window', 'theme-builder');
      doc.title = t('title');

      const style = doc.createElement('style');
      style.textContent = WINDOW_CSS;
      doc.head.append(style);

      const el = (tag, props = {}, children = []) => {
        const node = doc.createElement(tag);
        for (const [k, v] of Object.entries(props)) {
          if (k === 'class') node.className = v;
          else if (k.startsWith('data-') || k === 'aria-selected') node.setAttribute(k, v);
          else node[k] = v;
        }
        for (const c of children) node.append(c);
        return node;
      };

      const preview = () => {
        // The base first, then the roles, then hand-written rules: last wins,
        // which is what "override an existing theme" has to mean.
        api.css(`${baseCss}\n${buildThemeCss(values, nameInput.value || 'Custom', extraCss)}`);
      };

      // -- header and tabs
      doc.body.append(el('header', {}, [
        el('h1', { textContent: t('title') }),
        el('p', { class: 'intro', textContent: t('intro') }),
      ]));

      const panes = {};
      const tabBar = el('div', { class: 'tabs' });
      const showTab = (id) => {
        for (const [key, pane] of Object.entries(panes)) pane.setAttribute('data-open', String(key === id));
        for (const button of tabBar.children) {
          button.setAttribute('aria-selected', String(button.dataset.tab === id));
        }
      };
      for (const [id, label] of [['roles', t('tabRoles')], ['inspect', t('tabInspect')],
        ['classes', t('tabClasses')], ['css', t('tabCss')]]) {
        const button = el('button', { textContent: label, 'data-tab': id });
        button.dataset.tab = id;
        button.addEventListener('click', () => showTab(id));
        tabBar.append(button);
      }
      doc.body.append(tabBar);
      const main = el('main');
      doc.body.append(main);

      // -- roles
      const rolesPane = el('div', { class: 'pane' });
      panes.roles = rolesPane;

      const baseSelect = el('select');
      baseSelect.append(el('option', { value: '', textContent: t('scratch') }));
      for (const theme of api.themes.list()) {
        baseSelect.append(el('option', { value: theme.id, textContent: theme.name }));
      }
      baseSelect.addEventListener('change', () => {
        const id = baseSelect.value;
        if (!id) {
          baseCss = '';
          preview();
          return;
        }
        void api.themes.source(id).then((css) => {
          baseCss = css;
          // Seed the pickers from what that theme actually paints, so the
          // twelve controls start where the eye already is.
          for (const role of ROLES) {
            const probe = { bg: '.p-client_container', chrome: '.p-channel_sidebar' }[role.key];
            if (!probe) continue;
            const node = document.querySelector(probe);
            const hex = node && toHex(getComputedStyle(node).backgroundColor);
            if (hex) setRole(role.key, hex);
          }
          preview();
        });
      });
      rolesPane.append(el('div', { class: 'field' }, [
        el('label', { textContent: t('base') }), baseSelect,
      ]));

      const roleInputs = {};
      const setRole = (key, hex) => {
        values[key] = hex;
        const pair = roleInputs[key];
        if (!pair) return;
        pair.swatch.value = hex;
        pair.hex.value = hex;
      };
      for (const role of ROLES) {
        const swatch = el('input', { type: 'color', value: role.value });
        const hex = el('input', { type: 'text', class: 'hex', value: role.value, spellcheck: false });
        roleInputs[role.key] = { swatch, hex };
        const sync = (next, from) => {
          if (!/^#[0-9a-f]{6}$/i.test(next)) return;
          values[role.key] = next.toLowerCase();
          if (from !== 'swatch') swatch.value = values[role.key];
          if (from !== 'hex') hex.value = values[role.key];
          preview();
        };
        swatch.addEventListener('input', () => sync(swatch.value, 'swatch'));
        hex.addEventListener('input', () => sync(hex.value.trim(), 'hex'));
        rolesPane.append(el('div', { class: 'row' }, [
          swatch,
          el('div', {}, [el('label', { textContent: role.label }), el('small', { textContent: role.hint })]),
          hex,
        ]));
      }
      main.append(rolesPane);

      // -- inspect
      const inspectPane = el('div', { class: 'pane' });
      panes.inspect = inspectPane;
      const inspectOut = el('div', {}, [el('p', { class: 'empty', textContent: t('nothing') })]);
      const pickButton = el('button', { class: 'action primary', textContent: t('pick') });

      const describe = (element) => {
        inspectOut.replaceChildren();
        const computed = getComputedStyle(element);
        const rules = matchedRules(element, document.styleSheets);
        const resolve = (name) =>
          getComputedStyle(document.documentElement).getPropertyValue(name).trim()
          || computed.getPropertyValue(name).trim();

        const label = element.tagName.toLowerCase()
          + (element.id ? `#${element.id}` : '')
          + (element.getAttribute('data-qa') ? `[data-qa="${element.getAttribute('data-qa')}"]` : '')
          + [...element.classList].map((c) => `.${c}`).join('');

        const identity = el('div', { class: 'card' }, [
          el('h2', { textContent: t('picked') }),
          el('code', { textContent: label }),
        ]);
        inspectOut.append(identity);

        // What it looks like right now, with the colours offered as roles.
        const painted = el('div', { class: 'card' }, [el('h2', { textContent: t('paintedBy') })]);
        for (const [prop, name] of [['background-color', 'background'], ['color', 'text'],
          ['border-color', 'border']]) {
          const raw = computed.getPropertyValue(prop);
          const hex = toHex(raw);
          if (!hex) continue;
          const line = el('div', { class: 'var' });
          const chip = el('span', { class: 'swatch' });
          chip.style.background = hex;
          line.append(chip, el('code', { textContent: `${name}: ${hex}` }));
          for (const role of ROLES) {
            const use = el('button', { class: 'action', textContent: `${t('useVar')} ${role.label}` });
            use.style.fontSize = '11px';
            use.addEventListener('click', () => { setRole(role.key, hex); preview(); showTab('roles'); });
            if (['bg', 'chrome', 'text', 'accent'].includes(role.key)) line.append(use);
          }
          painted.append(line);
        }
        inspectOut.append(painted);

        // The variables those rules read: the answer to "what changes this".
        const vars = variablesIn(rules, resolve);
        const varCard = el('div', { class: 'card' }, [el('h2', { textContent: t('variables') })]);
        if (vars.length === 0) {
          varCard.append(el('p', { class: 'empty', textContent: t('noVars') }));
        } else {
          for (const entry of vars.slice(0, 40)) {
            const line = el('div', { class: 'var' });
            const chip = el('span', { class: 'swatch' });
            chip.style.background = /^\d/.test(entry.value) ? `rgb(${entry.value})` : entry.value;
            line.append(chip, el('code', { textContent: `${entry.name}: ${entry.value || '—'}` }));
            varCard.append(line);
          }
        }
        inspectOut.append(varCard);

        const ruleCard = el('div', { class: 'card' }, [el('h2', { textContent: t('matchedRules') })]);
        if (rules.length === 0) {
          ruleCard.append(el('p', { class: 'empty', textContent: t('noRules') }));
        } else {
          const list = el('ul', { class: 'rules' });
          for (const rule of rules.slice(0, 60)) {
            list.append(el('li', {}, [
              el('code', { textContent: `${rule.selector} { ${rule.text.slice(0, 160)} }` }),
            ]));
          }
          ruleCard.append(list);
        }
        inspectOut.append(ruleCard);
      };

      pickButton.addEventListener('click', () => {
        pickButton.textContent = t('picking');
        child.blur();
        window.focus();
        startPicking((element) => {
          pickButton.textContent = t('pick');
          describe(element);
          child.focus();
        });
      });
      inspectPane.append(pickButton, inspectOut);
      main.append(inspectPane);

      // -- classes
      const classPane = el('div', { class: 'pane' });
      panes.classes = classPane;
      const classInput = el('input', { type: 'text', class: 'hex', spellcheck: false,
        placeholder: '.c-message_kit__background' });
      const classCount = el('p', { class: 'empty' });
      const showButton = el('button', { class: 'action primary', textContent: t('highlight') });
      const clearButton = el('button', { class: 'action', textContent: t('clear') });
      showButton.addEventListener('click', () => {
        const selector = classInput.value.trim();
        if (!selector) return;
        const found = markAll(selector);
        classCount.textContent = t('classCount', { count: found });
      });
      clearButton.addEventListener('click', () => { clearMarks(); classCount.textContent = ''; });
      classInput.addEventListener('input', () => {
        const selector = classInput.value.trim();
        if (!selector) { classCount.textContent = ''; return; }
        try {
          classCount.textContent = t('classCount', { count: document.querySelectorAll(selector).length });
        } catch {
          classCount.textContent = '';
        }
      });
      classPane.append(
        el('div', { class: 'field' }, [el('label', { textContent: t('classSearch') }), classInput]),
        el('div', { class: 'actions' }, [showButton, clearButton]),
        classCount,
      );
      main.append(classPane);

      // -- free CSS
      const cssPane = el('div', { class: 'pane' });
      panes.css = cssPane;
      const cssArea = el('textarea', { spellcheck: false,
        placeholder: '.c-message_kit__background:hover { background: #202027; }' });
      cssArea.addEventListener('input', () => { extraCss = cssArea.value; preview(); });
      cssPane.append(
        el('p', { class: 'intro', textContent: t('cssHint') }),
        cssArea,
      );
      main.append(cssPane);

      // -- footer
      const nameInput = el('input', { type: 'text', value: 'My theme', spellcheck: false });
      const status = el('div', { class: 'status' });
      const save = el('button', { class: 'action primary', textContent: t('save') });
      save.addEventListener('click', () => {
        const label = nameInput.value.trim();
        if (!label) { status.textContent = t('needsName'); return; }
        const id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
          || 'custom-theme';
        void api.saveTheme({
          id, name: label,
          description: `A theme built with SlackMod's theme builder, from ${ROLES.length} colours.`,
          css: buildThemeCss(values, label, extraCss),
        }).then(() => {
          status.textContent = t('saved');
          api.ui.toast(t('saved'));
        }).catch((err) => { status.textContent = err.message; });
      });

      const copy = el('button', { class: 'action', textContent: t('copy') });
      copy.addEventListener('click', () => {
        void api.helpers.copy(buildThemeCss(values, nameInput.value || 'Custom', extraCss), t('copied'));
      });

      const reset = el('button', { class: 'action', textContent: t('reset') });
      reset.addEventListener('click', () => { child.close(); open(); });

      doc.body.append(el('footer', {}, [
        el('div', { class: 'field' }, [el('label', { textContent: t('name') }), nameInput]),
        el('div', { class: 'actions' }, [save, copy, reset]),
        status,
      ]));

      showTab('roles');
      preview();

      // The preview belongs to the builder: closing the window puts Slack back,
      // and takes every overlay with it.
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
