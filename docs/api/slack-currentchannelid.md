---
name: currentChannelId
group: slack
title: api.slack
signature: (): string | null
since: 2.0.1
preview: slack-currentchannelid
---

The channel on screen, read out of the URL. Null when what is on screen is not a conversation. Two workspaces can use the same channel id, so compare the team as well when you keep anything per-channel.

```js
const channel = api.slack.currentChannelId();   // 'C0BFQCYBRAB' or null
```
