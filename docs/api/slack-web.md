---
name: web
group: slack
title: api.slack
signature: : WebApi
since: 2.0.1
preview: slack-web
control: user | select | U0EXAMPLE1 | user id | U0EXAMPLE1, U0EXAMPLE2, U0EXAMPLE3
---

Slack's own web API, as the signed-in user. `call(method, params)` reaches any method; `userInfo`, `users` (one batched request for a list, cached per workspace), `emoji` (the workspace's custom emoji), `presence`, `dndInfo`, `teamInfo` and `availability` (presence and do-not-disturb folded into one state) cover the common reads, and `available`, `teamDomain` and `selfId` describe the session.

The session token is read in one audited place and never handed back, and requests reach only Slack's own origin, so a mod never touches `localStorage` itself.

```js
const user = await api.slack.web.userInfo('U0EXAMPLE1');

// One request for a list, cached per workspace
const people = await api.slack.web.users(ids);

// Presence and do-not-disturb folded into one state
const state = await api.slack.web.availability('U0EXAMPLE1');
```
