---
name: CHECKER
group: kit
title: Component kit
signature: : string
since: 2.0.1
preview: kit-checker
---

The checkerboard, as a CSS value. Put it behind a colour and a colour with alpha reads as translucent rather than as a slightly different flat colour.

```js
// The checkerboard, so a translucent colour reads as translucent.
swatch.style.background = `${colour}, ${kit.CHECKER}`;
```
