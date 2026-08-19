---
name: palette
group: ui
title: api.ui
signature: (source: PaletteSource, labels: PaletteLabels): PaletteHandle
preview: ui-palette
---

The command palette, as a component.

The list is yours: this draws it, ranks it as you type, moves with the
arrow keys and closes on Escape. Nothing about what belongs in it is
decided here -- the mod that opens it decides, which is what lets one
plugin put Slack's own conversations and BetterSlack's actions in the
same list.

```js
api.ui.palette(
  (query) => rowsFor(query),
  { placeholder: 'Jump to…', empty: 'Nothing matches' },
);
```
