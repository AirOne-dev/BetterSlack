---
name: card
group: kit
title: Component kit
signature: (title: string | null, children: Child[], options?: CardOptions): HTMLElement
since: 2.0.1
preview: kit-card
control: title | text | Palette
control: subtitle | text | Two colours, ten derived
control: action | text | Reset | action button
---

A titled box with an optional subtitle and a row of actions, for grouping controls that belong together.

```js
kit.card('Palette', [rolesGrid], {
  subtitle: 'Two colours, ten derived',
  actions: [kit.button('Reset', { variant: 'ghost', onClick: () => reset() })],
});
```
