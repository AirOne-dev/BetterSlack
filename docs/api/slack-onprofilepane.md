---
name: onProfilePane
group: slack
title: api.slack
signature: (handler: (pane: ProfilePane) => void): Cleanup
---

Run a handler each time a member profile pane opens.

```js
api.slack.onProfilePane(({ element, userId }) => {
  element.append(api.helpers.section('More details', rowsFor(userId)));
});
```
