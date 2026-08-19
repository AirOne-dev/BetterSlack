---
name: kitCss
group: ui
title: api.ui
signature: : string
---

The kit's stylesheet, as text, for the document a mod opened. A window a mod opens is blank — no Slack stylesheet to borrow — so this is what makes the primitives look like anything.

```js
const style = child.document.createElement('style');
style.textContent = api.ui.kitCss;
child.document.head.append(style);
```
