---
name: popover
group: kit
title: Component kit
signature: (content: HTMLElement, anchor: HTMLElement, options?: { onClose?: () => void }): Popover
since: 2.0.1
preview: kit-popover
control: label | text | Open a popover
---

A floating panel anchored to an element, dismissed by a click outside. It returns a handle so it can be closed or repositioned from code.

```js
const pop = kit.popover(content, anchor, {
  onClose: () => anchor.focus(),
});
// pop.place() again if the anchor moved; pop.close() to dismiss it
```
