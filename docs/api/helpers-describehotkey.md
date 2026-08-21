---
name: describeHotkey
group: helpers
title: api.helpers
signature: (combo: string): string
since: 2.0.1
preview: helpers-describehotkey
control: combo | text | mod+shift+f
---

A combo as a person would read it: `mod` becomes ⌘ on a Mac and Ctrl elsewhere, and the modifiers come out in the order that platform writes them. For a tooltip or a menu subtitle.

```js
api.helpers.describeHotkey('mod+shift+k');
// '⌘⇧K' on a Mac, 'Ctrl+Shift+K' elsewhere
```
