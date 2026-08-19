---
name: code
group: kit
title: Component kit
signature: (options?: CodeEditorOptions): CodeEditor
preview: kit-code
---

A CSS editor that colours what you type.

```js
const editor = kit.code({
  value: theme.css,
  rows: 18,
  onChange: (css) => api.css(css),
});
panel.append(editor.node);
editor.set(':root { --dt_color-base-pry: #0b0d12; }');
```
