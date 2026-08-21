---
name: list
group: assets
title: api.assets
signature: (): string[]
since: 2.0.1
preview: assets-list
---

Every readable file in the mod's own folder, folder-relative and forward-slashed — the same strings you would import.

```js
api.assets.list();   // ['index.js', 'panel.css', 'views/start.js']
```
