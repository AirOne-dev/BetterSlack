---
name: commands
group: app
title: api.app
signature: (): Command[]
since: 2.0.1
preview: app-commands
---

What every other mod has registered, so a palette can offer all of them rather than only its own.

```js
const everything = api.app.commands();   // what every other mod registered
```
