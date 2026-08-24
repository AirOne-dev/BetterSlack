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
import { buildThemeCss, ROLES, targetsForRole } from './roles.js';
import { collectTokens, familyOf, formatFor, kindOf, swatch as swatchOf } from './tokens.js';
import { rolesFrom, rolesFromClient } from './read-theme.js';
import { buildTokenIndex, createHighlighter, elementsUsing } from './highlight.js';
import { STRINGS } from './strings.js';
import { createPaletteView } from './views/palette.js';
import { createInspectView } from './views/inspect.js';
import { createTokensView } from './views/tokens.js';
import { createCodeView } from './views/code.js';
import { createStartView } from './views/start.js';

// Re-exported so this mod's tests exercise what the app loads, through the
// entry the app loads it by.
export { buildThemeCss, CONTRAST_CHECKS, ROLES } from './roles.js';
export { matchedRules, variablesIn } from './inspect.js';
export { collectTokens, kindOf, tokenCss } from './tokens.js';
export { declaredColours, rolesFrom, stripFrom } from './read-theme.js';
export { buildTokenIndex, elementsUsing } from './highlight.js';
export { targetsForRole, tokensForRole } from './roles.js';
export {
  contrast, derivePalette, formatCss, formatTriplet, parseColour, readability,
} from './colour.js';

