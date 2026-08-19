---
name: toast
group: ui
title: api.ui
signature: (message: string, options?: ToastOptions): ToastHandle
preview: ui-toast
control: message | text | Theme saved
control: variant | select | success |  | info, success, warning, error
control: action | text | Undo | action label
---

Transient message at the bottom of the window.

```js
api.ui.toast('Theme saved', {
  variant: 'success',
  action: { label: 'Undo', onClick: () => undo() },
});
```
