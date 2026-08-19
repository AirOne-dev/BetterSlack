---
name: onEach
group: dom
title: api.dom
signature: : <T extends Element = Element>(selector: string, handler: (element: T) => void) => Cleanup
preview: dom-oneach
---

Run a handler for every element matching a selector, now and as more arrive.

```js
api.dom.onEach('[data-qa="message_container"]', (message) => decorate(message));
```
