---
name: describeHotkey
group: helpers
title: api.helpers
signature: (combo: string): string
---

Human-readable form of a combo, for tooltips: ⌘⇧F or Ctrl+Shift+F.

```js
api.helpers.describeHotkey('mod+shift+k');
// '⌘⇧K' on a Mac, 'Ctrl+Shift+K' elsewhere
```
