---
name: composer
group: slack
title: api.slack
signature: : { element(), focus(), caretToEnd(), insertText(text), insertLink(url, text), isEmpty() }
preview: slack-composer
control: text | text | shipping this afternoon | text to insert
control: link | text | https://github.com/AirOne-dev/BetterSlack | link to insert
---

The message box. `insertText` types into it as though you had, `insertLink` puts a real hyperlink at the caret, and `focus` puts the caret there in the first place — every insert focuses first, so calling it yourself is only needed when you want the caret and nothing else.

Insert rather than assign. Slack's composer is a Quill editor: writing to the element directly loses everything already in it, and Quill does not notice the change. `insertLink` goes through `execCommand('insertHTML')` for the same reason — Quill picks that up through its own observer, where a synthetic paste event is ignored as untrusted. Only `http(s)` URLs are accepted, so a mod cannot put a `javascript:` URL into somebody's own message.

```js
api.slack.composer.insertText('shipping this afternoon');
api.slack.composer.insertLink(message.permalink, 'the release thread');

if (api.slack.composer.isEmpty()) api.slack.composer.focus();
```
