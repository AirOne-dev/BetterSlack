# History

Everything Slack changes and never tells you about — edits, deletions, reactions taken back, renames, statuses, arrivals and departures — on one page you can search and sort.

A tab in Slack's rail, under Home and Activity, or `⌘⇧H`, or `⌘K` → **History**. A badge on it counts what has arrived since you last looked. It is a view like Slack's own: it takes the whole panel, channel list included, and you leave it by going somewhere else. The conversation you were in is hidden rather than covered, so a message arriving in it while you are reading your history stays unread.

## What it keeps

| | |
| --- | --- |
| **Messages** | A message rewritten, with both wordings. A message deleted, with what it said — and the message left where it was, struck through, instead of the gap closing over it. |
| **Reactions** | A reaction added or taken back, with the emoji and the count before and after. |
| **Names** | A channel renamed, a sidebar section renamed, somebody changing their display name. Slack says nothing about any of the three. |
| **People** | Somebody joining or leaving a conversation, and people's statuses as they change. |

The page has a search that runs over everything a row draws — a name finds it whether it was the person, the channel, or the word that changed — filters by family, and five sorts. Each row offers the old text to copy, and takes you to the message where there is still one to land on.

## What it can and cannot see

**It reads the screen, and it asks Slack once per channel you open.** The screen is what catches a change as it happens, second by second. Opening a channel also asks `conversations.history` for its last sixty messages and compares them with what the channel looked like when you left it — so an edit, a deletion or a reaction taken back while you were somewhere else is caught the moment you come back. The first visit to a channel is the baseline and never an event, and a message older than that page is outside the window rather than deleted.

That second half is also the only place **who** took a reaction back can be known: Slack hands over the ids there, while on screen it says so only in a tooltip built on hover, in the reader's language, with names rather than ids.

Telling a real change from Slack redrawing itself is the whole of the work, and three rules do it:

- **Nothing is comparable the first time it is seen.** Other mods rewrite what is on screen — Full Links replaces a truncated link's label with the whole URL moments after a message is drawn — so a reading has to be repeated unchanged before a later difference counts.
- **A deletion is a gap with both neighbours still on screen.** Slack's message list is virtual: thirteen messages out of thousands are in the document, and scrolling drops some at one end. That is a gap with a missing neighbour; a deletion is a gap with both.
- **And only after two sweeps**, because Slack re-renders constantly and a message can leave the document and come back in the same second.

**It does not claim to know who reacted.** Slack says that only in a tooltip it builds when you hover, in the reader's language and with names rather than ids. The emoji and the count are what can be known honestly, so that is what is recorded.

**The emoji is the picture Slack drew, not its name.** A reaction with a skin tone is two shortcodes run together and a custom emoji is a name only one workspace knows, so the image is kept beside the count. Where none can be drawn — an entry recorded before that, an emoji the workspace has dropped — nothing is drawn and the name is in the row's tooltip, because a shortcode in the middle of a row reads as a rendering that failed rather than as an emoji.

**A join is a difference between two member lists**, not a notice parsed out of a sentence. Slack does draw "X joined", then folds it away and eventually stops showing it — and the wording depends on the reader's language.

**A display name comes from `users.info`, not from the screen.** Measured in a live client: `[data-qa="message_sender"]` holds the name twice on some messages — "Ada LovelaceAda Lovelace :" — and once on others, so comparing what is drawn reports a rename every few seconds from somebody who changed nothing. What Slack's own client believes somebody is called is the thing that actually changes.

**It stands aside for Demo Mode.** While Demo Mode is on, every name and message on screen is invented; reading then would fill the log with words nobody wrote. Nothing is recorded until it is switched off, and Demo Mode sweeps this mod's own text so a real sentence cannot ride into a screenshot inside a headstone.

## Requests, and where the log lives

The log is in `~/.betterslack/settings.json` under this plugin, capped by a setting, and the page empties it. Nothing is sent to Slack or anywhere else.

The requests it makes are the ones it cannot avoid: one page of history per channel you open, the member list of the channel you are in, and the statuses of people you have seen — the last two every five minutes and both switchable off. Turning names into names uses `api.slack.web`, which is cached per workspace.

## Settings

| | |
| --- | --- |
| **Leave deleted messages on screen** | The struck-through line where the message was. Off means it is still recorded, quietly. |
| **Watch statuses and who is in a channel** | The only part that makes requests. Off leaves everything else running. |
| **Entries to keep** | The cap. The log is in the settings file the loader reads at every launch, so it is not allowed to grow without limit. |
| **Shortcut** | Opens and closes the page. `mod+shift+h` by default. |

## It keeps other people's words

That is what it is for, and it is worth saying plainly rather than burying. The log holds text and names that somebody chose to change or take back. It never leaves your machine, the page empties it, and switching the mod off stops it — but the responsibility for what you do with it is yours, not the mod's.
