---
name: iconButton
group: kit
title: Component kit
signature: (glyph: string, options?: IconButtonOptions): HTMLButtonElement
since: 2.0.1
preview: kit-iconbutton
control: glyph | select | ✎ | glyph | ✎, 🗑, ⋯, ⚙, ✓, ✕, ＋, ↻, ★, ⤓, ⇧, ⧉, svg
control: title | text | Rename
control: danger | boolean | false
---

A square button carrying a glyph rather than a word, for the places a label would not fit.

The glyph is set as the button's HTML, so it is not limited to a character: an inline `<svg>` works, which is what the `svg` entry in the picker above shows. There is no list of Slack's own icons to choose from, and that is not an omission — Slack's icons are classes in Slack's stylesheet, and the kit is for a window a mod opens, where none of that stylesheet reaches. Pick a Unicode symbol, which needs no font beyond the system's, or bring your own drawing.

```js
kit.iconButton('✎', { title: 'Rename', onClick: () => rename() });
kit.iconButton('🗑', { title: 'Delete', danger: true, onClick: () => remove() });

// The glyph is markup, so this works too.
kit.iconButton('<svg viewBox="0 0 20 20"><path d="…" fill="currentColor"/></svg>',
  { title: 'Rename', onClick: () => rename() });
```
