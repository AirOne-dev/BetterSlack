---
name: describeMessage
group: slack
title: api.slack
signature: (element: HTMLElement): MessageRef
since: 2.0.1
preview: slack-describemessage
---

Everything about a message that a mod usually wants, read off the element Slack drew: its channel, its timestamp, its permalink and its text.

```js
const message = api.slack.describeMessage(element);
// { element, channelId, ts, permalink, text }
```
