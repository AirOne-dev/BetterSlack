---
name: section
group: helpers
title: api.helpers
signature: (title: string, children: (Node | string)[]): HTMLElement
preview: helpers-section
control: title | text | More details
control: rows | text | User ID: U04KY0Z61, Time zone: Europe/Paris
---

A titled group of rows in Slack's profile style, for adding a block of detail to a pane Slack drew.

```js
pane.append(api.helpers.section('More details', [
  api.helpers.field('User ID', user.id),
  api.helpers.field('Time zone', user.tz_label),
]));
```
