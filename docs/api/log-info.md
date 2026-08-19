---
name: info
group: log
title: api.log
signature: : (...args: unknown[]) => void
preview: log-info
control: message | text | loaded 23 mods
---

Write a line to the console, prefixed with this mod's id. The loader forwards it to the terminal, which is where a mod that failed at boot says so.

```js
api.log.info('loaded', mods.length, 'mods');
// prefixed with the mod's id, and forwarded to the loader's terminal
```
