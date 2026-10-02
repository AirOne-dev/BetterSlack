---
name: poll
group: helpers
title: api.helpers
signature: (handler: () => void | Promise<void>, everyMs: number): Cleanup
since: 2.0.1
preview: helpers-poll
control: ms | number | 1000 | milliseconds
---

Run something every so often, and stop while nobody is looking.

It runs once immediately, then every `everyMs`, and pauses while the document is hidden, catching up as soon as it is visible again. Slack does not render while its window is hidden, and requests made then spend a rate limit shared with the client on answers nobody sees. It stops with the plugin.

```js
// Runs once now, then on the interval, and pauses while the window is hidden.
api.helpers.poll(() => refreshPresence(), 60_000);
```
