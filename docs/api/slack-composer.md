---
name: composer
group: slack
title: api.slack
signature: : ComposerApi
preview: slack-composer
control: text | text | shipping this afternoon
---

The message composer.

```js
api.slack.composer.insert(`<${message.permalink}|.>`);
api.slack.composer.focus();
```
