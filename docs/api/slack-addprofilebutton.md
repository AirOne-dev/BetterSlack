---
name: addProfileButton
group: slack
title: api.slack
signature: (button: ProfileButton): Cleanup
preview: slack-addprofilebutton
control: label | text | Download picture
---

Add a button to the member profile pane.

```js
api.slack.addProfileButton({
  id: 'download',
  label: 'Download picture',
  icon: '<svg viewBox="0 0 20 20">…</svg>',
  onClick: ({ userId }) => save(userId),
});
```
