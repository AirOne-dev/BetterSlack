---
name: toggle
group: helpers
title: api.helpers
signature: (options: ToggleOptions): Toggle
preview: helpers-toggle
control: className | text | demo-zen | class on <html>
control: defaultOn | boolean | false
---

A persisted on/off flag that also drives a class on <html>, so the whole
behaviour can be pure CSS. This is the shape most "mode" mods want.

```js
const zen = api.helpers.toggle({
  key: 'on',
  className: 'my-zen',
  defaultOn: false,
  whenOn: '& .p-channel_sidebar { display: none !important; }',
  onChange: (on) => api.log.info(on ? 'on' : 'off'),
});
await zen.toggle();   // zen.on tells you where it landed
```
