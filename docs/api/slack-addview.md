---
name: addView
group: slack
title: api.slack
signature: (options: ViewOptions): ViewHandle
since: unreleased
preview: slack-addview
control: label | text | History
control: body | textarea | Everything Slack changed and did not tell you about.\nOne page, in the place Slack keeps its own.
---

A whole view of your own, with its tab in Slack's rail — everything Home, Direct messages and Activity do. The tab sits beside theirs wearing Slack's own classes, so it follows every theme; the page covers the conversation while the workspace rail and the channel sidebar stay live; one tab is lit at a time, and clicking another of Slack's tabs leaves, exactly as leaving Activity does. `render` is called each time it opens, and `refresh()` runs it again in place. Use `tabSelector` to hang a `helpers.badge` on the tab rather than rebuilding the selector by hand.

```js
const view = api.slack.addView({
  id: 'log',
  label: 'History',
  icon: ICON,
  render: () => api.dom.h('div', {}, ['Everything that happened']),
});

api.helpers.badge(view.tabSelector, 'new', () => unread || null);
```
