---
name: onEach
group: dom
title: api.dom
signature: : <T extends Element = Element>(selector: string, handler: (element: T) => void) => Cleanup
preview: dom-oneach
---

Run a handler for every element matching a selector, now and as more arrive.

An element is handled once and only once: matches are remembered in a `WeakSet`,
so a re-render that moves a node around does not decorate it twice. This is the
primitive under `api.helpers.each`, and the one to reach for when the handler
does not need the helper's cleanup tracking.

```js
api.dom.onEach('[data-qa="message_container"]', (message) => decorate(message));
```
