---
name: addMessageAction
group: slack
title: api.slack
signature: (action: MessageAction): Cleanup
preview: slack-addmessageaction
control: label | text | Copy link
---

Add a button to the hover toolbar on messages.

```js
api.slack.addMessageAction({
  id: 'copy-link',
  label: 'Copy link to message',
  icon: '<svg viewBox="0 0 20 20">…</svg>',
  onClick: (message) => api.helpers.copy(message.permalink),
});
```
