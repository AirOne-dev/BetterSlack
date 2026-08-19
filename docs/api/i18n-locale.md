---
name: locale
group: i18n
title: api.i18n
signature: : string
preview: i18n-locale
---

The app's language tag, e.g. "fr-FR". Use it for `toLocaleString` and friends.

It is read from Slack's `<html lang>`, never from `localConfig_v2` — that is the
token file, and only `web-api.ts` may touch it. For choosing a translation use
`api.i18n.language`, which is the tag without the region: a table keyed `fr`
should match a client running `fr-CA`.

```js
api.i18n.locale;     // 'fr-FR' — read from Slack's <html lang>
```
