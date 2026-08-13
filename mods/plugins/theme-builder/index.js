// A theme builder, in a window of its own, applying as you drag.
//
// WHY A SEPARATE WINDOW
//
// A theme is judged against the whole app -- the rail beside the sidebar beside
// a conversation -- and a panel covering half of it hides the thing being
// judged. `window.open` works from Slack's renderer and the child inherits the
// origin, so parent and child see each other directly: the controls live in the
// new window and call straight into this module. No message passing, no
// serialisation, and the preview is the real application rather than a swatch.
//
// The window marks itself with `data-slackmod-window`, which the loader looks
// for before painting a theme into Slack's other windows. A builder repainted
// by the theme being edited becomes unreadable exactly when you need to read it.
//
// WHY TWELVE COLOURS AND NOT TWO HUNDRED
//
// Slack paints from four families of custom properties and several hundred
// names. Editing those directly is not a design tool, it is a spreadsheet. What
// the themes in this repository actually do is pick a dozen roles and map them
// across all four families, so that is what this edits: twelve roles, and the
// mapping below turns them into a complete theme. It is the same mapping the
// hand-written themes use, which is why the output looks like one of them.

const WINDOW_NAME = 'slackmod-theme-builder';
const STYLE_ID = 'slackmod-theme-builder-preview';

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
    intro: 'Drag a colour and Slack follows immediately. Nothing is saved until you say so.',
    name: 'Theme name',
    save: 'Save as a theme',
    copy: 'Copy the CSS',
    reset: 'Start over',
    saved: 'Saved. It is in your Themes list.',
    copied: 'Theme CSS copied',
    needsName: 'Give the theme a name first.',
    blocked: 'Slack refused to open a window. Allow pop-ups for the app.',
    already: 'The builder is already open.',
  },
  fr: {
    open: 'Constructeur de thème',
    openHint: 'Concevoir un thème avec l’app comme aperçu',
    title: 'Constructeur de thème',
    intro: 'Bougez une couleur, Slack suit aussitôt. Rien n’est enregistré tant que vous ne le demandez pas.',
    name: 'Nom du thème',
    save: 'Enregistrer comme thème',
    copy: 'Copier le CSS',
    reset: 'Tout reprendre',
    saved: 'Enregistré. Il est dans votre liste de thèmes.',
    copied: 'CSS du thème copié',
    needsName: 'Donnez d’abord un nom au thème.',
    blocked: 'Slack a refusé d’ouvrir une fenêtre. Autorisez les fenêtres surgissantes.',
    already: 'Le constructeur est déjà ouvert.',
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

/** Perceived lightness, for deciding what reads on top of a colour. */
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Twelve roles to a whole theme.
 *
 * The mapping is the one the hand-written themes here use: the content family
 * takes plain colours, the chrome and legacy families need !important because
 * Slack sets them on more specific selectors, and the legacy family wants bare
 * triplets rather than colours. Getting any of those wrong leaves half the app
 * in its old palette, which is the single most common way a theme looks broken.
 */
export function buildThemeCss(values, name = 'Custom') {
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
  --dt_color-base-imp: ${v.danger}22;

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
`;
}

/** The builder window's own styling, deliberately independent of any theme. */
const WINDOW_CSS = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 20px;
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #17171a;
    color: #ececee;
  }
  h1 { margin: 0 0 4px; font-size: 18px; }
  p.intro { margin: 0 0 18px; color: #9a9aa2; font-size: 13px; }
  .role {
    display: grid;
    grid-template-columns: 44px 1fr 96px;
    gap: 12px;
    align-items: center;
    padding: 7px 0;
    border-bottom: 1px solid #26262b;
  }
  .role label { display: block; font-weight: 600; }
  .role small { color: #82828b; }
  input[type=color] {
    width: 44px; height: 30px; padding: 0; border: 1px solid #34343a;
    border-radius: 6px; background: none; cursor: pointer;
  }
  input[type=text] {
    width: 100%; padding: 6px 8px; border-radius: 6px; border: 1px solid #34343a;
    background: #1e1e22; color: inherit; font-family: ui-monospace, Menlo, monospace;
  }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
  button {
    padding: 8px 14px; border-radius: 6px; border: 1px solid #34343a;
    background: #24242a; color: inherit; font: inherit; cursor: pointer;
  }
  button:hover { background: #2d2d34; }
  button.primary { background: #4a5bd0; border-color: #4a5bd0; }
  button.primary:hover { background: #5a6ae0; }
  .name { margin-top: 18px; }
  .name label { display: block; margin-bottom: 6px; font-weight: 600; }
  .status { margin-top: 10px; min-height: 18px; font-size: 13px; color: #7fd18d; }
`;

export default {
  async start(api) {
    const t = api.i18n.strings(STRINGS);
    let child = null;

    const open = () => {
      if (child && !child.closed) {
        child.focus();
        api.ui.toast(t('already'));
        return;
      }
      child = window.open('', WINDOW_NAME, 'width=460,height=760');
      if (!child) {
        api.ui.toast(t('blocked'), { variant: 'error' });
        return;
      }

      const values = Object.fromEntries(ROLES.map((r) => [r.key, r.value]));
      const doc = child.document;
      doc.open();
      doc.write('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
      doc.close();
      // The loader checks for this before painting a theme into other windows.
      doc.documentElement.setAttribute('data-slackmod-window', 'theme-builder');
      doc.title = t('title');

      const style = doc.createElement('style');
      style.textContent = WINDOW_CSS;
      doc.head.append(style);

      const el = (tag, props = {}, children = []) => {
        const node = doc.createElement(tag);
        Object.assign(node, props);
        for (const c of children) node.append(c);
        return node;
      };

      const preview = () => {
        // Straight into the parent's own stylesheet layer, so it lands above
        // every theme and disappears with the plugin.
        api.css(buildThemeCss(values, nameInput.value || 'Custom'));
      };

      doc.body.append(el('h1', { textContent: t('title') }));
      doc.body.append(el('p', { className: 'intro', textContent: t('intro') }));

      for (const role of ROLES) {
        const swatch = el('input', { type: 'color', value: role.value });
        const hex = el('input', { type: 'text', value: role.value, spellcheck: false });
        const sync = (next, from) => {
          if (!/^#[0-9a-f]{6}$/i.test(next)) return;
          values[role.key] = next.toLowerCase();
          if (from !== 'swatch') swatch.value = values[role.key];
          if (from !== 'hex') hex.value = values[role.key];
          preview();
        };
        swatch.addEventListener('input', () => sync(swatch.value, 'swatch'));
        hex.addEventListener('input', () => sync(hex.value.trim(), 'hex'));

        doc.body.append(el('div', { className: 'role' }, [
          swatch,
          el('div', {}, [
            el('label', { textContent: role.label }),
            el('small', { textContent: role.hint }),
          ]),
          hex,
        ]));
      }

      const nameInput = el('input', { type: 'text', value: 'My theme', spellcheck: false });
      doc.body.append(el('div', { className: 'name' }, [
        el('label', { textContent: t('name') }),
        nameInput,
      ]));

      const status = el('div', { className: 'status' });
      const save = el('button', { className: 'primary', textContent: t('save') });
      save.addEventListener('click', () => {
        const label = nameInput.value.trim();
        if (!label) {
          status.textContent = t('needsName');
          return;
        }
        const id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
          || 'custom-theme';
        void api.saveTheme({
          id,
          name: label,
          description: `A theme built with SlackMod's theme builder, from ${ROLES.length} colours.`,
          css: buildThemeCss(values, label),
        }).then(() => {
          status.textContent = t('saved');
          api.ui.toast(t('saved'));
        }).catch((err) => {
          status.textContent = err.message;
        });
      });

      const copy = el('button', { textContent: t('copy') });
      copy.addEventListener('click', () => {
        void api.helpers.copy(buildThemeCss(values, nameInput.value || 'Custom'), t('copied'));
      });

      const reset = el('button', { textContent: t('reset') });
      reset.addEventListener('click', () => {
        for (const role of ROLES) values[role.key] = role.value;
        child.close();
        open();
      });

      doc.body.append(el('div', { className: 'actions' }, [save, copy, reset]));
      doc.body.append(status);

      preview();
      // The preview belongs to the builder: closing the window puts Slack back.
      child.addEventListener('unload', () => api.css(''));
    };

    api.slack.addToolbarButton('controlStrip', {
      id: 'theme-builder',
      label: t('open'),
      description: t('openHint'),
      icon: PALETTE_ICON,
      onClick: open,
    });

    api.onDispose(() => {
      if (child && !child.closed) child.close();
    });
  },
};
