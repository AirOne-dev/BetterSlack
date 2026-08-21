---
name: set
group: settings
title: api.settings
signature: (key: string, value: unknown): Promise<void>
since: 2.0.1
preview: settings-set
control: key | text | memberLimit
control: value | number | 200
---

Write one of this mod's settings. The loader owns the file, so it survives a restart and an update.

```js
await api.settings.set('memberLimit', 500);
```
