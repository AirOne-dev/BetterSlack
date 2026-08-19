---
name: setInstalled
group: app
title: api.app
signature: (id: string, installed: boolean): Promise<void>
preview: app-setinstalled
---

Install a mod into the user's own folder, or remove it. Installing is what the Browse shelf does.

```js
await api.app.setInstalled('aurora', true);
```
