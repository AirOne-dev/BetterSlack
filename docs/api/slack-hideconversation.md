---
name: hideConversation
group: slack
title: api.slack
signature: (channelId: string): Promise<void>
since: 2.0.1
preview: slack-hideconversation
control: channel | text | design | channel
---

Take a conversation out of the sidebar. The history is untouched — this is Slack's own hide, not a leave.

```js
// Removes it from the sidebar. The history is untouched.
await api.slack.hideConversation('C0BFQCYBRAB');
```
