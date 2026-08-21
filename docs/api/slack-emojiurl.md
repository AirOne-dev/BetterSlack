---
name: emojiUrl
group: slack
title: api.slack
signature: (name: string, customEmoji?: Map<string, string>): string | null
since: 3.0.0
preview: slack-emojiurl
control: name | select | glitch_crab | emoji name | glitch_crab, tada, no_such_emoji
control: known | boolean | true | the workspace knows it
---

An image for an emoji name, or `null` when nothing can draw it. The colons are
optional — `tada` and `:tada:` are the same question.

Two sources, in order. The workspace's custom emoji, which you pass in from
`api.slack.web.emoji()` — held by the caller because it is one request for a
whole workspace and a list redraws constantly. Then anything Slack has already
drawn on the page: every emoji Slack renders is an `<img>` carrying
`data-stringify-emoji`, so the client's own DOM is a name-to-image table for the
set this workspace actually uses.

A name neither knows draws nothing rather than the raw `:shortcode:`, which on
screen reads as a rendering that failed. Where a message gives you the
codepoints — Slack's `rich_text` blocks carry `unicode` on every standard emoji
— draw the character instead and ask nothing of this.

```js
const custom = await api.slack.web.emoji();
const url = api.slack.emojiUrl('tada', custom);
if (url) row.append(Object.assign(new Image(), { src: url, alt: ':tada:' }));
```
