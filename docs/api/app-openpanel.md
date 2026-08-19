---
name: openPanel
group: app
title: api.app
signature: (tab?: 'themes' | 'plugins' | 'css' | 'about'): void
preview: app-openpanel
---

Open the Mods panel, optionally on a particular tab. With no argument it opens wherever it was left.

```js
api.app.openPanel('themes');   // or no argument for wherever it was
```
