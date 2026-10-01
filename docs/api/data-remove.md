---
name: remove
group: data
title: api.data
signature: (name: string): Promise<boolean>
since: 3.4.0
preview: data-remove
control: name | text | my-ding.mp3 | name
---

Delete a file this mod kept. Answers true if there was one to delete, so asking twice is harmless.

```js
if (await api.ui.confirm({ title: 'Delete this sound?', message: 'It cannot be brought back.', danger: true })) {
  await api.data.remove('my-ding.mp3');
}
```
