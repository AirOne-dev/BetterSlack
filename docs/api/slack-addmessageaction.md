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

```js
api.slack.addMessageAction({
  id: 'copy-link',
  label: 'Copy link to message',
  icon: '<svg viewBox="0 0 20 20">…</svg>',
  onClick: (message) => api.helpers.copy(message.permalink),
});
```
