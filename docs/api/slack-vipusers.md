---
name: vipUsers
group: slack
title: api.slack
signature: (): Promise<string[]>
---

The people marked VIP, in Slack's own order.

```js
const vips = await api.slack.vipUsers();   // ['U0EXAMPLE1', …]
```
