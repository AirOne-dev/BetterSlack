// A theme workbench, in a window of its own.
//
// WHY A SEPARATE WINDOW, AND WHY THERE IS NO PREVIEW IN IT
//
// `window.open` works from Slack's renderer and the child inherits the origin,
// so parent and child hold direct references to each other: the controls live
// in the new window and call straight into this module. No message passing, no
// serialisation.
//
// Which means the preview is Slack. Every change repaints the real client
// beside this window, immediately -- the whole application, in the state you
// left it, with your own messages in it. An earlier version drew little
// fragments of Slack in here as well; they were a worse copy of something
// already on screen, and they took half the window. What is left is controls.
//
// The window marks itself with `data-slackmod-window`, which the loader checks
// before painting a theme into Slack's other windows: a builder repainted by
// the theme being edited becomes unreadable exactly when you need to read it.
//
// WHAT IT CAN ACTUALLY DO
//
// Two colours in, twelve roles out (roles.js), which covers a theme in a
// minute. Then, for everything that is not one of those twelve, the two tools
// that make it a workbench rather than a wizard:
//
//   * Point at anything in Slack and it says which tokens paint it, each one
//     editable on the spot (inspect.js).
//   * Every colour token the client defines, searchable, each one editable
//     (tokens.js).
//
// So the twelve roles are a starting point, not a ceiling: anything Slack
// paints with a custom property can be taken over by name.

import { contrast, derivePalette, formatCss, parseColour, readability } from './colour.js';
import { createPicker, paintSwatch } from './picker.js';
import { ancestry, describe, matchedRules, pickElement, variablesIn } from './inspect.js';
import { buildThemeCss, CONTRAST_CHECKS, ROLES } from './roles.js';
import { collectTokens, familyOf, formatFor, search, swatch } from './tokens.js';
import { STRINGS } from './strings.js';

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

// One column of controls. Slack is the preview, so the window only has to be
// wide enough to read a token name.
const WINDOW_FEATURES = 'width=460,height=940,resizable=yes';

/** How many tokens to render at once. The client defines several hundred. */
const TOKEN_LIMIT = 120;

