---
name: menu
group: ui
title: api.ui
signature: (anchor: HTMLElement, items: MenuItem[], options?: MenuOptions): Cleanup
preview: ui-menu
control: items | text | Rename, Duplicate, Remove
---

Slack's overflow menu, against an anchor you give it.

Borrowed rather than drawn: it wears `c-menu`, so it follows every theme,
including one being edited. One menu is open at a time, Escape and a
click outside close it, and it flips above the anchor when there is no
room below -- which is always, for a button in the control strip.

```js
api.ui.menu(anchor, [
  { label: 'Rename', onSelect: () => rename() },
  { label: 'Duplicate', onSelect: () => duplicate() },
  { label: 'Remove', danger: true, onSelect: () => remove() },
]);
```
