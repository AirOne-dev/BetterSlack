---
name: select
group: kit
title: Component kit
signature: (options: Option[], config?: SelectOptions): HTMLSelectElement
since: 2.0.1
preview: kit-select
control: options | text | dark, light, follow the system
control: value | text | dark
---

A dropdown built from a list of options, with the current value and a change handler.

```js
kit.select(
  [{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }],
  { value: 'dark', onChange: (mode) => setMode(mode) },
);
```
