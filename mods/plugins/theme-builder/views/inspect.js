// Inspect: point at something in Slack, find out what paints it, change it.
//
// Slack's stylesheet is tens of thousands of rules of hashed class names.
// Nobody knows that a channel row's hover state comes from
// --dt_color-base-pry-hover, and it is written down nowhere -- so it is read out
// of the running page and handed over editable.
//
// The view answers three questions, in the order they get asked, and says so in
// its own headings rather than making anyone infer them: what did I pick, what
// paints it, and what did it end up as. The selector and every class are
// copyable, because the next thing anyone does with a class they just found is
// paste it into a CSS rule.
//
// The breadcrumb matters as much as the list: Slack nests a dozen levels deep
// and the background you are looking at is almost never on the node under the
// pointer, so the chain upwards is offered one click each rather than making
// anyone aim better.

import { formatCss, parseColour } from '../colour.js';
import { ancestry, describe, matchedRules, pickElement, variablesIn } from '../inspect.js';
import { familyOf } from '../tokens.js';

const COPY_ICON =
  '<svg viewBox="0 0 20 20" width="14" height="14"><path fill="currentColor" d="M7 2.75A1.75 1.75 0 0 1 8.75 1h6.5C16.216 1 17 1.784 17 2.75v6.5A1.75 1.75 0 0 1 15.25 11h-1.5v1.25A1.75 1.75 0 0 1 12 14H5.5a1.75 1.75 0 0 1-1.75-1.75v-6.5C3.75 4.784 4.534 4 5.5 4H7zM8.5 4h3.5c.966 0 1.75.784 1.75 1.75V9.5h1.25a.25.25 0 0 0 .25-.25v-6.5a.25.25 0 0 0-.25-.25h-6.5a.25.25 0 0 0-.25.25zm-3 1.5a.25.25 0 0 0-.25.25v6.5c0 .138.112.25.25.25H12a.25.25 0 0 0 .25-.25v-6.5a.25.25 0 0 0-.25-.25z"/></svg>';

