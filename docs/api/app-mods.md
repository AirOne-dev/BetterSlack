---
name: mods
group: app
title: api.app
signature: (): Array<{
preview: app-mods
---

The catalogue as the panel sees it: what is installed, what is enabled, and how many settings each one declares.

```js
const mods = api.app.mods();
const off = mods.filter((mod) => mod.installed && !mod.enabled);
```
