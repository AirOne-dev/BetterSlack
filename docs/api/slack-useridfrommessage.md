---
name: userIdFromMessage
group: slack
title: api.slack
signature: (message: MessageRef): string | null
preview: slack-useridfrommessage
---

The author's id, read off the avatar's URL — Slack writes them as `<team>-<user>-<hash>-<size>`. Null when the message has no avatar to read, which is the case for a consecutive message from the same person.

```js
const userId = api.slack.userIdFromMessage(message);
// read off the avatar's URL: <team>-<user>-<hash>-<size>
```