const PALETTE_ICON =
  '<svg viewBox="0 0 20 20" aria-hidden="true" style="height:20px;width:20px">' +
  '<path fill="currentColor" d="M10 2.5a7.5 7.5 0 0 0 0 15c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1a1.5 1.5 0 0 1 1.09-2.5h1.8A4.5 4.5 0 0 0 18.5 8c0-3.03-3.81-5.5-8.5-5.5M4 10a6 6 0 0 1 6-6c3.95 0 7 2.02 7 4a3 3 0 0 1-3 3h-1.8a3 3 0 0 0-2.18 5.06.5.5 0 0 1-.52.44A6 6 0 0 1 4 10"/>' +
  '<circle cx="6.75" cy="9.75" r="1.25" fill="currentColor"/><circle cx="9.25" cy="6.25" r="1.25" fill="currentColor"/>' +
  '<circle cx="13.25" cy="6.75" r="1.25" fill="currentColor"/></svg>';

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
      const style = doc.createElement('style');
      style.textContent = api.assets.text('window.css');
      doc.head.append(style);

      const el = (tag, props = {}, children = []) => {
        const node = doc.createElement(tag);
        for (const [key, value] of Object.entries(props)) {
          if (key === 'class') node.className = value;
          else if (key.includes('-')) node.setAttribute(key, value);
          else node[key] = value;
        }
        for (const item of children) {
          node.append(typeof item === 'string' ? doc.createTextNode(item) : item);
        }
        return node;
      };

      // ---------------------------------------------------------------- state

      let seeds = { bg: parseColour('#1a1a1e'), accent: parseColour('#536aed') };
      let roleOverrides = {};
      let tokenOverrides = {};
      let baseCss = '';
      let extraCss = '';
      let suspended = false;
      /** What the picker is pointed at: a role key, or a token name. */
      let editing = null;

      const palette = () => ({ ...derivePalette(seeds.bg, seeds.accent), ...roleOverrides });
      const themeCss = () =>
        `${baseCss}\n${buildThemeCss(palette(), nameInput.value || 'Custom', extraCss, tokenOverrides)}`;

      /**
       * Push the theme into Slack. Base first, then the roles, then tokens, then
       * hand-written rules: later wins, which is what "override" has to mean.
       *
       * Suspending swaps in an empty stylesheet rather than tearing anything
       * down, so a before-and-after is one click and loses no work.
       */
      const apply = () => {
        api.css(suspended ? '' : themeCss());
        paintPalette();
        paintTokens();
      };

      // --------------------------------------------------------------- picker

      const picker = createPicker(doc, (colour) => {
        if (!editing) return;
        if (editing.kind === 'role') {
          if (editing.key === 'bg' || editing.key === 'accent') seeds[editing.key] = colour;
          else roleOverrides[editing.key] = colour;
        } else {
          tokenOverrides[editing.name] = formatFor(editing.tokenKind, colour);
        }
        apply();
      });

      const editRole = (role) => {
        editing = { kind: 'role', key: role.key };
        picker.show(formatCss(palette()[role.key]), `${role.label} — ${role.hint}`);
        paintPalette();
      };

      const editToken = (token) => {
        editing = { kind: 'token', name: token.name, tokenKind: token.kind };
        picker.show(swatch(tokenOverrides[token.name] ?? token.value), token.name);
        paintTokens();
      };

      // ---------------------------------------------------------------- header

      const nameInput = el('input', { type: 'text', value: t('defaultName'), spellcheck: false });
      const status = el('div', { class: 'status' });

      const baseSelect = el('select', { title: t('baseHint') });
      baseSelect.append(el('option', { value: '', textContent: t('scratch') }));
      for (const theme of api.themes.list()) {
        baseSelect.append(el('option', { value: theme.id, textContent: theme.name }));
      }
      baseSelect.addEventListener('change', () => {
        const id = baseSelect.value;
        if (!id) { baseCss = ''; apply(); return; }
        void api.themes.source(id).then((css) => { baseCss = css; apply(); });
      });

      const saveButton = el('button', { class: 'btn primary', textContent: t('save') });
      saveButton.addEventListener('click', () => {
        const label = nameInput.value.trim();
        if (!label) { status.textContent = t('needsName'); return; }
        const id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
          || 'custom-theme';
        void api.saveTheme({
          id,
          name: label,
          description: t('savedDescription'),
          css: buildThemeCss(palette(), label, extraCss, tokenOverrides),
        })
          .then(() => { status.textContent = t('saved'); api.ui.toast(t('saved')); })
          .catch((err) => { status.textContent = err.message; });
      });

      doc.body.append(el('header', {}, [
        el('div', { class: 'row' }, [nameInput, saveButton]),
        el('div', { class: 'row' }, [el('label', { textContent: t('base') }), baseSelect]),
      ]));

      const main = el('main', {});
      doc.body.append(main);

      /** A collapsible block. Open by default only where work starts. */
      const section = (title, hint, body, open = false) => {
        const details = el('details', {}, [
          el('summary', {}, [el('span', { textContent: title }), el('small', { textContent: hint })]),
          body,
        ]);
        details.open = open;
        main.append(details);
        return details;
      };

      // --------------------------------------------------------------- palette

      const seedRow = el('div', { class: 'seeds' });
      const swatchGrid = el('div', { class: 'swatches' });
      const checks = el('div', { class: 'checks' });
      const reroll = el('button', { class: 'btn', textContent: t('reroll'), title: t('rerollHint') });
      reroll.addEventListener('click', () => {
        roleOverrides = {};
        editing = null;
        picker.hide();
        apply();
      });

      section(t('palette'), t('paletteHint'), el('div', {}, [
        seedRow,
        el('p', { class: 'hint', textContent: t('derived') }),
        swatchGrid,
        checks,
        el('div', { class: 'row end' }, [reroll]),
      ]), true);

      const paintPalette = () => {
        const colours = palette();
        const css = (key) => formatCss(colours[key]);

        seedRow.replaceChildren();
        for (const role of ROLES.filter((r) => r.seed)) {
          const chip = el('div', { class: 'chip' });
          paintSwatch(chip, css(role.key));
          const card = el('button', { class: 'seed' }, [
            chip,
            el('div', { class: 'meta' }, [
              el('strong', { textContent: role.label }),
              el('small', { textContent: css(role.key) }),
            ]),
          ]);
          card.setAttribute('data-editing', String(editing?.kind === 'role' && editing.key === role.key));
          card.addEventListener('click', () => editRole(role));
          seedRow.append(card);
        }

        swatchGrid.replaceChildren();
        for (const role of ROLES.filter((r) => !r.seed)) {
          const chip = el('div', { class: 'chip' });
          paintSwatch(chip, css(role.key));
          const button = el('button', { class: 'sw' }, [
            chip,
            el('span', { textContent: role.label }),
          ]);
          button.title = `${role.hint} — ${css(role.key)}`;
          button.setAttribute('data-own', String(Boolean(roleOverrides[role.key])));
          button.setAttribute('data-editing', String(editing?.kind === 'role' && editing.key === role.key));
          button.addEventListener('click', () => editRole(role));
          swatchGrid.append(button);
        }

        // Contrast, against the colours Slack really puts behind that text.
        checks.replaceChildren();
        for (const [fg, bg, label] of CONTRAST_CHECKS) {
          const ratio = contrast(colours[fg], colours[bg]);
          const verdict = readability(ratio);
          const grade = el('span', { class: 'grade', textContent: verdict.grade });
          grade.setAttribute('data-ok', String(verdict.ok));
          const sample = el('span', { class: 'sample', textContent: label });
          sample.style.color = css(fg);
          sample.style.background = css(bg);
          checks.append(el('div', { class: 'check' }, [
            sample,
            el('span', { class: 'ratio', textContent: `${ratio.toFixed(1)}:1` }),
            grade,
          ]));
        }
      };

      // --------------------------------------------------------------- inspect

      const pickButton = el('button', { class: 'btn primary wide', textContent: t('pick') });
      const inspectOut = el('div', { class: 'inspect' }, [
        el('p', { class: 'hint', textContent: t('nothing') }),
      ]);
      section(t('inspect'), t('inspectHint'), el('div', {}, [pickButton, inspectOut]));

      /** One editable line for a token, wherever it is being shown. */
      const tokenRow = (token) => {
        const overridden = token.name in tokenOverrides;
        const value = tokenOverrides[token.name] ?? token.value;
        const chip = el('div', { class: 'chip small' });
        paintSwatch(chip, swatch(value));

        const row = el('div', { class: 'token' });
        row.setAttribute('data-own', String(overridden));
        row.setAttribute('data-editing', String(editing?.kind === 'token' && editing.name === token.name));

        const open = el('button', { class: 'token-open' }, [
          chip,
          el('code', { textContent: token.name }),
          el('small', { textContent: value }),
        ]);
        open.addEventListener('click', () => editToken(token));
        row.append(open);

        if (overridden) {
          const drop = el('button', { class: 'icon', title: t('drop'), textContent: '×' });
          drop.addEventListener('click', () => {
            delete tokenOverrides[token.name];
            if (editing?.kind === 'token' && editing.name === token.name) {
              editing = null;
              picker.hide();
            }
            apply();
            if (lastPicked) showElement(lastPicked);
          });
          row.append(drop);
        }
        return row;
      };

      let lastPicked = null;

      const showElement = (element) => {
        lastPicked = element;
        inspectOut.replaceChildren();

        // The chain up from the element: the colour you are looking at is
        // rarely on the node under the pointer -- Slack nests a dozen deep.
        const chain = el('div', { class: 'chain' });
        for (const node of ancestry(element)) {
          const step = el('button', { class: 'pill', textContent: describe(node) });
          step.setAttribute('data-current', String(node === element));
          step.addEventListener('click', () => showElement(node));
          chain.append(step);
        }
        inspectOut.append(chain);

        const rules = matchedRules(element, document.styleSheets);
        const resolve = (name) =>
          getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        const used = variablesIn(rules, resolve).filter((entry) => entry.value);

        inspectOut.append(el('h3', { textContent: t('paintedBy') }));
        if (!used.length) {
          inspectOut.append(el('p', { class: 'hint', textContent: t('noVars') }));
        }
        for (const entry of used.slice(0, 40)) {
          inspectOut.append(tokenRow({
            name: entry.name,
            value: entry.value,
            kind: familyOf(entry.name).key === 'legacy' || familyOf(entry.name).key === 'palette'
              ? 'triplet' : 'colour',
          }));
        }

        // What the element ended up with, whatever it came from. Useful when a
        // colour is written literally and no token is involved at all.
        const computed = getComputedStyle(element);
        const literal = el('div', { class: 'literals' });
        for (const [property, label] of [['background-color', t('background')], ['color', t('text')]]) {
          const parsed = parseColour(computed.getPropertyValue(property));
          if (!parsed) continue;
          const chip = el('div', { class: 'chip small' });
          paintSwatch(chip, formatCss(parsed));
          literal.append(el('div', { class: 'literal' }, [
            chip, el('span', { textContent: label }), el('code', { textContent: formatCss(parsed) }),
          ]));
        }
        if (literal.children.length) {
          inspectOut.append(el('h3', { textContent: t('computed') }), literal);
        }

        const ruleList = el('ul', { class: 'rules' });
        for (const rule of rules.slice(0, 40)) {
          ruleList.append(el('li', {}, [
            el('code', { textContent: `${rule.selector} { ${rule.text.slice(0, 160)} }` }),
          ]));
        }
        const ruleBlock = el('details', {}, [
          el('summary', {}, [el('span', { textContent: t('matchedRules', { count: rules.length }) })]),
          ruleList,
        ]);
        inspectOut.append(ruleBlock);
      };

      pickButton.addEventListener('click', () => {
        pickButton.textContent = t('picking');
        pickButton.disabled = true;
        // The pointer has to be over Slack, so hand it the focus.
        child.blur();
        window.focus();
        void pickElement(document, overlay()).then((element) => {
          pickButton.textContent = t('pick');
          pickButton.disabled = false;
          child.focus();
          if (element) showElement(element);
        });
      });

      // ---------------------------------------------------------------- tokens

      let tokens = [];
      const tokenSearch = el('input', { type: 'search', placeholder: t('searchTokens'), spellcheck: false });
      const familySelect = el('select');
      familySelect.append(el('option', { value: '', textContent: t('allFamilies') }));
      const tokenList = el('div', { class: 'tokens' });
      const tokenCount = el('p', { class: 'hint' });

      const paintTokens = () => {
        const query = tokenSearch.value.trim();
        const family = familySelect.value;
        let shown = search(tokens, query);
        if (family) shown = shown.filter((token) => token.family === family);
        // Anything taken over stays at the top: it is what you came back for.
        shown = [...shown].sort((a, b) =>
          Number(b.name in tokenOverrides) - Number(a.name in tokenOverrides));

        tokenList.replaceChildren();
        for (const token of shown.slice(0, TOKEN_LIMIT)) tokenList.append(tokenRow(token));
        tokenCount.textContent = t('tokenCount', {
          shown: Math.min(shown.length, TOKEN_LIMIT),
          total: shown.length,
          own: Object.keys(tokenOverrides).length,
        });
      };

      tokenSearch.addEventListener('input', paintTokens);
      familySelect.addEventListener('change', paintTokens);

      section(t('tokens'), t('tokensHint'), el('div', {}, [
        el('div', { class: 'row' }, [tokenSearch, familySelect]),
        tokenCount,
        tokenList,
      ]));

      // ------------------------------------------------------------------ css

      const cssArea = el('textarea', { spellcheck: false, placeholder: '.c-message_kit__background { … }' });
      cssArea.addEventListener('input', () => { extraCss = cssArea.value; apply(); });
      section('CSS', t('cssHint'), cssArea);

      // --------------------------------------------------------------- footer

      const suspend = el('button', { class: 'btn', textContent: t('suspend'), title: t('suspendHint') });
      suspend.addEventListener('click', () => {
        suspended = !suspended;
        suspend.textContent = suspended ? t('resume') : t('suspend');
        suspend.setAttribute('data-on', String(suspended));
        apply();
      });
      const copy = el('button', { class: 'btn', textContent: t('copy') });
      copy.addEventListener('click', () => { void api.helpers.copy(themeCss(), t('copied')); });

      doc.body.append(picker.node);
      doc.body.append(el('footer', {}, [suspend, copy, status]));

      // ----------------------------------------------------------------- boot

      tokens = collectTokens(document);
      // Only the families this client actually defines, so the filter never
      // offers something that would return nothing.
      const familyLabels = {
        chrome: t('familyChrome'), content: t('familyContent'), legacy: t('familyLegacy'),
        palette: t('familyPalette'), other: t('familyOther'),
      };
      for (const family of new Set(tokens.map((token) => token.family))) {
        const count = tokens.filter((token) => token.family === family).length;
        familySelect.append(el('option', {
          value: family,
          textContent: `${familyLabels[family] ?? family} (${count})`,
        }));
      }

      picker.hide();
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
      icon: PALETTE_ICON,
      onClick: open,
    });

    api.onDispose(() => {
      document.getElementById(OVERLAY_ID)?.remove();
      if (child && !child.closed) child.close();
    });
  },
};
