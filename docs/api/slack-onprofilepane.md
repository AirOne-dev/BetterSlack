---
name: onProfilePane
group: slack
title: api.slack
signature: (handler: (pane: ProfilePane) => void): Cleanup
preview: slack-onprofilepane
control: title | text | Local notes | section title
---

Run a handler each time a profile pane appears, with the pane and the user id it is showing. Mount per pane rather than once: a single mount fills whichever profile it reaches first and starves the other.

```js
api.slack.onProfilePane(({ element, userId }) => {
  element.append(api.helpers.section('More details', rowsFor(userId)));
});
```
