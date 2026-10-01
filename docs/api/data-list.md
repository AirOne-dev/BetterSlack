---
name: list
group: data
title: api.data
signature: (): Promise<Array<{ name: string; bytes: number; modified: number }>>
since: unreleased
preview: data-list
---

Every file this mod has kept, by name, with its size and when it was last written. Only this mod's: another mod's folder is not reachable from here.

```js
for (const { name, bytes } of await api.data.list()) {
  console.log(name, `${Math.round(bytes / 1024)} kB`);
}
```
