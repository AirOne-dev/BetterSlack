---
name: restart
group: slack
title: api.slack
signature: (): Promise<void>
since: 2.0.1
preview: slack-restart
---

Stop Slack and start it again, with the loader still driving.

For settings that are read when a window is created, so they can never
take effect in place. This tears down the page that called it: do nothing
after it but let go, and never call it without asking first.

```js
// The loader stops Slack, applies what was wanted and launches it again,
// rebuilding its own connection in place.
await api.slack.restart();
```
