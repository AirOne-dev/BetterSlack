---
name: add
group: commands
title: api.commands
signature: (command: { id, title, subtitle?, icon?, run }): Cleanup
since: 2.0.1
preview: commands-add
control: title | text | Channel notes
control: subtitle | text | A scratchpad for this channel
control: icon | text | 📝
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
