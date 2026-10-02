---
name: onChange
group: settings
title: api.settings
signature: (handler: (values: Record<string, unknown>) => void): Cleanup
since: 2.0.1
preview: settings-onchange
---

Called when the panel changes one of this mod's settings.

A plugin that registers this is told and keeps running, for the cases where a restart would be visible — a list that would flicker, a window that would close. A plugin that does not is restarted with the new values, so `start` simply runs again.

```js
api.settings.onChange((values) => {
  redraw(values.memberLimit);
});
```
