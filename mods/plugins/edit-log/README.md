# Edit Log

Keeps what a message said before it was edited or deleted, and leaves a deleted one in place instead of letting it vanish.

- A deleted message stays where it was, struck through and marked, with a cross to dismiss it. Slack simply removes it and leaves a gap you may not even notice.
- An edited message's earlier wording is kept, so "(edited)" stops being the end of the story.
- The log is a dialog on the channel header button, or `⌘K` → **Edit log**: who, where, when, and what changed, newest first. A badge on the button counts what has arrived since you last looked.
- Everything is on this machine, in BetterSlack's own settings file. Nothing is sent to Slack or to anywhere else, and the dialog empties it.

## What it can and cannot see

**It only knows what your client drew.** There is no history endpoint behind this and it makes no requests at all: it reads the messages on screen every second and a half and compares them with what they said last time. A message edited or deleted while you were in another channel was never on your screen, and is not in the log.

Telling a real change from Slack redrawing itself is the whole of the work, and three rules do it:

- **A message is not comparable the first time it is seen.** Other mods rewrite message text — Full Links replaces a truncated link's label with the whole URL moments after the message is drawn — so the text has to be read twice unchanged before a later difference counts as an edit.
- **A deletion is believed only when the messages either side of it are still on screen.** Slack's list is virtual: thirteen messages out of thousands are in the document, and scrolling drops some at one end. That is a gap with a missing neighbour; a deletion is a gap with both.
- **And only after two sweeps.** Slack re-renders constantly, and a message can leave the document and come back in the same second.

**It stands aside for Demo Mode.** While Demo Mode is on, every name and message on screen is an invented one; reading then would fill the log with words nobody wrote. Nothing is recorded until it is switched off.

## Settings

| | |
| --- | --- |
| **Leave deleted messages on screen** | The struck-through line where the message was. Off means the log still records them, quietly. |
| **Record deletions as well as edits** | Off keeps only edits. |
| **Entries to keep** | The cap. The log is in the settings file the loader reads at every launch, so it is not allowed to grow without limit. |

## It keeps other people's words

That is what it is for, and it is worth saying plainly rather than burying. The log holds text that somebody chose to take back. It never leaves your machine, the dialog empties it, and switching the mod off stops it — but the responsibility for what you do with it is yours, not the mod's.
