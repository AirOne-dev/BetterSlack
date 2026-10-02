---
name: saveTheme
group: plugin
title: On the api object
signature: (options: { id: string; name: string; description: string; css: string }): Promise<void>
since: 2.0.1
preview: plugin-savetheme
control: id | text | my-theme | theme id
control: css | textarea | :root { --dt_color-base-pry: #101322; } | stylesheet
---

Write a theme into the user's own mods folder, where it appears in the panel like any other and survives a restart.

Themes only. A theme is CSS and the loader re-validates the manifest it is handed, so the worst a mod can do here is add a stylesheet the user can switch off. That is not true of a plugin, which is why there is no equivalent for plugins.

```js
await api.saveTheme({
  id: 'my-theme',
  name: 'My theme',
  description: 'Built with the theme builder.',
  css: buildThemeCss(palette),
});
```
