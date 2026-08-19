---
name: text
group: assets
title: api.assets
signature: (path: string): string
---

One of the mod's own files, as text. This is what lets a plugin keep its stylesheet in a real `.css` file, with an editor that highlights it, instead of a template literal.

```js
api.css(api.assets.text('panel.css'));
```
