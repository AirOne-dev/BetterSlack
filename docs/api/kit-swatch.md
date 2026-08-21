---
name: swatch
group: kit
title: Component kit
signature: (css: string, options?: { size?: 'sm' | 'md' | 'lg' }): HTMLElement
since: 2.0.1
preview: kit-swatch
control: colour | text | rgba(97, 31, 105, 0.55)
control: size | select | lg |  | sm, md, lg
---

A colour chip. Translucent colours are drawn over the checkerboard, so a colour with alpha reads as one.

```js
kit.swatch('#611f69', { size: 'lg' });
// a translucent colour reads as translucent: the checkerboard is kit.CHECKER
kit.swatch('rgba(97, 31, 105, 0.35)');
```
