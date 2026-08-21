---
name: debounce
group: helpers
title: api.helpers
signature: <T extends (...args: never[]) => void>(fn: T, ms: number): T
since: 2.0.1
preview: helpers-debounce
control: ms | number | 400 | milliseconds
---

Debounce. No shipped mod calls this today -- the two that debounce
something do it inside code that has no `api` to reach for: the palette's
directory search, and Demo Mode's engine, which the screenshot recipe also
runs outside the runtime. Kept because it is three lines and it is the
obvious thing to reach for.

```js
const search = api.helpers.debounce((query) => run(query), 200);
box.addEventListener('input', () => search(box.value));
```
