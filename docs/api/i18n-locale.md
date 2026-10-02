---
name: locale
group: i18n
title: api.i18n
signature: : string
since: 2.0.1
preview: i18n-locale
---

The app's language tag, e.g. "fr-FR". Use it for `toLocaleString` and friends.

It is read from Slack's `<html lang>`. Never read the language from `localConfig_v2`: that holds the session token, which a mod may not touch. For choosing a translation use `api.i18n.language`, the tag without the region, so a table keyed `fr` matches a client running `fr-CA`.

```js
api.i18n.locale;     // 'fr-FR' — read from Slack's <html lang>
```
