---
name: confirm
group: kit
title: Component kit
signature: (options: ConfirmOptions): Promise<boolean>
since: 2.0.1
preview: kit-confirm
control: title | text | Delete Midnight?
control: body | text | The stylesheet goes with it. This cannot be undone.
control: action | text | Delete
control: danger | boolean | true
---

A yes/no dialog that resolves to a boolean, so the caller reads as a question rather than a callback.

```js
const sure = await kit.confirm({
  title: 'Delete Midnight?',
  body: 'The stylesheet goes with it. This cannot be undone.',
  action: 'Delete',
  cancel: 'Keep it',
  danger: true,
});
if (sure) await remove(theme.id);
```
