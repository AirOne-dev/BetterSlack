---
name: modal
group: ui
title: api.ui
signature: (options: ModalOptions): ModalHandle
since: 2.0.1
preview: ui-modal
control: title | text | Channel notes
control: body | text | Kept on this machine only. Nothing is sent anywhere.
control: action | text | Save
control: width | number | 460
---

A dialog wearing Slack's own `c-dialog` classes, so it follows every theme without BetterSlack owning a second design system. Returns a handle, so it can be updated or closed from outside the callback that opened it.

```js
const dialog = api.ui.modal({
  title: 'Channel notes',
  subtitle: 'Stored on this machine only.',
  content: textarea,
  width: 560,
  actions: [
    { label: 'Clear', onClick: () => clear() },
    { label: 'Save', variant: 'primary', onClick: () => save() },
  ],
});
dialog.close();
```
