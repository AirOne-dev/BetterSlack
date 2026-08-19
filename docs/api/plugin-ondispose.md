---
name: onDispose
group: plugin
title: On the api object
signature: (fn: Cleanup): void
---

Register a teardown callback; runs when the plugin is disabled.

```js
const timer = setInterval(tick, 1000);
api.onDispose(() => clearInterval(timer));
```
