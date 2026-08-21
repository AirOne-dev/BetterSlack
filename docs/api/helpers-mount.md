---
name: mount
group: helpers
title: api.helpers
signature: (container: string, id: string, factory: () => HTMLElement, options?: { before?: string }): Cleanup
since: 2.0.1
preview: helpers-mount
---

Keep an element in a container across Slack's re-renders, and take it away when the plugin stops. `before` puts it above an existing button rather than at the end, which is where Slack's own re-renders land.

```js
api.helpers.mount('.p-control_strip', 'my-button', () => button, {
  before: '#betterslack-control-button',
});
```
