---
name: startHuddle
group: slack
title: api.slack
signature: (userId: string): Promise<boolean>
since: 2.0.1
preview: slack-starthuddle
---

Start a huddle with someone: open the conversation, then press Slack's own
start control.

This one really is a press, and there is no way around it -- measured:
`rooms.join` provisions a room that rings nobody, there is no
`slack://huddle` scheme, and the handler goes through Electron to open a
separate window that no web API exposes. A plain element.click() reaches
it, so at least no trusted gesture is needed.

Resolves false when Slack shows no huddle control for that conversation.

```js
// Opens the conversation, then presses Slack's own start control.
const started = await api.slack.startHuddle('U0EXAMPLE1');
```
