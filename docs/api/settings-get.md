---
name: get
group: settings
title: api.settings
signature: <T = unknown>(key: string, fallback?: T): T | undefined
since: 2.0.1
preview: settings-get
control: key | text | memberLimit
control: fallback | number | 200
---

Read one of this mod's settings, with a fallback for the first run. Synchronous: the values arrive with the plugin.

```js
const limit = api.settings.get('memberLimit', 200);
```
