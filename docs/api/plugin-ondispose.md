---
name: onDispose
group: plugin
title: On the api object
signature: (fn: Cleanup): void
since: 2.0.1
preview: plugin-ondispose
---

Register a teardown callback. It runs when the plugin is switched off, which is the moment everything a mod started has to stop: intervals, listeners, anything it put on the page.

```js
const timer = setInterval(tick, 1000);
api.onDispose(() => clearInterval(timer));
```
