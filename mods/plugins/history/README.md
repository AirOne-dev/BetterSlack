# History

Everything Slack changes and never tells you about — edits, deletions, reactions taken back, renames, statuses, arrivals and departures — on one page you can search and sort.

A button in the left rail, next to your avatar, or `⌘⇧H`, or `⌘K` → **History**. A badge on it counts what has arrived since you last looked.

## What it keeps

| | |
| --- | --- |
| **Messages** | A message rewritten, with both wordings. A message deleted, with what it said — and the message left where it was, struck through, instead of the gap closing over it. |
| **Reactions** | A reaction added or taken back, with the emoji and the count before and after. |
| **Names** | A channel renamed, a sidebar section renamed, somebody changing their display name. Slack says nothing about any of the three. |
| **People** | Somebody joining or leaving a conversation, and people's statuses as they change. |

The page has a search that runs over everything a row draws — a name finds it whether it was the person, the channel, or the word that changed — filters by family, and five sorts. Each row offers the old text to copy, and takes you to the message where there is still one to land on.

## What it can and cannot see

**It only knows what your client drew.** There is no history endpoint behind this. It reads the screen every second and a half and compares it with what it read last time, so something that changed while you were in another channel was never on your screen and is not here.

Telling a real change from Slack redrawing itself is the whole of the work, and three rules do it:

- **Nothing is comparable the first time it is seen.** Other mods rewrite what is on screen — Full Links replaces a truncated link's label with the whole URL moments after a message is drawn — so a reading has to be repeated unchanged before a later difference counts.
- **A deletion is a gap with both neighbours still on screen.** Slack's message list is virtual: thirteen messages out of thousands are in the document, and scrolling drops some at one end. That is a gap with a missing neighbour; a deletion is a gap with both.
- **And only after two sweeps**, because Slack re-renders constantly and a message can leave the document and come back in the same second.

**It does not claim to know who reacted.** Slack says that only in a tooltip it builds when you hover, in the reader's language and with names rather than ids. The emoji and the count are what can be known honestly, so that is what is recorded.

**A join is a difference between two member lists**, not a notice parsed out of a sentence. Slack does draw "X joined", then folds it away and eventually stops showing it — and the wording depends on the reader's language.

**A display name comes from `users.info`, not from the screen.** Measured in a live client: `[data-qa="message_sender"]` holds the name twice on some messages — "Ada LovelaceAda Lovelace :" — and once on others, so comparing what is drawn reports a rename every few seconds from somebody who changed nothing. What Slack's own client believes somebody is called is the thing that actually changes.

**It stands aside for Demo Mode.** While Demo Mode is on, every name and message on screen is invented; reading then would fill the log with words nobody wrote. Nothing is recorded until it is switched off, and Demo Mode sweeps this mod's own text so a real sentence cannot ride into a screenshot inside a headstone.

## Requests, and where the log lives

The log is in `~/.betterslack/settings.json` under this plugin, capped by a setting, and the page empties it. Nothing is sent to Slack or anywhere else.

The only requests it makes are the ones it cannot avoid: the member list of the channel you are in, and the statuses of people you have seen, both every five minutes and both switchable off. Turning names into names uses `api.slack.web`, which is cached per workspace.

## Settings

| | |
| --- | --- |
| **Leave deleted messages on screen** | The struck-through line where the message was. Off means it is still recorded, quietly. |
| **Watch statuses and who is in a channel** | The only part that makes requests. Off leaves everything else running. |
| **Entries to keep** | The cap. The log is in the settings file the loader reads at every launch, so it is not allowed to grow without limit. |
| **Shortcut** | Opens and closes the page. `mod+shift+h` by default. |

## It keeps other people's words

That is what it is for, and it is worth saying plainly rather than burying. The log holds text and names that somebody chose to change or take back. It never leaves your machine, the page empties it, and switching the mod off stops it — but the responsibility for what you do with it is yours, not the mod's.
