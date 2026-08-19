---
name: code
group: kit
title: Component kit
signature: (options?: CodeEditorOptions): CodeEditor
preview: kit-code
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
