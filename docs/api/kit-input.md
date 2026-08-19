---
name: input
group: kit
title: Component kit
signature: (props?: Record<string, unknown>): HTMLInputElement
preview: kit-input
control: value | text | Midnight
control: placeholder | text | Theme name
---

A single-line text box wearing the kit's own focus ring. Any attribute you pass goes through to the element, so `type`, `placeholder` and `maxlength` all work.

```js
const name = kit.input({ value: theme.name, placeholder: 'Theme name' });
name.addEventListener('input', () => draft.rename(name.value));
```
