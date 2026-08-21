---
name: source
group: themes
title: api.themes
signature: (id: string): Promise<string>
since: 2.0.1
preview: themes-source
---

One theme's stylesheet as text, so a builder can start from it rather than from nothing.

```js
const css = await api.themes.source('midnight');
```
