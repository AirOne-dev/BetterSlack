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

  const editor = el('textarea', {
    class: 'code-editor',
    spellcheck: false,
    placeholder: '.c-message_kit__background {\n  border-left: 3px solid var(--dt_color-accent);\n}',
  });
  editor.value = ctx.state.extraCss;
  editor.addEventListener('input', () => {
    ctx.state.extraCss = editor.value;
    ctx.apply();
  });

  const output = el('pre', { class: 'code-output' });
  const stats = el('p', { class: 'muted count' });

  const copy = ui.button(t('copy'), { variant: 'ghost', onClick: () => ctx.copyCss() });

  const node = el('div', { class: 'view' }, [
    ui.card(t('yourRules'), [editor], { subtitle: t('cssHint') }),
    ui.card(t('output'), [stats, output], { subtitle: t('outputHint'), actions: [copy] }),
  ]);

  const refresh = () => {
    // Only while the view is on screen: the stylesheet is regenerated on every
    // drag frame, and formatting it into a <pre> nobody is looking at is work
    // done for nothing.
    if (!node.isConnected) return;
    const css = ctx.themeCss();
    output.textContent = css;
    stats.textContent = t('outputStats', {
      lines: css.split('\n').length,
      tokens: Object.keys(ctx.state.tokenOverrides).length,
    });
    if (editor.value !== ctx.state.extraCss) editor.value = ctx.state.extraCss;
  };

  return { node, refresh };
}
