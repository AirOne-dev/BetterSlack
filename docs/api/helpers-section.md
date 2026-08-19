---
name: section
group: helpers
title: api.helpers
signature: (title: string, children: (Node | string)[]): HTMLElement
preview: helpers-section
control: title | text | More details
control: rows | text | User ID: U04KY0Z61, Time zone: Europe/Paris
---

A section with Slack's own header styling, for panes.

```js
pane.append(api.helpers.section('More details', [
  api.helpers.field('User ID', user.id),
  api.helpers.field('Time zone', user.tz_label),
]));
```
