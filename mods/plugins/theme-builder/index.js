// A theme workbench, in a window of its own.
//
// WHY A SEPARATE WINDOW, AND WHY NOTHING IN IT IS A PREVIEW
//
// `window.open` works from Slack's renderer and the child inherits the origin,
// so parent and child hold direct references to each other: the controls live
// in the new window and call straight into this module. No message passing, no
// serialisation.
//
// Which means the preview is Slack. Every change repaints the real client
// beside this window, immediately, in the state you left it and with your own
// messages in it. An earlier version drew fragments of Slack in here as well --
// a channel row, a message, a composer. They were a worse copy of what was
// already on screen, and they took half the window.
//
// HOW IT IS LAID OUT, AND WHY
//
// Like Slack's own preferences: a rail of sections on the left, one view at a
// time on the right, a bar of actions along the bottom. The version before this
// stacked every tool in one scrolling column, which is not an interface -- it
// is a list of controls in the order they were written. Each of the four views
// is one job: choose colours, find out what paints something, search every
// token, write CSS by hand.
//
// The window's own chrome is a deliberate copy of Slack's design system
// (ui.js + window.css), because this is a separate document and none of Slack's
// stylesheet reaches it. It is fixed, never painted with the theme being
// edited: a workbench repainted by the work becomes unreadable exactly when you
// need to read it.

import { contrast, derivePalette, formatCss, parseColour, readability } from './colour.js';
import { createPicker } from './picker.js';
import { buildThemeCss, ROLES } from './roles.js';
import { collectTokens, familyOf, formatFor, kindOf, swatch as swatchOf } from './tokens.js';
import { STRINGS } from './strings.js';
import { createUi } from './ui.js';
import { createPaletteView } from './views/palette.js';
import { createInspectView } from './views/inspect.js';
import { createTokensView } from './views/tokens.js';
import { createCodeView } from './views/code.js';

// Re-exported so this mod's tests exercise what the app loads, through the
// entry the app loads it by.
export { buildThemeCss, CONTRAST_CHECKS, ROLES } from './roles.js';
export { matchedRules, variablesIn } from './inspect.js';
export { collectTokens, kindOf, tokenCss } from './tokens.js';
export {
  contrast, derivePalette, formatCss, formatTriplet, parseColour, readability,
} from './colour.js';

const WINDOW_NAME = 'slackmod-theme-builder';
const OVERLAY_ID = 'slackmod-inspect-overlay';

// Two panes, so it needs the width of a preferences dialog. Slack still has
// most of the screen, which is the point.
const WINDOW_FEATURES = 'width=880,height=760,resizable=yes';

const ICONS = {
  palette: '<svg viewBox="0 0 20 20"><path fill="currentColor" d="M10 2.5a7.5 7.5 0 0 0 0 15c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1a1.5 1.5 0 0 1 1.09-2.5h1.8A4.5 4.5 0 0 0 18.5 8c0-3.03-3.81-5.5-8.5-5.5M4 10a6 6 0 0 1 6-6c3.95 0 7 2.02 7 4a3 3 0 0 1-3 3h-1.8a3 3 0 0 0-2.18 5.06.5.5 0 0 1-.52.44A6 6 0 0 1 4 10"/><circle cx="6.75" cy="9.75" r="1.25" fill="currentColor"/><circle cx="9.25" cy="6.25" r="1.25" fill="currentColor"/><circle cx="13.25" cy="6.75" r="1.25" fill="currentColor"/></svg>',
  inspect: '<svg viewBox="0 0 20 20"><path fill="currentColor" d="M3 3.75A.75.75 0 0 1 3.75 3h4a.75.75 0 0 1 0 1.5H4.5v3.25a.75.75 0 0 1-1.5 0zm9.5 0A.75.75 0 0 1 13.25 3h3A.75.75 0 0 1 17 3.75v4a.75.75 0 0 1-1.5 0V4.5h-3.25a.75.75 0 0 1-.75-.75M3.75 12a.75.75 0 0 1 .75.75v2.75h3.25a.75.75 0 0 1 0 1.5h-4a.75.75 0 0 1-.75-.75v-3.5a.75.75 0 0 1 .75-.75m12.5 0a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-.75.75h-3a.75.75 0 0 1 0-1.5h2.25v-2.75a.75.75 0 0 1 .75-.75M10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6"/></svg>',
  tokens: '<svg viewBox="0 0 20 20"><path fill="currentColor" d="M3 5.25c0-.69.56-1.25 1.25-1.25h11.5c.69 0 1.25.56 1.25 1.25v1.5c0 .69-.56 1.25-1.25 1.25H4.25C3.56 8 3 7.44 3 6.75zm1.5.25v1h11v-1zM3 11.25c0-.69.56-1.25 1.25-1.25h11.5c.69 0 1.25.56 1.25 1.25v1.5c0 .69-.56 1.25-1.25 1.25H4.25C3.56 14 3 13.44 3 12.75zm1.5.25v1h11v-1zM4.25 16h6.5a.75.75 0 0 1 0 1.5h-6.5a.75.75 0 0 1 0-1.5"/></svg>',
  code: '<svg viewBox="0 0 20 20"><path fill="currentColor" d="M7.53 5.47a.75.75 0 0 1 0 1.06L4.06 10l3.47 3.47a.75.75 0 1 1-1.06 1.06l-4-4a.75.75 0 0 1 0-1.06l4-4a.75.75 0 0 1 1.06 0m4.94 0a.75.75 0 0 1 1.06 0l4 4a.75.75 0 0 1 0 1.06l-4 4a.75.75 0 1 1-1.06-1.06L15.94 10l-3.47-3.47a.75.75 0 0 1 0-1.06"/></svg>',
};

