---
name: userIdFromMessage
group: slack
title: api.slack
signature: (message: MessageRef): string | null
---

The author of a message, read from their avatar URL.

```js
const userId = api.slack.userIdFromMessage(message);
// read off the avatar's URL: <team>-<user>-<hash>-<size>
```
