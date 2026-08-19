---
name: vipUsers
group: slack
title: api.slack
signature: (): Promise<string[]>
---

The workspace's VIP list. VIP is a preference rather than an endpoint: a comma-separated list under `vip_users`.

```js
const vips = await api.slack.vipUsers();   // ['U0EXAMPLE1', …]
```
