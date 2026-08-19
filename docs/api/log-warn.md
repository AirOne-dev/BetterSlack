---
name: warn
group: log
title: api.log
signature: : (...args: unknown[]) => void
preview: log-warn
---

The same, at warning level. The loader forwards these even without BETTERSLACK_VERBOSE.

```js
api.log.warn('could not list members:', error.message);
```
