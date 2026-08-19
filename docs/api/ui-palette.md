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

Because it fetches nothing, it cannot know when you are still fetching — and
"nothing matches" is a different answer from "still looking". Tell it with
`setBusy` on the handle, and give it a `searching` label to show: an empty list
then says it is waiting rather than that it found nothing. Waiting starts at the
keystroke, not when the request goes out; a debounce in front of a search is
part of the wait.

```js
const palette = api.ui.palette(
  (query) => {
    directory.search(query);              // debounced, answers later
    palette.setBusy(directory.searching);  // includes the debounce
    return rowsFor(query);                 // whatever is already known
  },
  {
    placeholder: 'Jump to…',
    empty: 'Nothing matches',
    searching: 'searching…',
  },
);

// When the slow half lands, clear it and paint again.
directory.onResults(() => {
  palette.setBusy(false);
  palette.refresh();
});
```
