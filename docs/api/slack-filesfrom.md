---
name: filesFrom
group: slack
title: api.slack
signature: (userId: string, limit?: number): Promise<Array<Record<string, unknown>>>
---

Files someone shared, newest first.

```js
const files = await api.slack.filesFrom('U0EXAMPLE1', 20);
for (const file of files) api.log.info(file.name);
```