export default {
  async start(api) {
    const t = api.i18n.strings(STRINGS);
    let child = null;

    /** The frame drawn over whatever the pointer is on, while picking. */
    const overlay = () => {
      let node = document.getElementById(OVERLAY_ID);
      if (!node) {
        node = api.dom.h('div', { id: OVERLAY_ID });
        Object.assign(node.style, {
          position: 'fixed', pointerEvents: 'none', zIndex: '99999', display: 'none',
          border: '2px solid #1264a3', background: 'rgba(18,100,163,.18)', borderRadius: '4px',
        });
        document.body.append(node);
      }
      return node;
    };

    const open = () => {
      if (child && !child.closed) { child.focus(); api.ui.toast(t('already')); return; }
      child = window.open('', WINDOW_NAME, WINDOW_FEATURES);
      if (!child) { api.ui.toast(t('blocked'), { variant: 'error' }); return; }

      const doc = child.document;
      doc.open();
      doc.write('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
      doc.close();
      doc.documentElement.setAttribute('data-slackmod-window', 'theme-builder');
      doc.documentElement.lang = api.i18n.language;
      doc.title = t('title');
      doc.head.append(Object.assign(doc.createElement('style'), {
        textContent: api.assets.text('window.css'),
      }));

      const ui = createUi(doc);
      const { el } = ui;

      // ------------------------------------------------------------- state

      const state = {
        name: t('defaultName'),
        seeds: { bg: parseColour('#1a1a1e'), accent: parseColour('#536aed') },
        roleOverrides: {},
        tokenOverrides: {},
        baseCss: '',
        extraCss: '',
        suspended: false,
      };

      const palette = () => ({ ...derivePalette(state.seeds.bg, state.seeds.accent), ...state.roleOverrides });
      const themeCss = () =>
        `${state.baseCss}\n${buildThemeCss(palette(), state.name || 'Custom', state.extraCss, state.tokenOverrides)}`;

      /**
       * Push the theme into Slack, then let the open view catch up.
       *
       * Suspending swaps in an empty stylesheet rather than tearing anything
       * down, so comparing against what the theme replaces is one click and
       * costs nothing.
       */
      const apply = () => {
        api.css(state.suspended ? '' : themeCss());
        views[current]?.refresh();
      };

      // ------------------------------------------------------- shared context

      const familyLabel = (key) => t(`family_${key}`);

      const ctx = {
        api, t, doc, ui, state, palette, themeCss, apply, overlay,
        tokens: [],
        familyLabel,
        swatchOf,
        kindOfToken: (name, value) => (kindOf(value) === 'triplet' ? 'triplet' : 'colour'),
        focusSlack: () => { child.blur(); window.focus(); },
        focusBuilder: () => child.focus(),
        copyCss: () => { void api.helpers.copy(themeCss(), t('copied')); },

        /** Open the colour editor next to whatever was clicked. */
        openPicker(anchor, { value, title, onChange, reset }) {
          let handle;
          const picker = createPicker(doc, {
            value,
            title,
            onChange,
            onReset: reset ? { label: reset.label, run: () => { reset.run(); handle.close(); } } : null,
          });
          handle = ui.popover(picker.node, anchor);
        },

        /** The same editor, pointed at one of Slack's own tokens. */
        editToken(token, anchor, after) {
          const kind = ctx.kindOfToken(token.name, token.value);
          ctx.openPicker(anchor, {
            value: swatchOf(state.tokenOverrides[token.name] ?? token.value),
            title: token.name,
            reset: token.name in state.tokenOverrides
              ? { label: t('drop'), run: () => { delete state.tokenOverrides[token.name]; apply(); after?.(); } }
              : null,
            onChange: (colour) => {
              // Written the way this token's own family reads it: two of them
              // take bare "r, g, b" and silently paint nothing otherwise.
              state.tokenOverrides[token.name] = formatFor(kind, colour);
              apply();
              after?.();
            },
          });
        },
      };

      // ------------------------------------------------------------ title bar

      const nameInput = ui.input({ value: state.name, class: 'input title-input' });
      nameInput.addEventListener('input', () => { state.name = nameInput.value; apply(); });

      const baseSelect = ui.select(
        [{ value: '', label: t('scratch') }, ...api.themes.list().map((theme) => ({
          value: theme.id, label: theme.name,
        }))],
        {
          title: t('baseHint'),
          onChange: (id) => {
            if (!id) { state.baseCss = ''; apply(); return; }
            void api.themes.source(id).then((css) => { state.baseCss = css; apply(); });
          },
        },
      );

      const titlebar = el('header', { class: 'titlebar' }, [
        el('div', { class: 'titlebar__name' }, [
          el('span', { class: 'titlebar__label', textContent: t('themeName') }),
          nameInput,
        ]),
        el('div', { class: 'titlebar__base' }, [
          el('span', { class: 'titlebar__label', textContent: t('base') }),
          baseSelect,
        ]),
      ]);

      // ----------------------------------------------------------------- rail

      const content = el('main', { class: 'content' });
      const rail = el('nav', { class: 'rail', 'aria-label': t('title') });

      const views = {};
      let current = 'palette';

      const SECTIONS = [
        { key: 'palette', label: t('palette'), hint: t('paletteRail'), icon: ICONS.palette,
          make: () => createPaletteView(ctx) },
        { key: 'inspect', label: t('inspect'), hint: t('inspectRail'), icon: ICONS.inspect,
          make: () => createInspectView(ctx) },
        { key: 'tokens', label: t('tokens'), hint: t('tokensRail'), icon: ICONS.tokens,
          make: () => createTokensView(ctx) },
        { key: 'code', label: t('code'), hint: t('codeRail'), icon: ICONS.code,
          make: () => createCodeView(ctx) },
      ];

      const railItems = new Map();
      const show = (key) => {
        current = key;
        for (const [id, item] of railItems) item.setAttribute('aria-current', String(id === key));
        // Views are built the first time they are opened: collecting five
        // hundred tokens costs something, and most sessions never leave the
        // palette.
        if (!views[key]) views[key] = SECTIONS.find((s) => s.key === key).make();
        content.replaceChildren(views[key].node);
        views[key].refresh();
      };

      for (const section of SECTIONS) {
        const item = el('button', { class: 'rail__item', type: 'button', title: section.hint }, [
          el('span', { class: 'rail__icon', html: section.icon }),
          el('span', { class: 'rail__text' }, [
            el('strong', { textContent: section.label }),
            el('small', { textContent: section.hint }),
          ]),
        ]);
        item.addEventListener('click', () => show(section.key));
        railItems.set(section.key, item);
        rail.append(item);
      }

      // --------------------------------------------------------------- footer

      const status = el('div', { class: 'status', role: 'status' });

      const suspend = ui.button(t('suspend'), {
        variant: 'ghost',
        title: t('suspendHint'),
        onClick: () => {
          state.suspended = !state.suspended;
          suspend.querySelector('span:last-child').textContent =
            state.suspended ? t('resume') : t('suspend');
          suspend.setAttribute('data-on', String(state.suspended));
          status.textContent = state.suspended ? t('suspended') : '';
          apply();
        },
      });

      const save = ui.button(t('save'), {
        variant: 'primary',
        onClick: () => {
          const label = state.name.trim();
          if (!label) { status.textContent = t('needsName'); nameInput.focus(); return; }
          const id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
            || 'custom-theme';
          void api.saveTheme({
            id,
            name: label,
            description: t('savedDescription'),
            css: buildThemeCss(palette(), label, state.extraCss, state.tokenOverrides),
          })
            .then(() => { status.textContent = t('saved'); api.ui.toast(t('saved')); })
            .catch((err) => { status.textContent = err.message; });
        },
      });

      const footer = el('footer', { class: 'actions' }, [
        suspend,
        status,
        ui.button(t('copy'), { variant: 'ghost', onClick: () => ctx.copyCss() }),
        save,
      ]);

      doc.body.append(el('div', { class: 'app' }, [
        titlebar,
        el('div', { class: 'app__body' }, [rail, content]),
        footer,
      ]));

      // ----------------------------------------------------------------- boot

      ctx.tokens = collectTokens(document);
      show('palette');
      apply();

      child.addEventListener('unload', () => {
        api.css('');
        document.getElementById(OVERLAY_ID)?.remove();
      });
    };

    api.slack.addToolbarButton('controlStrip', {
      id: 'theme-builder',
      label: t('open'),
      description: t('openHint'),
      icon: ICONS.palette,
      onClick: open,
    });

    api.onDispose(() => {
      document.getElementById(OVERLAY_ID)?.remove();
      if (child && !child.closed) child.close();
    });
  },
};
