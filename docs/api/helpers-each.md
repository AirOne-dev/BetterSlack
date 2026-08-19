---
name: each
group: helpers
title: api.helpers
signature: <T extends Element = Element>(selector: string, handler: (element: T) => void): Cleanup
preview: helpers-each
---

Run a handler for every element matching a selector, now and in future,
and undo it for you when the plugin stops.

```js
api.helpers.each('[data-qa="message_container"]', (message) => {
  message.dataset.seen = 'true';
});
```
