---
name: addView
group: slack
title: api.slack
signature: (options: ViewOptions): ViewHandle
since: 3.1.0
preview: slack-addview
control: label | text | History
control: body | textarea | Everything Slack changed and did not tell you about.\nOne page, in the place Slack keeps its own.
---

A whole view of your own, with its tab in Slack's rail — everything Home, Direct messages and Activity do. The tab sits beside theirs wearing Slack's own classes, so it follows every theme; the page takes the whole tab panel, the channel sidebar included, because those views replace it too, and what is under it is hidden rather than covered — covered, Slack keeps the conversation on screen and marks anything arriving in it as read; the workspace rail is all that is left beside it; one tab is lit at a time, and clicking another of Slack's tabs leaves, exactly as leaving Activity does. `render` is called each time it opens, and `refresh()` runs it again in place. Use `tabSelector` to hang a `helpers.badge` on the tab rather than rebuilding the selector by hand.

```js
const view = api.slack.addView({
  id: 'log',
  label: 'History',
  icon: ICON,
  render: () => api.dom.h('div', {}, ['Everything that happened']),
});

api.helpers.badge(view.tabSelector, 'new', () => unread || null);
```
