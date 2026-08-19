---
name: setInstalled
group: app
title: api.app
signature: (id: string, installed: boolean): Promise<void>
---

Install or remove a mod from the user's own folder.

```js
await api.app.setInstalled('aurora', true);
```
