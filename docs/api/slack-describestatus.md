---
name: describeStatus
group: slack
title: api.slack
signature: (who: SlackUser | SlackProfile, customEmoji?: Map<string, string>): SlackStatus | null
preview: slack-describestatus
control: text | text | On holiday | status text
control: emoji | select | palm_tree | status emoji | palm_tree, glitch_crab, tada, no_such_emoji
control: known | boolean | true | the workspace knows it
---

Somebody's status, ready to draw: the sentence, the emoji name without its colons, an image for that emoji when one could be found, and when it clears. Null when there is no status at all, so a caller can test the result rather than three fields.

Takes a user or a profile, because callers do not always know which they are holding — `users.info` gives one and a profile pane read gives the other.

Drawing the emoji is the hard half, and it takes three sources in order. What Slack sent with the profile (`status_emoji_display_info`) wins: it is the answer for *this* profile. Then the workspace's custom emoji, which you pass in from `api.slack.web.emoji()` — held by the caller because it is one request for a whole workspace and a member list redraws constantly. Then anything Slack has already drawn on the page: every emoji Slack renders is an `<img>` carrying `data-stringify-emoji`, so its own DOM is a name-to-image table for the set this workspace actually uses.

A name none of the three knows resolves to `imageUrl: null`, and the sentence is still there.

```js
const custom = await api.slack.web.emoji();
const status = api.slack.describeStatus(user, custom);
if (status) row.append(api.slack.statusNode(status, user.profile));
```
