---
name: hoverable
group: kit
title: Component kit
signature: <T extends HTMLElement>(node: T, handlers: HoverHandlers): T
preview: kit-hoverable
---

Attach enter and leave handlers to an element without writing the pair of listeners each time.

```js
kit.hoverable(row, {
  enter: () => preview.show(row.dataset.id),
  leave: () => preview.hide(),
});
```
