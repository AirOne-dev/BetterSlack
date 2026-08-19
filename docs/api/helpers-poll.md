---
name: poll
group: helpers
title: api.helpers
signature: (handler: () => void | Promise<void>, everyMs: number): Cleanup
preview: helpers-poll
control: ms | number | 1000 | milliseconds
---

Run something every so often, and stop while nobody is looking.

Slack does not render while its window is hidden, so a poll that keeps
going in the background is requests nobody will see the result of -- and
for anything hitting Slack's API, requests against a rate limit that is
shared with the client itself. This runs once immediately, then on the
interval, and pauses whenever the document is hidden, catching up as soon
as it comes back. Stops with the plugin.

```js
// Runs once now, then on the interval, and pauses while the window is hidden.
api.helpers.poll(() => refreshPresence(), 60_000);
```
