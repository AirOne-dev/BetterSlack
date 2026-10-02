---
name: currentChannelId
group: slack
title: api.slack
signature: (): string | null
since: 2.0.1
preview: slack-currentchannelid
---

The conversation on screen: the channel of the messages Slack has drawn, or the conversation named in the address when none are drawn yet. Null when neither names one.

The drawn channel wins because at a cold start Slack restores the view before it settles the address, so the address can name a conversation from another workspace. A view that draws messages from several conversations — Threads, Activity, Drafts — answers with one of them, so do not use this to decide whether a single conversation is open. Two workspaces can use the same channel id: key anything kept per channel by `currentTeamId()` as well.

```js
const channel = api.slack.currentChannelId();   // 'C0BFQCYBRAB' or null
```
