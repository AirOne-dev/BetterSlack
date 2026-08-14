// Inspect: point at something in Slack and edit what paints it.
//
// This is the view that makes the tool more than a palette. Slack's stylesheet
// is tens of thousands of rules of hashed class names; nobody knows that a
// channel row's hover state comes from --dt_color-base-pry-hover, and it is
// written down nowhere. So it is read out of the running page and handed over
// editable.
//
// The breadcrumb matters as much as the list. Slack nests a dozen levels deep
// and the background you are looking at is almost never on the node under the
// pointer -- so the chain from the picked element upwards is offered, one click
// each, rather than making anyone aim better.

import { formatCss, parseColour } from '../colour.js';
import { ancestry, describe, matchedRules, pickElement, variablesIn } from '../inspect.js';
import { familyOf } from '../tokens.js';

export function createInspectView(ctx) {
  const { ui, t } = ctx;
  const { el } = ui;

  const body = el('div', {});
  let picked = null;

  const pickButton = ui.button(t('pick'), {
    variant: 'primary',
    onClick: () => startPicking(),
  });

  const node = el('div', { class: 'view' }, [
    ui.card(t('inspect'), [body], { subtitle: t('inspectHint'), actions: [pickButton] }),
  ]);

  const startPicking = () => {
    pickButton.disabled = true;
    pickButton.querySelector('span:last-child').textContent = t('picking');
    ctx.focusSlack();
    void pickElement(document, ctx.overlay()).then((element) => {
      pickButton.disabled = false;
      pickButton.querySelector('span:last-child').textContent = t('pick');
      ctx.focusBuilder();
      if (element) {
        picked = element;
        refresh();
      }
    });
  };

  /** One token, as a row you can open, with its swatch and current value. */
  const tokenRow = (token) => {
    const own = token.name in ctx.state.tokenOverrides;
    const value = ctx.state.tokenOverrides[token.name] ?? token.value;
    const row = el('div', { class: 'token' });
    row.setAttribute('data-own', String(own));

    const open = el('button', { class: 'token__open', type: 'button' }, [
      ui.swatch(ctx.swatchOf(value), { size: 'sm' }),
      el('code', { textContent: token.name }),
      el('span', { class: 'token__value', textContent: value }),
    ]);
    open.addEventListener('click', () => ctx.editToken(token, open, refresh));
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

    const chain = el('nav', { class: 'chain' });
    for (const step of ancestry(picked).reverse()) {
      const item = el('button', { class: 'chain__step', type: 'button', textContent: describe(step) });
      item.setAttribute('data-current', String(step === picked));
      item.addEventListener('click', () => { picked = step; refresh(); });
      chain.append(item);
    }
    body.append(chain);

    const rules = matchedRules(picked, document.styleSheets);
    const resolve = (name) =>
      getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const used = variablesIn(rules, resolve).filter((entry) => entry.value);

    // What it ends up as, whatever it came from -- the answer when a colour is
    // written literally and no token is involved at all.
    const computed = getComputedStyle(picked);
    const literals = el('div', { class: 'literals' });
    for (const [property, label] of [['background-color', t('background')], ['color', t('text')]]) {
      const parsed = parseColour(computed.getPropertyValue(property));
      if (!parsed || parsed.a === 0) continue;
      literals.append(el('div', { class: 'literal' }, [
        ui.swatch(formatCss(parsed), { size: 'sm' }),
        el('span', { textContent: label }),
        el('code', { textContent: formatCss(parsed) }),
      ]));
    }
    if (literals.children.length) {
      body.append(el('h3', { class: 'section-title', textContent: t('computed') }), literals);
    }

    body.append(el('h3', { class: 'section-title', textContent: t('paintedBy') }));
    if (!used.length) {
      body.append(el('p', { class: 'muted', textContent: t('noVars') }));
    }
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

    const ruleList = el('ul', { class: 'rules' });
    for (const rule of rules.slice(0, 40)) {
      ruleList.append(el('li', {}, [
        el('code', { textContent: `${rule.selector} { ${rule.text.slice(0, 200)} }` }),
      ]));
    }
    const details = el('details', { class: 'raw' }, [
      el('summary', { textContent: t('matchedRules', { count: rules.length }) }),
      ruleList,
    ]);
    body.append(details);
  };

  return { node, refresh };
}
