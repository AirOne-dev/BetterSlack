---
name: all
group: settings
title: api.settings
signature: (): Record<string, unknown>
since: 2.0.1
preview: settings-all
---

Everything this mod has stored, as one object — for a settings screen that draws them all rather than asking for each.

```js
const values = api.settings.all();   // everything this mod has stored
```
