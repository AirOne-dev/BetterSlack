---
name: selectors
group: slack
title: api.slack
signature: : Readonly<Record<string, string>>
preview: slack-selectors
---

Stable selectors, for mods that need to go beyond these helpers.

```js
api.slack.selectors.messageText;    // '[data-qa="message-text"]'
// The handful of Slack selectors this project has measured and kept working.
```
