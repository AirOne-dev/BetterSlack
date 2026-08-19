---
name: currentTeamId
group: slack
title: api.slack
signature: (): string | null
preview: slack-currentteamid
---

The workspace the client is showing. Not simply the one in the address bar, and that distinction is the whole reason this exists rather than a one-line regex in each mod.

At a cold start Slack restores the view before it settles the address. Measured with three workspaces signed in: `location.pathname` read `/client/T0BQ89Z4L4F/…` while the client had drawn thirty-seven avatars belonging to `T025V5WN2` and a conversation from it, and the two stayed apart until the user navigated by hand. Anything reading the URL then works against the workspace the user has *left* — the wrong token on every call, and a member list showing the one person that workspace admits to.

So the page is asked instead. An avatar URL carries the workspace it belongs to, which makes what Slack has drawn a witness the address bar is not. The URL is trusted whenever it can be, and overruled only when its workspace appears nowhere in the drawn avatars and another one does — the stale case, and nothing else.

Two workspaces can also use the same channel id, so compare this as well as the channel when you keep anything per-conversation.

```js
const team = api.slack.currentTeamId();
if (team !== lastSeenTeam) {
  lastSeenTeam = team;
  members.clear();   // a different workspace holds different people
}
```
