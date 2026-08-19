---
name: iconButton
group: kit
title: Component kit
signature: (glyph: string, options?: IconButtonOptions): HTMLButtonElement
preview: kit-iconbutton
control: glyph | text | ✎
control: title | text | Rename
control: danger | boolean | false
---

A square button carrying a glyph rather than a word, for the places a label would not fit.

```js
kit.iconButton('✎', { title: 'Rename', onClick: () => rename() });
kit.iconButton('🗑', { title: 'Delete', danger: true, onClick: () => remove() });
```
