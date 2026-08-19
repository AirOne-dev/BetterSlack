---
name: hotkey
group: helpers
title: api.helpers
signature: (combo: string, handler: () => void, options?: { when?: () => boolean }): Cleanup
preview: helpers-hotkey
control: combo | text | mod+shift+y
---

Bind a keyboard shortcut in the platform's idiom: `mod+shift+f`.

`when` gates the *match*, not the handler: a shortcut that does not apply
must not swallow the key, or a mod binding Escape would break Slack's own
dialogs.

```js
api.helpers.hotkey('mod+shift+f', () => zen.toggle());

// The when guard gates the match, so a shortcut that does not apply is not swallowed
api.helpers.hotkey('escape', () => zen.set(false), {
  when: () => zen.on && !document.querySelector('.ReactModal__Content'),
});
```
