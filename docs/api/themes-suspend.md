---
name: suspend
group: themes
title: api.themes
signature: (on: boolean): void
preview: themes-suspend
---

Hold every enabled theme back, or let them through again.

For a tool that has to show the app without them for a while -- a theme
editor working on top of a chosen base cannot show its own work while
whatever is switched on is still painting. Nothing is enabled or disabled
by this: the settings are untouched and the stylesheets come straight
back. Undone automatically when the plugin stops.

```js
// Hold the user's themes back while a builder paints its own preview.
api.themes.suspend(true);
api.onDispose(() => api.themes.suspend(false));
```
