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

A row is a line of text by default, and sometimes that is a poor version of the
truth: a message search result had bold in it, a link with a label, an emoji.
`titleNode` and `subtitleNode` are factories that draw those halves instead —
factories rather than nodes, because the list is rebuilt on every keystroke and
one node cannot be in two rows. `title` stays required either way: it is what
the ranking sorts by and what a screen reader is given. Nothing drawn may be an
anchor — a row is a button, and a link inside one swallows the click that was
meant to open it.

A mode is a prefix that narrows the list — `/`, `@`, `#` — and it is reachable
two ways. Typing the prefix turns it into a chip in front of the field; so does
`setMode(id)` on the handle, which lets a row *be* the way in: "search the
messages for what you typed" is a result before it is a mode, and a palette that
can only be narrowed by somebody who already knows the punctuation is narrower
than it looks. A row that refines rather than arrives sets `keepOpen: true`, or
the palette closes under it. `setMode(null)` steps back out.

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

// A row that hands the query on to another mode rather than going anywhere.
{
  id: 'search-messages',
  title: `Search the messages for "${query}"`,
  keepOpen: true,
  run: () => palette.setMode('messages'),
}
```
