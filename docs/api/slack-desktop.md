---
name: desktop
group: slack
title: api.slack
signature: : { supported, keys(), get(key), launched(key), needsRestart(key), set(key, value), clear(key), managed(), materials, setMaterial(name) }
since: 2.0.1
preview: slack-desktop
control: key | select | windowVibrancy | preference | windowVibrancy, useHwAcceleration, runFromTray, zoomLevel
control: value | boolean | true | wanted
---

Slack's own desktop preferences, the ones it keeps outside `app.asar`: a translucent window (`windowVibrancy`), GPU acceleration, the tray, the zoom level and a few more. `keys()` lists what may be set, with each key's type and whether it needs a restart.

`set` and `clear` write a preference; `get` reads its value now and `launched` the value Slack started with, so comparing the two says whether a restart would change anything. A preference read when the window is created takes effect only after `api.slack.restart()` — tell the user, and ask before restarting. `managed()` lists what BetterSlack holds. `setMaterial(name)` switches the window's material live, among the names in `materials`; on a window created opaque it changes nothing visible. `supported` is false outside macOS and Windows.

```js
// Slack's own preferences, the ones it keeps outside app.asar
api.slack.desktop.keys();                     // what may be set, and which need a restart
api.slack.desktop.get('windowVibrancy');
await api.slack.desktop.set('windowVibrancy', true);
if (api.slack.desktop.needsRestart('windowVibrancy')) await api.slack.restart();
```
