---
name: text
group: assets
title: api.assets
signature: (path: string): string
since: 2.0.1
preview: assets-text
control: file | select | index.js | file | index.js, mod.json
---

One of the mod's own files, as text. This is what lets a plugin keep its stylesheet in a real `.css` file, with an editor that highlights it, instead of a template literal.

```js
api.css(api.assets.text('panel.css'));
```
