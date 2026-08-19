---
name: filesFrom
group: slack
title: api.slack
signature: (userId: string, limit?: number): Promise<Array<Record<string, unknown>>>
preview: slack-filesfrom
control: user | select | U0EXAMPLE1 | user id | U0EXAMPLE1, U0EXAMPLE2, U0EXAMPLE3
control: limit | number | 2 | limit
---

The files somebody shared, newest first. `limit` caps how many come back; without one you get Slack's own default page, which is rarely what a panel wants to draw.

```js
const files = await api.slack.filesFrom('U0EXAMPLE1', 20);
for (const file of files) api.log.info(file.name);
```
