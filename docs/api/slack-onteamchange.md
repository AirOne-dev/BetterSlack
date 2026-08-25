---
name: onTeamChange
group: slack
title: Slack
signature: (handler: (teamId: string | null, previous: string | null) => void): Cleanup
since: unreleased
preview: slack-onteamchange
control: from | text | T025V5WN2 | leaving
control: to | text | T0BQ89Z4L4F | arriving at
---

Switching workspace does not reload the client. Same page, same mods, same api objects, new team id in the address — so anything a mod cached belongs to the workspace the user has just left, and a mod that does not drop it goes quietly wrong rather than visibly broken: a member list of people who are not there, a status from somewhere else, a channel name on the wrong conversation.

It fires with the workspace now on screen and the one before it, never at boot and never twice for the same id. Under it are Slack's own in-place navigations, which fire in the same tick as the route change, and a slow check for the one case they miss: at a cold start Slack restores the view before it settles the address, so the workspace is corrected from what has been drawn rather than by navigating.

Two workspaces can also use the same channel id, so state keyed by conversation has to be keyed by both — dropping it here is the simplest way to be sure.

```js
const profiles = new Map();

api.slack.onTeamChange(() => {
  // Different people, different custom emoji, different everything.
  profiles.clear();
  customEmoji = null;
});
```
