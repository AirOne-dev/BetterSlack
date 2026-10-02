---
name: openConversation
group: slack
title: api.slack
signature: (channelId: string): void
since: 2.0.1
preview: slack-openconversation
control: channel | text | C0EXAMPLE1 | channel id
control: name | text | design | its name
---

Move the client to a conversation without a page load.

It goes through Slack's `slack://channel` deep link, which the desktop app routes in place: same document, no reload, and the view follows. Slack's router is not reachable from a mod, and an `<a>` to `/archives/<id>` leaves the client entirely, so this is the way to navigate.

```js
// A deep link Slack routes in place: same document, no reload.
api.slack.openConversation('C0BFQCYBRAB');
```
