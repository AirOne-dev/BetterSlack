// Code: what the theme will be, and the rules you add to it yourself.
//
// Two halves of the same question. The editor is for the things no palette can
// express -- a gradient, a blur, a rule that hides something -- and lands after
// everything the other views generate, so it wins. The read-only output beside
// it is the whole stylesheet as it stands: this is a tool that writes a file,
// and hiding the file until the moment you save it is how people end up not
// trusting it.

export function createCodeView(ctx) {
  const { ui, t } = ctx;
  const { el } = ui;

  // The editor, its highlighting and its Tab handling come from the API: the
  // Mods panel's own CSS box is the same component.
  const editor = ui.code({
    value: ctx.state.extraCss,
    rows: 12,
    placeholder: '.c-message_kit__background {\n  border-left: 3px solid var(--dt_color-accent);\n}',
    onChange: (value) => {
      ctx.state.extraCss = value;
      ctx.apply();
    },
  });

  // Read-only, and highlighted for the same reason: this is the file, and a
  // file you cannot read is a file you do not trust.
  const output = ui.code({ readOnly: true, rows: 14 });
  const stats = el('p', { class: 'sm-muted sm-count' });

  const copy = ui.button(t('copy'), { variant: 'ghost', onClick: () => ctx.copyCss() });

  const node = el('div', { class: 'view' }, [
    ui.card(t('yourRules'), [editor.node], { subtitle: t('cssHint') }),
    ui.card(t('output'), [stats, output.node], { subtitle: t('outputHint'), actions: [copy] }),
  ]);

  const refresh = () => {
    // Only while the view is on screen: the stylesheet is regenerated on every
    // drag frame, and formatting it into a <pre> nobody is looking at is work
    // done for nothing.
    if (!node.isConnected) return;
    const css = ctx.themeCss();
    output.set(css);
    stats.textContent = t('outputStats', {
      lines: css.split('\n').length,
      tokens: Object.keys(ctx.state.tokenOverrides).length,
    });
    if (editor.value() !== ctx.state.extraCss) editor.set(ctx.state.extraCss);
  };

  return { node, refresh };
}
