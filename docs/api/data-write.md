---
name: write
group: data
title: api.data
signature: (name: string, content: Blob | ArrayBuffer | Uint8Array | string): Promise<{ name: string; bytes: number; modified: number }>
since: unreleased
preview: data-write
control: name | text | my-ding.mp3 | name
control: bytes | number | 48320 | size in bytes
---

Keep a file of this mod's own, on disk, across restarts and updates: a sound somebody picked, a picture, an export. It goes under `~/.betterslack/data/<mod id>/`, which no other mod can name; the name is reduced to a safe basename, at most 8 MB a file and 64 MB a mod. A file of the same name is replaced. Nothing is deleted when the mod is switched off or removed.

```js
// A file the person picked, kept for good.
const [file] = input.files;
const { name } = await api.data.write(file.name, file);
```
