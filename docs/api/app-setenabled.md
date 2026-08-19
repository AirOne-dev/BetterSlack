---
name: setEnabled
group: app
title: api.app
signature: (id: string, enabled: boolean): Promise<void>
preview: app-setenabled
control: enabled | boolean | false | on
---

Switch a mod on or off, exactly as the panel's own toggle does — including writing it to the settings file.

```js
await api.app.setEnabled('midnight', true);
```
