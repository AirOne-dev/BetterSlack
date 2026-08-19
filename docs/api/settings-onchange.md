---
name: onChange
group: settings
title: api.settings
signature: (handler: (values: Record<string, unknown>) => void): Cleanup
---

Called when the panel changes one of the declared settings.

A plugin that does nothing here is still correct: the runtime reloads it
after a change, so `start` simply runs again with the new values. This is
for the ones where reloading would be visible -- a list that would flicker,
a window that would close.

```js
api.settings.onChange((values) => {
  redraw(values.memberLimit);
});
```
