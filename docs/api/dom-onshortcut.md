---
name: onShortcut
group: dom
title: api.dom
signature: : (match: (event: KeyboardEvent) => boolean, handler: (event: KeyboardEvent) => void) => Cleanup
preview: dom-onshortcut
---

The low-level key listener. Prefer helpers.hotkey, which takes a combo string and handles the platform.

```js
api.dom.onShortcut(
  (event) => event.key === 'F1',
  () => api.app.openPanel(),
);
```
