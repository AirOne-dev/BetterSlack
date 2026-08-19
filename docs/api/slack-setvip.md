---
name: setVip
group: slack
title: api.slack
signature: (userId: string, isVip: boolean): Promise<boolean>
preview: slack-setvip
control: vips | text | U0EXAMPLE1 | starting list
---

Add or remove someone from your VIP list, and report the new state.

VIP is a user preference, not an endpoint of its own: Slack keeps it in
`vip_users` as a comma-separated list. Read, edit, write -- which also
means two windows editing it at once can clobber each other, exactly as
they would in Slack itself.

```js
await api.slack.setVip('U0EXAMPLE1', true);
// VIP is a preference, not an endpoint: users.prefs.set, name=vip_users
```
