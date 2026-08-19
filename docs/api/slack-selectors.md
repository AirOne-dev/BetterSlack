---
name: selectors
group: slack
title: api.slack
signature: : Readonly<Record<string, string>>
preview: slack-selectors
---

The Slack selectors this project has measured and kept working, for a mod that needs to go past these helpers. Anchored on `data-qa` attributes rather than class names, which churn with every Slack release.

```js
api.slack.selectors.messageText;    // '[data-qa="message-text"]'
// The handful of Slack selectors this project has measured and kept working.
```
