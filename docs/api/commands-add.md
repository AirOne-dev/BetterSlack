---
name: add
group: commands
title: api.commands
signature: (command: {
---

Publish something this mod can do, so it is findable by typing rather than by hunting for a button.

```js
api.commands.add({
  id: 'open',
  title: 'Channel notes',
  subtitle: 'A scratchpad for this channel',
  icon: '📝',
  run: () => open(),
});
```
