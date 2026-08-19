---
name: confirm
group: ui
title: api.ui
signature: (options: ConfirmOptions): Promise<boolean>
preview: ui-confirm
control: title | text | Remove Midnight?
control: body | text | Its files go with it.
control: danger | boolean | true
---

A yes/no dialog that resolves to a boolean, so a destructive action reads as a question in the code rather than as a pair of callbacks.

```js
const sure = await api.ui.confirm({
  title: 'Clear these notes?',
  body: 'They are not kept anywhere else.',
  danger: true,
});
```
