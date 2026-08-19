---
name: describeMessage
group: slack
title: api.slack
signature: (element: HTMLElement): MessageRef
preview: slack-describemessage
---

Read channel, timestamp, permalink and text off a message element.

```js
const message = api.slack.describeMessage(element);
// { element, channelId, ts, permalink, text }
```
