---
name: selectors
group: slack
title: api.slack
signature: : Readonly<Record<string, string>>
since: 2.0.1
preview: slack-selectors
---

The Slack selectors this project has measured and kept working, for a mod that needs to go past these helpers. Anchored on `data-qa` attributes rather than class names, which churn with every Slack release — so read one from here rather than writing it out, or your copy is the one nobody updates when Slack moves.

```js
const { composer, composerEditor } = api.slack.selectors;
api.dom.keepMounted(composer, 'my-counter', () => counter);
document.querySelector(composerEditor);   // '.ql-editor'
```
