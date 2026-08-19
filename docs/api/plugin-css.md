---
name: css
group: plugin
title: On the api object
signature: (text: string): void
preview: plugin-css
---

Stylesheet owned by this plugin; replaced wholesale on each call.

```js
// Replaced wholesale on each call: a mod owns exactly one stylesheet.
api.css(`
  .p-channel_sidebar { border-right: 1px solid var(--dt_color-otl-sec); }
`);
```
