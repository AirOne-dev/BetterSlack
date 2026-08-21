---
name: addProfileButton
group: slack
title: api.slack
signature: (button: ProfileButton): Cleanup
since: 2.0.1
preview: slack-addprofilebutton
control: label | text | Download picture
---

A button in a member's profile pane, given the user id when it is pressed. It appears in anything wearing Slack's profile markup, including a pane another mod drew.

```js
api.slack.addProfileButton({
  id: 'download',
  label: 'Download picture',
  icon: '<svg viewBox="0 0 20 20">…</svg>',
  onClick: ({ userId }) => save(userId),
});
```
