---
name: manifest
group: plugin
title: On the api object
signature: : ModRecord
---

This mod's own `mod.json`, as the loader parsed it — its version, its author, the settings it declares.

```js
api.manifest.version;      // '1.2.0'
api.manifest.settings;     // what the panel draws for you
```
