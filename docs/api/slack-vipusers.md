---
name: vipUsers
group: slack
title: api.slack
signature: (): Promise<string[]>
preview: slack-vipusers
control: pref | text | U0EXAMPLE1,U0EXAMPLE3 | vip_users
---

The workspace's VIP list. VIP is a preference rather than an endpoint: a comma-separated list under `vip_users`.

```js
const vips = await api.slack.vipUsers();   // ['U0EXAMPLE1', …]
```
