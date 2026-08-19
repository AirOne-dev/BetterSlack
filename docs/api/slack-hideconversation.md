---
name: hideConversation
group: slack
title: api.slack
signature: (channelId: string): Promise<void>
---

Remove a conversation from the sidebar. The history is untouched.

```js
// Removes it from the sidebar. The history is untouched.
await api.slack.hideConversation('C0BFQCYBRAB');
```
