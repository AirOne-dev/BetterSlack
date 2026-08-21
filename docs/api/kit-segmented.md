---
name: segmented
group: kit
title: Component kit
signature: (options: Option[], config?: SegmentedOptions): Segmented
since: 2.0.1
preview: kit-segmented
control: labels | text | Colours, CSS, Inspect
control: count | number | 12 | badge on the first
---

A row of mutually exclusive tabs, each able to carry a count. Returns a handle so the selection can be moved from code as well as by a click.

```js
const tabs = kit.segmented(
  [{ value: 'colours', label: 'Colours', count: 12 }, { value: 'css', label: 'CSS' }],
  { value: 'colours', onChange: (tab) => show(tab) },
);
panel.append(tabs.node);
tabs.set('css');   // move it from code
```
