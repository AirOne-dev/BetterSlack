---
name: copy
group: helpers
title: api.helpers
signature: (text: string, message?: string): Promise<boolean>
preview: helpers-copy
control: text | text | https://example.com/releases/2026-08
---

Put text on the clipboard and confirm it with a toast, which is the pair almost every copy button wants. Resolves false if the clipboard refused.

```js
await api.helpers.copy(message.permalink, 'Link copied');
```
