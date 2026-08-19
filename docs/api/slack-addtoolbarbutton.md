---
name: addToolbarButton
group: slack
title: api.slack
signature: (toolbar: ToolbarName, button: ToolbarButton): Cleanup
preview: slack-addtoolbarbutton
control: toolbar | select | controlStrip | toolbar | controlStrip, composer, channelHeader
control: label | text | Channel notes
---

Add a button to one of Slack's toolbars:

- `controlStrip` — the bottom of the rail, next to your avatar
- `composer` — the formatting row under the message box
- `channelHeader` — the right-hand side of the channel header

`before` puts the button above an existing one rather than at the end, which is where Slack's own re-renders land. Never anchor next to `.c-coachmark-anchor`: Slack's coachmark code loops on any change around it and the renderer freezes solid, with no error and no console.

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
