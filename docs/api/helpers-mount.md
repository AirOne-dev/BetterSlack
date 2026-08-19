---
name: mount
group: helpers
title: api.helpers
signature: (container: string, id: string, factory: () => HTMLElement, options?: { before?: string }): Cleanup
preview: helpers-mount
---

Keep an element mounted somewhere, surviving Slack's re-renders.

```js
api.helpers.mount('.p-control_strip', 'my-button', () => button, {
  before: '#betterslack-control-button',
});
```
