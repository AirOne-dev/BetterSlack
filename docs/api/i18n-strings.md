---
name: strings
group: i18n
title: api.i18n
signature: <T extends Dictionary>(tables: Tables<T>): Translate<T>
preview: i18n-strings
control: locale | select | en-GB |  | en-GB, fr-FR, de-DE
control: key | select | hello |  | hello, bye, missing
control: name | text | Ada
---

Build a translator.

  const t = api.i18n.strings({
    en: { members: 'Members', online: '{count} online' },
    fr: { members: 'Membres', online: '{count} en ligne' },
  });
  t('online', { count: 3 });

Lookup goes exact locale ("fr-CA"), then language ("fr"), then English.

```js
const t = api.i18n.strings({
  en: { title: 'Channel notes', saved: '{count} notes saved' },
  fr: { title: 'Notes du canal', saved: '{count} notes enregistrées' },
});
t('saved', { count: 3 });
```
