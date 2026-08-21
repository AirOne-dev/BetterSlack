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
