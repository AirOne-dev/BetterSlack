---
name: startHuddle
group: slack
title: api.slack
signature: (userId: string): Promise<boolean>
since: 2.0.1
preview: slack-starthuddle
---

Start a huddle with someone: open the conversation, then press Slack's own start control in the channel header.

Slack has no API call or deep link that starts a huddle, so the control is pressed; a plain click reaches it and no trusted gesture is needed. Slack opens the huddle in a separate window. Resolves false when Slack shows no huddle control for that conversation.

```js
// Opens the conversation, then presses Slack's own start control.
const started = await api.slack.startHuddle('U0EXAMPLE1');
```
