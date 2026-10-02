---
name: debounce
group: helpers
title: api.helpers
signature: <T extends (...args: never[]) => void>(fn: T, ms: number): T
since: 2.0.1
preview: helpers-debounce
control: ms | number | 400 | milliseconds
---

Wrap a function so a burst of calls runs it once, `ms` after the last call, with that call's arguments.

```js
const search = api.helpers.debounce((query) => run(query), 200);
box.addEventListener('input', () => search(box.value));
```
