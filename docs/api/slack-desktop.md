---
name: desktop
group: slack
title: api.slack
signature: : {
---

Slack's own translucent window, which it ships switched off.

`set` takes effect the next time Slack starts: the window's material is
chosen when the window is created, and nothing in the page can restart it.
Tell the user so rather than leaving them to wonder why nothing happened.

```js
// Slack's own preferences, the ones it keeps outside app.asar
api.slack.desktop.keys();                     // what may be set, and which need a restart
api.slack.desktop.get('windowVibrancy');
await api.slack.desktop.set('windowVibrancy', true);
if (api.slack.desktop.needsRestart('windowVibrancy')) await api.slack.restart();
```
