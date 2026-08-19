---
name: code
group: kit
title: Component kit
signature: (options?: CodeEditorOptions): CodeEditor
preview: kit-code
control: value | textarea | :root {\n  /* Slack's own tokens: change these, not its class names. */\n  --dt_color-base-pry: #0b0d12;\n  --dt_color-content-pry: #e6e9ef;\n  --dt_color-content-hgl-1: #6cb6ff;\n}\n\n.p-theme_background {\n  /* A full-viewport layer above <body>: clear it or a gradient is invisible. */\n  background: transparent !important;\n} | starting CSS
control: rows | number | 12 | rows
---

A CSS editor that colours what you type: a highlighted `<pre>` under a transparent `<textarea>`. Both have to agree on every metric or the caret drifts from the text, which is why their stylesheet lives beside the tokeniser rather than in each caller.

```js
const editor = kit.code({
  value: theme.css,
  rows: 18,
  onChange: (css) => api.css(css),
});
panel.append(editor.node);
editor.set(':root { --dt_color-base-pry: #0b0d12; }');
```
