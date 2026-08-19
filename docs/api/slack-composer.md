---
name: composer
group: slack
title: api.slack
signature: : ComposerApi
preview: slack-composer
control: text | text | shipping this afternoon
---

The message box: `insert()` types into it as though you had, and `focus()` puts the caret there. Insert rather than assign — the composer is a Quill editor, and writing to it directly loses everything else in it.

```js
api.slack.composer.insert(`<${message.permalink}|.>`);
api.slack.composer.focus();
```
