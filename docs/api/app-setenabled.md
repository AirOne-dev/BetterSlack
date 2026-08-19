---
name: setEnabled
group: app
title: api.app
signature: (id: string, enabled: boolean): Promise<void>
---

Switch a mod on or off, as the panel's own toggle does.

```js
await api.app.setEnabled('midnight', true);
```
