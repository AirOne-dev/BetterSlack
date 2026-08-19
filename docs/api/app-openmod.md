---
name: openMod
group: app
title: api.app
signature: (id: string): void
---

Open the panel on one mod, with its settings unfolded.

The panel is where a setting is drawn from the manifest, checked and
saved; this points at the mod's own page there -- description, picture,
readme, settings -- rather than reimplementing any of it somewhere with
less room.

```js
api.app.openMod('channel-notes');   // that mod's own page
```
