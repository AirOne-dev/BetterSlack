---
name: list
group: themes
title: api.themes
signature: (): Array<{ id: string; name: string; description: string; enabled: boolean }>
since: 2.0.1
preview: themes-list
---

The themes the user has, with whether each is on, for a tool that builds on top of them.

```js
for (const theme of api.themes.list()) {
  api.log.info(theme.name, theme.enabled ? 'on' : 'off');
}
```
