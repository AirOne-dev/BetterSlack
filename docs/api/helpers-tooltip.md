---
name: tooltip
group: helpers
title: api.helpers
signature: (element: HTMLElement, title: string, subtitle?: string): Cleanup
since: 2.0.1
preview: helpers-tooltip
control: title | text | Channel notes
control: subtitle | text | ⌘⇧N
---

Slack's tooltip on any element. Slack's own are React portals a mod cannot register with, so this rebuilds one from Slack's classes — including the ~150ms delay, measured with a real pointer.

```js
api.helpers.tooltip(button, 'Channel notes', '⌘⇧N');
```
