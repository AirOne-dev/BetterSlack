---
name: list
group: themes
title: api.themes
signature: (): Array<{ id: string; name: string; description: string; enabled: boolean }>
---

The themes the user has, with whether each is on.

```js
for (const theme of api.themes.list()) {
  api.log.info(theme.name, theme.enabled ? 'on' : 'off');
}
```
