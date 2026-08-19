---
name: css
group: plugin
title: On the api object
signature: (text: string): void
preview: plugin-css
control: css | textarea | .p-channel_sidebar {\n  border-right: 2px solid #6cb6ff;\n} | stylesheet
---

This plugin's stylesheet, replaced wholesale on each call. That is the contract: a mod that recomputed its CSS on every settings change would otherwise stack copies of it for ever. The helpers write through a node of their own, so using both is safe.

```js
// Replaced wholesale on each call: a mod owns exactly one stylesheet.
api.css(`
  .p-channel_sidebar { border-right: 1px solid var(--dt_color-otl-sec); }
`);
```
