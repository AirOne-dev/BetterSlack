---
name: filesFrom
group: slack
title: api.slack
signature: (userId: string, limit?: number): Promise<Array<Record<string, unknown>>>
---

The files somebody shared, newest first. `limit` caps how many come back; without one you get Slack's own default page, which is rarely what a panel wants to draw.

```js
const files = await api.slack.filesFrom('U0EXAMPLE1', 20);
for (const file of files) api.log.info(file.name);
```
