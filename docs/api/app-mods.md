---
name: mods
group: app
title: api.app
signature: (): Array<{
---

Every mod in the catalogue, with what the user has done about it.

```js
const mods = api.app.mods();
const off = mods.filter((mod) => mod.installed && !mod.enabled);
```
