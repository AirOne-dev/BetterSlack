---
name: openUserProfile
group: slack
title: api.slack
signature: (userId: string): void
preview: slack-openuserprofile
control: user | text | U0EXAMPLE2 | user id
---

Open somebody's profile, through Slack's own deep link — same document, no reload. Not every id has one: an app, or a conversation with yourself, gives a pane that never appears.

```js
api.slack.openUserProfile('U0EXAMPLE1');
```
