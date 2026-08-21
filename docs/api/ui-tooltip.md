---
name: tooltip
group: ui
title: api.ui
signature: (element: HTMLElement, options: TooltipOptions): Cleanup
since: 2.0.1
preview: ui-tooltip
control: title | text | Channel notes
control: subtitle | text | ⌘⇧N
control: placement | select | right |  | right, left, top, bottom
---

The lower-level tooltip, when you need to say where it goes. `helpers.tooltip` is the two-argument form for the common case.

```js
api.ui.tooltip(button, {
  title: 'BetterSlack',
  subtitle: '⌘⇧M',
  placement: 'right',
});
```
