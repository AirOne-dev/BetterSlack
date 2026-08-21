---
name: toast
group: ui
title: api.ui
signature: (message: string, options?: ToastOptions): ToastHandle
since: 2.0.1
preview: ui-toast
control: message | text | Theme saved
control: variant | select | success |  | info, success, warning, error
control: action | text | Undo | action label
---

A short confirmation in the corner, with an optional action. Toasts live in a shadow root rather than the light DOM: Slack has no toast to borrow from, and an unreadable error message is worse than an off-brand one.

```js
api.ui.toast('Theme saved', {
  variant: 'success',
  action: { label: 'Undo', onClick: () => undo() },
});
```
