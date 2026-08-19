---
name: source
group: themes
title: api.themes
signature: (id: string): Promise<string>
---

One theme's stylesheet as text, so a builder can start from it rather than from nothing.

```js
const css = await api.themes.source('midnight');
```
