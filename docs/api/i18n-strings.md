---
name: strings
group: i18n
title: api.i18n
signature: <T extends Dictionary>(tables: Tables<T>): Translate<T>
preview: i18n-strings
control: locale | select | en-GB | locale | en-GB, fr-FR, de-DE
control: key | select | hello | key | hello, bye, missing
control: name | text | Ada
---

Build a translator from a table per language. It returns a `t(key, vars)` where
`{count}`-style placeholders are filled from the second argument.

Lookup goes exact locale first (`fr-CA`), then the language on its own (`fr`),
then English. English is required and is the fallback both for an unknown
language and for a key one table forgot — a key missing everywhere renders as
the key itself, never as a blank.

```js
const t = api.i18n.strings({
  en: { title: 'Channel notes', saved: '{count} notes saved' },
  fr: { title: 'Notes du canal', saved: '{count} notes enregistrées' },
});
t('saved', { count: 3 });
```
