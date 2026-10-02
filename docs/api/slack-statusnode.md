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

A status as a node: an image when the emoji resolved, the unicode character when Slack sent one, and the sentence beside it. Its stylesheet ships with the runtime, so every mod that shows a status draws the same thing.

Never the raw shortcode: `:tada:` on screen reads as a rendering that failed. The emoji's name goes in the tooltip instead, so it can still be found, and the sentence is drawn either way.

**Hovering it opens Slack's kind of tooltip**, with the emoji, the sentence and when the status runs out — which is why the emoji alone is enough in a narrow row. `showText: false` drops the sentence from the row and keeps it in the tooltip; pass the whole status rather than one with the text blanked, or the tooltip has nothing to say. `placement` moves the tooltip, for a column against the right edge of the window. When the status sits inside a control, `tooltipOn` hangs the hover on that control and `hint` adds a last line saying what clicking does, so one target has one tooltip.

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
