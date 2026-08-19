---
name: statusNode
group: slack
title: api.slack
signature: (status: SlackStatus, profile?: SlackProfile): HTMLElement
preview: slack-statusnode
control: text | text | On holiday | status text
control: emoji | select | palm_tree | status emoji | palm_tree, glitch_crab, tada, no_such_emoji
control: known | boolean | true | the workspace knows it
---

That status as a node, so the two mods that show one draw the same thing. An image when an emoji resolved, the unicode character when Slack sent one, and the sentence beside it.

Never the raw shortcode. `:tada:` on screen reads as a rendering that failed, which is also what Slack does with an emoji it cannot draw — the name goes in the element's `title` instead, so it is still there to be found. The sentence is drawn either way: it is the half carrying the meaning, and an emoji nobody could resolve is no reason to drop it.

Its stylesheet ships with the runtime rather than with each mod. Two of them show a status, and one that is 15px here and 20px there is exactly the drift this pair exists to stop.

```js
const status = api.slack.describeStatus(user, await api.slack.web.emoji());
if (status) {
  const node = api.slack.statusNode(status, user.profile);
  if (status.expiresAt) node.title += ` (until ${status.expiresAt.toLocaleTimeString()})`;
  row.append(node);
}
```
