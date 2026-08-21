---
name: openDirectMessage
group: slack
title: api.slack
signature: (userId: string): Promise<string | null>
since: 2.0.1
preview: slack-opendirectmessage
control: user | text | U0EXAMPLE2 | user id
---

Open the direct message with someone, creating it if there is none.

`conversations.open` returns the IM's id, and opening one that did not
exist makes Slack navigate to it on its own; the deep link covers the rest.

```js
const channelId = await api.slack.openDirectMessage('U0EXAMPLE1');
```
