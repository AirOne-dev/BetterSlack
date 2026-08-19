---
name: error
group: log
title: api.log
signature: : (...args: unknown[]) => void
preview: log-error
---

The same, at error level. The loader forwards these to its terminal whatever the verbosity, because an error at boot is the one line you need.

```js
api.log.error('failed to save', error);
```
