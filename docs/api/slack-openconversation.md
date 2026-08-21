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

Move the client to a conversation, without a page load.

Slack's own navigation lives in a private closure: its router state is
pushed with history.pushState and nothing outside reacts to a synthetic
popstate, there is no exposed React Router instance, and an <a> to
/archives/<id> leaves the client entirely. What does work is Slack's own
documented deep-link scheme, which the desktop app handles in place --
measured against 4.51: same document, no reload, view follows.

```js
// A deep link Slack routes in place: same document, no reload.
api.slack.openConversation('C0BFQCYBRAB');
```
