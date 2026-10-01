---
name: read
group: data
title: api.data
signature: (name: string): Promise<Blob | null>
since: unreleased
preview: data-read
control: name | text | my-ding.mp3 | name
---

A file this mod kept, as a Blob typed from its extension, or null when there is none by that name. Typed, so an `<audio>` or an `<img>` can use it straight away through an object URL.

```js
const blob = await api.data.read('my-ding.mp3');
if (blob) new Audio(URL.createObjectURL(blob)).play();
```
