---
name: avatarUrl
group: slack
title: api.slack
signature: (url: string | null | undefined, size: number): string | null
since: 2.0.1
preview: slack-avatarurl
control: url | text | https://ca.slack-edge.com/T0EXAMPLE1-U0EXAMPLE1-06c4356b6ae3-48
control: size | select | 192 |  | 24, 48, 72, 192, 512
---

The same avatar at another size.

Slack serves avatars as `<base>-<size>`, so a bigger one is a string edit rather than another request: the rail renders a 48, a profile wants a 72. Returns null for anything that is not one of Slack's avatar URLs, such as a custom image or a data URI.

```js
// Slack serves them as <base>-<size>, so this is a string edit
api.slack.avatarUrl(user.image_48, 192);

// It answers null for a URL that is not that shape -- a profile's `image_72`
// ends in `.png` -- so fall back to the one you were given.
const face = api.slack.avatarUrl(profile.image_72, 72) ?? profile.image_72;
```
