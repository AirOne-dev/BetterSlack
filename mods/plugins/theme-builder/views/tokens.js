// Tokens: every colour the running client defines, in one searchable table.
//
// Around 525 of them in Slack 4.51, read out of the page rather than shipped as
// a list -- they change between releases, and the page is the only honest
// source. Which means this view is a search problem, not a list problem: a
// toolbar with a filter that says how many of each family there are, a count
// that never lies about what is being shown, and the ones you have taken over
// pulled to the top, because they are what you came back for.

import { FAMILIES, search } from '../tokens.js';
import { createTokenRow } from './token-row.js';

/** Rendered at once. Enough to scroll through, few enough to stay instant. */
const PAGE = 80;

export function createTokensView(ctx) {
  const { ui, t } = ctx;
  const { el } = ui;

  const list = el('div', { class: 'token-list token-list--tall' });
  const count = el('p', { class: 'sm-muted sm-count' });
  const more = ui.button(t('showMore'), { variant: 'ghost', onClick: () => { limit += PAGE; refresh(); } });

  const query = ui.input({ type: 'search', placeholder: t('searchTokens'), class: 'search' });
  query.addEventListener('input', () => { limit = PAGE; refresh(); });

  let limit = PAGE;
  let family = '';
  let ownOnly = false;

  const families = ui.segmented(
    [
      { value: '', label: t('allFamilies') },
      // In the order the families are declared -- content first, because that
      // is where anyone looking for a colour starts. First-seen order put
      // "Other" at the front, which is the least useful thing to offer.
      ...FAMILIES
        .map((family) => ({
          value: family.key,
          label: ctx.familyLabel(family.key),
          count: ctx.tokens.filter((token) => token.family === family.key).length,
          title: t(`family_${family.key}_hint`),
        }))
        .filter((option) => option.count > 0),
    ],
    { onChange: (value) => { family = value; limit = PAGE; refresh(); } },
  );

  const ownToggle = ui.button(t('ownOnly'), {
    variant: 'ghost',
    onClick: () => {
      ownOnly = !ownOnly;
      ownToggle.setAttribute('data-on', String(ownOnly));
      limit = PAGE;
      refresh();
    },
  });

  const node = el('div', { class: 'view' }, [
    ui.card(t('tokens'), [
      el('div', { class: 'toolbar' }, [query, ownToggle]),
      families.node,
      count,
      list,
      el('div', { class: 'more' }, [more]),
    ], { subtitle: t('tokensHint') }),
  ]);

  const row = createTokenRow(ctx);

  const refresh = () => {
    let shown = search(ctx.tokens, query.value.trim());
    if (family) shown = shown.filter((token) => token.family === family);
    if (ownOnly) shown = shown.filter((token) => token.name in ctx.state.tokenOverrides);
    // Taken-over first: they are the ones being worked on.
    shown = [...shown].sort((a, b) =>
      Number(b.name in ctx.state.tokenOverrides) - Number(a.name in ctx.state.tokenOverrides));

    list.replaceChildren();
    for (const token of shown.slice(0, limit)) list.append(row(token, refresh));
    if (!shown.length) list.append(ui.emptyState(t('noMatchTitle'), t('noMatch')));

    count.textContent = t('tokenCount', {
      shown: Math.min(shown.length, limit),
      total: shown.length,
      own: Object.keys(ctx.state.tokenOverrides).length,
    });
    more.style.display = shown.length > limit ? '' : 'none';
  };

  return { node, refresh };
}
