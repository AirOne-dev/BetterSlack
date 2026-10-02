---
name: selectors
group: slack
title: api.slack
signature: : Readonly<Record<string, string>>
since: 2.0.1
preview: slack-selectors
---

The Slack selectors BetterSlack keeps working, for a mod that needs to go past these helpers. They are anchored on `data-qa` attributes rather than class names, which change with Slack releases. Read one from here rather than writing your own copy, so it is updated along with BetterSlack.

```js
const { composer, composerEditor } = api.slack.selectors;
api.dom.keepMounted(composer, 'my-counter', () => counter);
document.querySelector(composerEditor);   // '.ql-editor'
```
