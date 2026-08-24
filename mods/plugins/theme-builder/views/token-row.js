// One of Slack's own tokens, as a row you can open.
//
// Two views draw it -- Tokens searches the whole set, Inspect shows the ones
// painting whatever was pointed at -- and a row is the same object in both: the
// swatch, the name, the value it currently has, and the way in to the picker.
// Written twice they drift, and the one that stops matching is whichever view
// nobody had open while the other was being edited.
//
// `refresh` is the view's own: dropping an override has to redraw the list it
// was in, and only the caller knows what that is.

export function createTokenRow(ctx, { title } = {}) {
  const { ui, t } = ctx;
  const { el } = ui;

  return (token, refresh) => {
    const own = token.name in ctx.state.tokenOverrides;
    const value = ctx.state.tokenOverrides[token.name] ?? token.value;
    const row = el('div', { class: 'token' });
    row.setAttribute('data-own', String(own));

    const open = el('button', { class: 'token__open', type: 'button', title }, [
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
    // Taken over: offer to give it back. Left alone: say which family it is in.
    row.append(own
      ? ui.iconButton('&times;', {
        title: t('drop'),
        danger: true,
        onClick: () => { delete ctx.state.tokenOverrides[token.name]; ctx.apply(); refresh(); },
      })
      : el('span', { class: 'token__family', textContent: ctx.familyLabel(token.family) }));
    return row;
  };
}