const WINDOW_NAME = 'betterslack-theme-builder';
const OVERLAY_ID = 'betterslack-inspect-overlay';

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
      doc.documentElement.setAttribute('data-betterslack-window', 'theme-builder');
      doc.documentElement.lang = api.i18n.language;
      doc.title = t('title');
      doc.head.append(Object.assign(doc.createElement('style'), {
        textContent: api.assets.text('window.css'),
      }));

      // Slack's design system, from the API rather than rebuilt here: this
      // window is a blank document, so the stylesheet has to come with it.
      const ui = api.ui.kit(doc);
      doc.head.append(Object.assign(doc.createElement('style'), { textContent: api.ui.kitCss }));
      const { el } = ui;

      // ------------------------------------------------------------- state

      const highlighter = createHighlighter(document);
      /** Built on first hover: inverting Slack's sheets is not free. */
      let tokenIndex = null;

      const DEFAULTS = () => ({
        name: t('defaultName'),
        seeds: { bg: parseColour('#1a1a1e'), accent: parseColour('#536aed') },
        roleOverrides: {},
        tokenOverrides: {},
        base: '',
        baseCss: '',
        extraCss: '',
        suspended: false,
      });

      const state = DEFAULTS();

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
        // While the builder owns the screen, the user's own themes are held
        // back: otherwise picking a base changes nothing visible, because
        // whatever is switched on is still painting underneath. Suspending puts
        // them straight back, which is what makes it a before-and-after.
        api.themes.suspend(!state.suspended);
        views[current]?.refresh();
        saveDraft();
      };

      /**
       * Keep the work, in the loader's settings file rather than localStorage:
       * the renderer's storage is Slack's and gets wiped by an app update,
       * while this survives one -- and survives the window being closed by
       * accident, which is the case that actually happens.
       */
      let draftTimer = null;
      const saveDraft = () => {
        clearTimeout(draftTimer);
        draftTimer = setTimeout(() => {
          void api.settings.set('draft', {
            name: state.name,
            seeds: state.seeds,
            roleOverrides: state.roleOverrides,
            tokenOverrides: state.tokenOverrides,
            base: state.base,
            extraCss: state.extraCss,
            savedAt: Date.now(),
          });
        }, 400);
      };

      // ------------------------------------------------------- shared context

      const familyLabel = (key) => t(`family_${key}`);

      const ctx = {
        api, t, doc, ui, state, palette, themeCss, apply, overlay,
        tokens: [],
        familyLabel,
        swatchOf,
        targetsForRole,

        /**
         * Outline everything in the real Slack that these tokens paint.
         *
         * This is the answer to "what does Surface actually mean", and it is
         * only useful while the pointer is on the swatch -- so it is bound to
         * hover, and cleared the moment the pointer leaves.
         */
        highlight(target) {
          if (!tokenIndex) tokenIndex = buildTokenIndex(document.styleSheets);
          highlighter.show(elementsUsing(target, tokenIndex, document));
        },
        highlightToken: (name) => ctx.highlight({ tokens: [name] }),
        highlightSelector: (selector) => ctx.highlight({ selectors: [selector] }),
        highlightElement: (element) => highlighter.show([element]),
        highlightRole: (key) => ctx.highlight(targetsForRole(key)),
        unhighlight: () => highlighter.clear(),

        /** Copy, and say so where the click happened rather than in Slack. */
        async copy(text, node) {
          const done = await ui.copyText(text);
          if (!node) return;
          node.setAttribute('data-copied', String(done));
          setTimeout(() => node.removeAttribute('data-copied'), 1200);
        },
        kindOfToken: (name, value) => (kindOf(value) === 'triplet' ? 'triplet' : 'colour'),
        focusSlack: () => { child.blur(); window.focus(); },
        focusBuilder: () => child.focus(),
        copyCss: () => { void api.helpers.copy(themeCss(), t('copied')); },
        savedDraft: () => api.settings.get('draft', null),

        /** Leave the start screen for a fresh theme on top of `base`. */
        begin: ({ base, name }) => {
          Object.assign(state, DEFAULTS(), { name });
          nameInput.value = name;
          void setBase(base).then(() => enterBuilder());
        },

        /** Leave it carrying on with what was saved. */
        resume: (draft) => {
          Object.assign(state, DEFAULTS(), {
            name: draft.name ?? t('defaultName'),
            seeds: draft.seeds ?? DEFAULTS().seeds,
            roleOverrides: draft.roleOverrides ?? {},
            tokenOverrides: draft.tokenOverrides ?? {},
            extraCss: draft.extraCss ?? '',
          });
          nameInput.value = state.name;
          void setBase(draft.base ?? '', { takeColours: false }).then(() => enterBuilder());
        },

        /** Open the colour editor next to whatever was clicked. */
        openPicker(anchor, { value, title, onChange, reset, onClose }) {
          let handle;
          const picker = createPicker(doc, ui, {
            value,
            title,
            onChange,
            onReset: reset ? { label: reset.label, run: () => { reset.run(); handle.close(); } } : null,
          });
          handle = ui.popover(picker.node, anchor, { onClose });
        },

        /** The same editor, pointed at one of Slack's own tokens. */
        editToken(token, anchor, after) {
          const kind = ctx.kindOfToken(token.name, token.value);
          ctx.highlightToken(token.name);
          ctx.openPicker(anchor, {
            onClose: () => ctx.unhighlight(),
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
              ctx.highlightToken(token.name);
            },
          });
        },
      };

      // ------------------------------------------------------------ title bar

      const nameInput = ui.input({ value: state.name, class: 'title-input' });
      nameInput.addEventListener('input', () => { state.name = nameInput.value; apply(); });

      const baseSelect = ui.select(
        [{ value: '', label: t('scratch') }, ...api.themes.list().map((theme) => ({
          value: theme.id,
          label: theme.enabled ? t('startThemeActive', { name: theme.name }) : theme.name,
        }))],
        { title: t('baseHint'), onChange: (id) => void setBase(id) },
      );

      /**
       * Put a theme under the palette -- and start the palette *at* it.
       *
       * Loading the stylesheet alone was not enough, and the way it failed was
       * confusing: the base went in first and the twelve derived roles went in
       * after, so a chosen theme's fonts and layout appeared while its colours
       * were immediately painted over by a palette nobody had chosen. Every
       * theme looked the same and only the parts a palette cannot express
       * changed. Reading the theme's own colours into the roles is what
       * "start from" has to mean.
       *
       * Roles the theme says nothing about stay derived, so a theme that only
       * sets a background still gets a coherent palette around it.
       */
      const setBase = async (id, { takeColours = true } = {}) => {
        state.base = id;
        baseSelect.value = id;
        state.baseCss = id ? await api.themes.source(id) : '';

        // Not when a draft is being restored: the palette in it *is* the work,
        // and reading the base over the top would throw away everything the
        // draft was saved for while looking like it had loaded correctly.
        if (takeColours) {
          // With no base, "Slack's own colours" is meant literally: the app is
          // showing them right now, since the builder holds the user's themes
          // back while it is open.
          const roles = id ? rolesFrom(state.baseCss) : rolesFromClient(document);
          const { bg, accent, ...rest } = roles;
          if (bg) state.seeds.bg = bg;
          if (accent) state.seeds.accent = accent;
          state.roleOverrides = rest;
        }
        apply();
      };

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

      /**
       * Before-and-after in one click: our stylesheet comes off and the user's
       * own themes come back, which is what Slack looks like when the builder
       * is not open. Nothing in here is touched, so it is a comparison rather
       * than an undo.
       */
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

      const reset = ui.button(t('reset'), {
        variant: 'ghost',
        title: t('resetHint'),
        onClick: async () => {
          const ok = await ui.confirm({
            title: t('resetTitle'),
            body: t('resetBody'),
            action: t('resetConfirm'),
            cancel: t('cancel'),
            danger: true,
          });
          if (!ok) return;
          Object.assign(state, DEFAULTS(), { suspended: state.suspended });
          baseSelect.value = '';
          status.textContent = t('wasReset');
          apply();
        },
      });

      /*
       * A theme you can hand to someone.
       *
       * Saving puts it in your own Themes list, which is where you want it and
       * nowhere anyone else can reach. Export writes the same stylesheet as a
       * file; import reads one back in as the base, which is also how a theme
       * someone sent you becomes something you can edit rather than just run.
       */
      const exportCss = ui.button(t('exportTheme'), {
        variant: 'ghost',
        title: t('exportHint'),
        onClick: () => {
          const blob = new child.Blob([themeCss()], { type: 'text/css' });
          const url = child.URL.createObjectURL(blob);
          const link = el('a', {
            href: url,
            download: `${(state.name || 'theme').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.css`,
          });
          doc.body.append(link);
          link.click();
          link.remove();
          setTimeout(() => child.URL.revokeObjectURL(url), 10_000);
          status.textContent = t('exported');
        },
      });

      const picker = el('input', { type: 'file', accept: '.css,text/css', hidden: 'hidden' });
      picker.addEventListener('change', () => {
        const chosen = picker.files?.[0];
        if (!chosen) return;
        void chosen.text().then((css) => {
          state.base = '';
          state.baseCss = css;
          baseSelect.value = '';
          // Read back into the palette, so an imported theme is editable rather
          // than a stylesheet sitting underneath one that overwrites it.
          const roles = rolesFrom(css);
          const { bg, accent, ...rest } = roles;
          if (bg) state.seeds.bg = bg;
          if (accent) state.seeds.accent = accent;
          state.roleOverrides = rest;
          state.name = chosen.name.replace(/\.css$/i, '');
          nameInput.value = state.name;
          status.textContent = t('imported', { name: chosen.name });
          apply();
        });
      });
      const importCss = ui.button(t('importTheme'), {
        variant: 'ghost',
        title: t('importHint'),
        onClick: () => picker.click(),
      });

      const footer = el('footer', { class: 'actions' }, [
        suspend,
        reset,
        importCss,
        exportCss,
        picker,
        status,
        ui.button(t('copy'), { variant: 'ghost', onClick: () => ctx.copyCss() }),
        save,
      ]);

      const app = el('div', { class: 'app' }, [
        titlebar,
        el('div', { class: 'app__body' }, [rail, content]),
        footer,
      ]);
      const start = createStartView(ctx);
      doc.body.append(start.node, app);

      /**
       * Swap the door for the workbench.
       *
       * The tokens are collected here rather than at boot: it is the one
       * expensive thing this window does, and the start screen does not need
       * them -- so the door opens instantly however big the client's stylesheet
       * has become.
       */
      const enterBuilder = () => {
        if (!ctx.tokens.length) ctx.tokens = collectTokens(document);
        start.node.remove();
        app.setAttribute('data-open', 'true');
        show('palette');
        apply();
      };

      // ----------------------------------------------------------------- boot

      start.refresh();

      child.addEventListener('unload', () => {
        api.css('');
        // The user's own themes come back the moment the builder goes away.
        api.themes.suspend(false);
        highlighter.dispose();
        document.getElementById(OVERLAY_ID)?.remove();
      });
    };

    // Findable by typing, as well as by looking: the rail is Slack's and there
    // is no room in it for every idea.
    api.commands.add({ id: 'open', title: t('open'), subtitle: t('openHint'), run: open });

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
