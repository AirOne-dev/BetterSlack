---
name: copy
group: helpers
title: api.helpers
signature: (text: string, message?: string): Promise<boolean>
preview: helpers-copy
control: text | text | https://example.com/releases/2026-08
---

Copy text and confirm with a toast, the way three mods were doing by hand.

```js
await api.helpers.copy(message.permalink, 'Link copied');
```
