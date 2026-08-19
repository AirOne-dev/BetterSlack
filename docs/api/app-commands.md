---
name: commands
group: app
title: api.app
signature: (): Command[]
---

What every other mod has registered, so a palette can offer all of them rather than only its own.

```js
const everything = api.app.commands();   // what every other mod registered
```
