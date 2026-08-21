---
name: el
group: kit
title: Component kit
signature: (tag: string, props?: Record<string, unknown>, children?: Child[]): HTMLElement
since: 2.0.1
preview: kit-el
control: tag | select | p |  | div, p, strong, span
control: text | text | Built with the same maker as everything below.
control: className | text | sm-hint | class
---

The maker every other primitive is built from: a tag, its attributes, and its children.

```js
const kit = api.ui.kit(doc);
const row = kit.el('div', { class: 'sm-row' }, [
  kit.el('strong', {}, ['Midnight']),
  kit.el('span', { class: 'sm-hint' }, ['a deeper, cooler dark']),
]);
```
