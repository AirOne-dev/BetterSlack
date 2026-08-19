---
name: iconButton
group: helpers
title: api.helpers
signature: (options: {
preview: helpers-iconbutton
control: label | text | Notes
control: surface | select | header |  | strip, header, composer
---

Build an icon button wearing Slack's classes for a given surface.

```js
const button = api.helpers.iconButton({
  icon: '<svg viewBox="0 0 20 20">…</svg>',
  label: 'Notes',
  surface: 'header',
  onClick: () => open(),
});
```
