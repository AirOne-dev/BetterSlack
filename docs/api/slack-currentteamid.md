---
name: currentTeamId
group: slack
title: api.slack
signature: (): string | null
since: 2.1.0
preview: slack-currentteamid
---

The workspace the client is showing, which is not always the one in the address bar.

At a cold start Slack restores the view before it settles the address, so for a while the URL names the workspace the user left while the screen shows another, and anything reading the URL uses the wrong token on every call. An avatar URL carries the workspace it belongs to, so this trusts the URL unless its workspace appears nowhere in the drawn avatars and another one does — the stale case, and nothing else.

Two workspaces can use the same channel id, so key anything kept per conversation by this as well as by the channel.

```js
const team = api.slack.currentTeamId();
if (team !== lastSeenTeam) {
  lastSeenTeam = team;
  members.clear();   // a different workspace holds different people
}
```
