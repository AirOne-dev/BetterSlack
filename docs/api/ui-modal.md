---
name: modal
group: ui
title: api.ui
signature: (options: ModalOptions): ModalHandle
preview: ui-modal
control: title | text | Channel notes
control: body | text | Kept on this machine only. Nothing is sent anywhere.
control: action | text | Save
control: width | number | 460
---

A dialog. Returns a handle so you can update or close it later.

```js
const dialog = api.ui.modal({
  title: 'Channel notes',
  subtitle: 'Stored on this machine only.',
  content: textarea,
  width: 560,
  actions: [
    { label: 'Clear', onClick: () => clear() },
    { label: 'Save', primary: true, onClick: () => save() },
  ],
});
dialog.close();
```
