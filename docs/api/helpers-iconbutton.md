---
name: iconButton
group: helpers
title: api.helpers
signature: (options: { icon, label, description?, surface?, onClick }): HTMLElement
since: 2.0.1
preview: helpers-iconbutton
control: label | text | Notes
control: surface | select | header |  | strip, header, composer
---

An icon button wearing Slack's classes for the surface you name — the control strip, a header, the composer. Getting the classes right is what keeps it 28px instead of 36px.

```js
const button = api.helpers.iconButton({
  icon: '<svg viewBox="0 0 20 20">…</svg>',
  label: 'Notes',
  surface: 'header',
  onClick: () => open(),
});
```
