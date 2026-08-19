---
name: waitFor
group: dom
title: api.dom
signature: : typeof waitFor
preview: dom-waitfor
---

Wait for an element to appear, up to a timeout. It resolves null rather than throwing, so a mod that starts before Slack has drawn can say so.

```js
const composer = await api.dom.waitFor('[data-qa="message_input"]', 5000);
if (!composer) return;   // it resolves null rather than throwing
```
