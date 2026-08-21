---
name: statusNode
group: slack
title: api.slack
signature: (status: SlackStatus, profile?: SlackProfile, options?: StatusNodeOptions): HTMLElement
since: 2.1.0
preview: slack-statusnode
control: text | text | On holiday | status text
control: emoji | select | palm_tree | status emoji | palm_tree, glitch_crab, tada, no_such_emoji
control: known | boolean | true | the workspace knows it
control: showText | boolean | true | draw the sentence in the row
control: expires | boolean | false | the status runs out
---

That status as a node, so the two mods that show one draw the same thing. An image when an emoji resolved, the unicode character when Slack sent one, and the sentence beside it.

Never the raw shortcode. `:tada:` on screen reads as a rendering that failed, which is also what Slack does with an emoji it cannot draw — the name goes in the tooltip instead, so it is still there to be found. The sentence is drawn either way: it is the half carrying the meaning, and an emoji nobody could resolve is no reason to drop it.

**Hovering it opens Slack's own kind of tooltip**, with the emoji, the sentence, and when it runs out — which is what Slack's sidebar does and the reason the emoji alone is enough in a narrow row. `showText: false` keeps the picture and drops the sentence from the row *without* dropping it from the tooltip; pass the whole status rather than one with the text blanked, or the tooltip has nothing left to say. `placement` moves the tooltip for a column against the right edge of the window.

Its stylesheet ships with the runtime rather than with each mod. Two of them show a status, and one that is 15px here and 20px there is exactly the drift this pair exists to stop.

```js
const status = api.slack.describeStatus(user, await api.slack.web.emoji());
if (status) {
  // A row this narrow has no space for the sentence, and no need: it is in the
  // tooltip, with the expiry under it.
  row.append(api.slack.statusNode(status, user.profile, {
    showText: false,
    placement: 'left',
  }));
}
```
