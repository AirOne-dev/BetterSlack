---
name: saveTheme
group: plugin
title: On the api object
signature: (options: { id: string; name: string; description: string; css: string }): Promise<void>
---

Write a theme into the user's own mods folder, where it appears in the
panel like any other and survives a restart.

Deliberately themes only. A theme is CSS and the loader re-validates the
manifest it is handed, so the worst a mod can do here is add an ugly
stylesheet the user can switch off -- which is not true of plugins, and is
why there is no equivalent for them.

```js
await api.saveTheme({
  id: 'my-theme',
  name: 'My theme',
  description: 'Built with the theme builder.',
  css: buildThemeCss(palette),
});
```
