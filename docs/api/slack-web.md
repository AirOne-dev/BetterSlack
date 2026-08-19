---
name: web
group: slack
title: api.slack
signature: : WebApi
---

Slack's own web API, as the signed-in user. Reads the session token in one
audited place so mods never touch localStorage themselves; requests can
only reach Slack's own origin. See src/runtime/web-api.ts.

```js
const user = await api.slack.web.userInfo('U0EXAMPLE1');

// One request for a list, cached per workspace
const people = await api.slack.web.users(ids);

// Presence and do-not-disturb folded into one state
const state = await api.slack.web.availability('U0EXAMPLE1');
```
