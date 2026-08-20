---
name: openMessage
group: slack
title: api.slack
signature: (channelId: string, ts: string, options?: { team?: string }): void
preview: slack-openmessage
control: channel | text | C0BFQCYBRAB | channel id
control: ts | text | 1786386808.130969 | message ts
---

Move the client to one message, and highlight it. The same deep link
`openConversation` uses, with the message's timestamp on it: Slack routes it in
place and flashes the message it lands on, the way its own search results do.

The team matters. Search answers across every workspace you are signed into, so
a link built without one goes to whichever client is on screen and lands on a
channel id that may not exist there. Pass `team` whenever the message came from
somewhere that names it; left out, it is the workspace being drawn.

```js
// Slack's search gives you the conversation and the message inside it.
const { items } = await api.slack.web.call('search.modules.messages', { module: 'messages', query: 'release' });
const hit = items[0];
api.slack.openMessage(hit.channel.id, hit.messages[0].ts, { team: hit.team });
```
