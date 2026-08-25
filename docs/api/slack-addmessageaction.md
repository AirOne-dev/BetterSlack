---
name: addMessageAction
group: slack
title: api.slack
signature: (action: MessageAction): Cleanup
since: 2.0.1
preview: slack-addmessageaction
control: label | text | Copy link
---

A button in the toolbar Slack draws while the pointer is over a message. The handler is given the message: its channel, its timestamp, its permalink and its text.

`when` decides which messages it belongs on, asked as the toolbar is built. A button that is there for every message and does nothing for most of them is worse than no button: the toolbar is four items wide and Slack's own are all live.

```js
api.slack.addMessageAction({
  id: 'copy-link',
  label: 'Copy link to message',
  icon: '<svg viewBox="0 0 20 20">…</svg>',
  onClick: (message) => api.helpers.copy(message.permalink),
});

api.slack.addMessageAction({
  id: 'edits',
  label: 'Earlier wordings',
  icon: '<svg viewBox="0 0 20 20">…</svg>',
  // Only where there is something to show.
  when: (message) => versionsOf(message.channelId, message.ts).length > 1,
  onClick: (message) => showVersions(message),
});
```
