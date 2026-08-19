---
name: field
group: kit
title: Component kit
signature: (label: string, control: HTMLElement, hint?: string): HTMLElement
preview: kit-field
control: label | text | Theme name
control: hint | text | Shown in the panel and in the palette.
---

A labelled control with an optional hint underneath, which is the shape almost every setting takes.

```js
kit.field('Theme name', kit.input({ value: theme.name }),
  'Shown in the panel and in the palette.');
```
