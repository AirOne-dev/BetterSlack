---
name: currentChannelId
group: slack
title: api.slack
signature: (): string | null
---

The channel currently open, read from the client URL.

```js
const channel = api.slack.currentChannelId();   // 'C0BFQCYBRAB' or null
```
