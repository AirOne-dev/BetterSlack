---
name: version
group: plugin
title: On the api object
signature: : string
since: 2.0.1
preview: plugin-version
---

BetterSlack's version, not the mod's — the mod's is `api.manifest.version`.

The two move independently, which is the point: a mod carries its own version
and updates on its own, so a one-line fix to a theme does not mean pulling the
loader and the runtime with it. Read this one when behaviour depends on what the
host can do, and the manifest's when it depends on the mod.

```js
api.version;   // BetterSlack's version, not the mod's
```
