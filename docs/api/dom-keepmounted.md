---
name: keepMounted
group: dom
title: api.dom
signature: : (containerSelector: string, nodeId: string, factory: () => HTMLElement, position?: 'append' | 'prepend') => Cleanup
since: 2.0.1
preview: dom-keepmounted
---

Keep an element in a container, putting it back whenever Slack re-renders that container away. It gives up after 25 remounts in two seconds rather than looping.

```js
api.dom.keepMounted('.p-control_strip', 'my-button', () => button, 'prepend');
// re-inserts it whenever Slack re-renders that container away
```
