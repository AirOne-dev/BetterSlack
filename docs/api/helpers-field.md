---
name: field
group: helpers
title: api.helpers
signature: (label: string, value: string | Node): HTMLElement
preview: helpers-field
control: label | text | Time zone
control: value | text | Europe/Paris
---

A labelled row in Slack's profile/field style.

```js
pane.append(api.helpers.field('Time zone', user.tz_label));
```
