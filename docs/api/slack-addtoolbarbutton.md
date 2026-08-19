---
name: addToolbarButton
group: slack
title: api.slack
signature: (toolbar: ToolbarName, button: ToolbarButton): Cleanup
preview: slack-addtoolbarbutton
control: toolbar | select | controlStrip |  | controlStrip, composer, channelHeader
control: label | text | Channel notes
---

Add a button to one of Slack's toolbars:
  `controlStrip`  – the bottom of the rail, next to your avatar
  `composer`      – the formatting row under the message box
  `channelHeader` – the right-hand side of the channel header

```js
api.slack.addToolbarButton('controlStrip', {
  id: 'notes',
  label: 'Notes',
  description: 'A scratchpad for this channel',
  icon: '<svg viewBox="0 0 20 20">…</svg>',
  before: '#betterslack-control-button',
  onClick: () => open(),
});
```