export function createInspectView(ctx) {
  const { ui, t } = ctx;
  const { el } = ui;

  const body = el('div', {});
  let picked = null;

  const pickButton = ui.button(t('pick'), { variant: 'primary', onClick: () => startPicking() });
  const label = () => pickButton.querySelector('span:last-child');

  const node = el('div', { class: 'view' }, [
    ui.card(t('inspect'), [body], { subtitle: t('inspectHint'), actions: [pickButton] }),
  ]);

  const startPicking = () => {
    pickButton.disabled = true;
    label().textContent = t('picking');
    ctx.focusSlack();
    void pickElement(document, ctx.overlay()).then((element) => {
      pickButton.disabled = false;
      label().textContent = t('pick');
      ctx.focusBuilder();
      if (element) {
        picked = element;
        refresh();
      }
    });
  };

  /** Something you can click to put on the clipboard, and that says it did. */
  const copyable = (text, { code = true, title } = {}) => {
    const node = el('button', { class: `copyable${code ? ' copyable--code' : ''}`, type: 'button', title }, [
      code ? el('code', { textContent: text }) : el('span', { textContent: text }),
      el('span', { class: 'copyable__icon', html: COPY_ICON }),
    ]);
    node.addEventListener('click', () => ctx.copy(text, node));
    return node;
  };

  /** One token, as a row you can open, with its swatch and current value. */
  const tokenRow = (token) => {
    const own = token.name in ctx.state.tokenOverrides;
    const value = ctx.state.tokenOverrides[token.name] ?? token.value;
    const row = el('div', { class: 'token' });
    row.setAttribute('data-own', String(own));

    const open = el('button', { class: 'token__open', type: 'button', title: t('editToken') }, [
      ui.swatch(ctx.swatchOf(value), { size: 'sm' }),
      el('code', { textContent: token.name }),
      el('span', { class: 'token__value', textContent: value }),
    ]);
    open.addEventListener('click', () => ctx.editToken(token, open, refresh));
    ui.hoverable(open, {
      enter: () => ctx.highlightToken(token.name),
      leave: () => ctx.unhighlight(),
    });
    row.append(open);
    row.append(own
      ? ui.iconButton('&times;', {
        title: t('drop'),
        danger: true,
        onClick: () => { delete ctx.state.tokenOverrides[token.name]; ctx.apply(); refresh(); },
      })
      : el('span', { class: 'token__family', textContent: ctx.familyLabel(token.family) }));
    return row;
  };

  const refresh = () => {
    body.replaceChildren();

    if (!picked || !picked.isConnected) {
      body.append(ui.emptyState(t('nothingTitle'), t('nothing')));
      return;
    }

    // 1. What did I pick?
    body.append(el('h3', { class: 'section-title', textContent: t('picked') }));

    const selector = describe(picked);
    const selectorChip = copyable(selector, { title: t('copySelector') });
    ui.hoverable(selectorChip, {
      enter: () => ctx.highlightElement(picked),
      leave: () => ctx.unhighlight(),
    });
    const identity = el('div', { class: 'identity' }, [selectorChip]);
    const qa = picked.getAttribute('data-qa');
    if (qa) {
      identity.append(el('span', { class: 'identity__note', textContent: t('qaStable') }));
    }
    body.append(identity);

    const classes = [...picked.classList];
    if (classes.length) {
      const chips = el('div', { class: 'chips' });
      for (const name of classes) {
        // Hashed CSS-module output changes with every Slack build; the BEM-ish
        // ones do not. Worth saying, since one of them is safe to write a rule
        // against and the other is a rule that breaks next release.
        const hashed = /__[A-Za-z0-9]{5}$/.test(name);
        const chip = copyable(`.${name}`, { title: hashed ? t('classVolatile') : t('classStable') });
        chip.setAttribute('data-volatile', String(hashed));
        // Hovering a class shows how much of the app carries it, which is the
        // difference between "this row" and "every row in the sidebar".
        ui.hoverable(chip, {
          enter: () => ctx.highlightSelector(`.${CSS.escape(name)}`),
          leave: () => ctx.unhighlight(),
        });
        chips.append(chip);
      }
      body.append(el('h3', { class: 'section-title', textContent: t('classes') }), chips);
    }

    body.append(el('h3', { class: 'section-title', textContent: t('around') }));
    const chain = el('nav', { class: 'chain' });
    for (const step of ancestry(picked).reverse()) {
      const item = el('button', { class: 'chain__step', type: 'button', textContent: describe(step) });
      item.setAttribute('data-current', String(step === picked));
      item.addEventListener('click', () => { picked = step; refresh(); });
      ui.hoverable(item, {
        enter: () => ctx.highlightElement(step),
        leave: () => ctx.unhighlight(),
      });
      chain.append(item);
    }
    body.append(chain);

    // 2. What paints it?
    const rules = matchedRules(picked, document.styleSheets);
    const resolve = (name) =>
      getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const used = variablesIn(rules, resolve).filter((entry) => entry.value);

    body.append(el('h3', { class: 'section-title', textContent: t('paintedBy') }));
    body.append(el('p', { class: 'muted', textContent: used.length ? t('paintedByHint') : t('noVars') }));
    const list = el('div', { class: 'token-list' });
    for (const entry of used.slice(0, 40)) {
      list.append(tokenRow({
        name: entry.name,
        value: entry.value,
        family: familyOf(entry.name).key,
        kind: ctx.kindOfToken(entry.name, entry.value),
      }));
    }
    body.append(list);

    // 3. What did it end up as? The answer when a colour is written literally
    // and no token is involved at all.
    const computed = getComputedStyle(picked);
    const literals = el('div', { class: 'literals' });
    for (const [property, name] of [['background-color', t('background')], ['color', t('text')]]) {
      const parsed = parseColour(computed.getPropertyValue(property));
      if (!parsed || parsed.a === 0) continue;
      literals.append(el('div', { class: 'literal' }, [
        ui.swatch(formatCss(parsed), { size: 'sm' }),
        el('span', { textContent: name }),
        copyable(formatCss(parsed), { title: t('copyValue') }),
      ]));
    }
    if (literals.children.length) {
      body.append(el('h3', { class: 'section-title', textContent: t('computed') }), literals);
    }

    const ruleList = el('ul', { class: 'rules' });
    for (const rule of rules.slice(0, 40)) {
      ruleList.append(el('li', {}, [
        el('code', { textContent: `${rule.selector} { ${rule.text.slice(0, 200)} }` }),
      ]));
    }
    body.append(el('details', { class: 'raw' }, [
      el('summary', { textContent: t('matchedRules', { count: rules.length }) }),
      ruleList,
    ]));
  };

  return { node, refresh };
}
