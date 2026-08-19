---
name: source
group: themes
title: api.themes
signature: (id: string): Promise<string>
---

One theme's stylesheet, as text.

```js
const css = await api.themes.source('midnight');
```
