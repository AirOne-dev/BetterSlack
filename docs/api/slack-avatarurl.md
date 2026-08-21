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

Slack serves them as `<base>-<size>`, so asking for a bigger one is a
string edit rather than another request -- the rail renders a 48 and a
profile wants a 72, and every mod that shows a face was doing this by hand.
Returns null for anything that is not one of Slack's avatar URLs, which is
what a custom image or a data URI will be.

```js
// Slack serves them as <base>-<size>, so this is a string edit
api.slack.avatarUrl(user.image_48, 192);
```
