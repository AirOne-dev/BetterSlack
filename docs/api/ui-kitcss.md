---
name: kitCss
group: ui
title: api.ui
signature: : string
---

The kit's stylesheet. Put it in the document the kit is building in.

```js
const style = child.document.createElement('style');
style.textContent = api.ui.kitCss;
child.document.head.append(style);
```
