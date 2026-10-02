---
name: openMessage
group: slack
title: api.slack
signature: (channelId: string, ts: string, options?: { team?: string }): void
since: 3.0.0
preview: slack-openmessage
control: channel | text | C0BFQCYBRAB | channel id
control: ts | text | 1786386808.130969 | message ts
---

Move the client to one message and highlight it, the way Slack's own search results do. It is `openConversation`'s deep link with the message's timestamp on it.

Pass `team` whenever the message came from somewhere that names it: search answers across every workspace you are signed into, and a link without a team goes to the workspace on screen, where that channel may not exist. Left out, it is the workspace being drawn.

```js
// Slack's search gives you the conversation and the message inside it.
const { items } = await api.slack.web.call('search.modules.messages', { module: 'messages', query: 'release' });
const hit = items[0];
api.slack.openMessage(hit.channel.id, hit.messages[0].ts, { team: hit.team });
```
