---
name: tooltip
group: ui
title: api.ui
signature: (element: HTMLElement, options: TooltipOptions): Cleanup
---

Slack-style tooltip on any element you built yourself.

```js
api.ui.tooltip(button, {
  title: 'BetterSlack',
  subtitle: '⌘⇧M',
  placement: 'right',
});
```
