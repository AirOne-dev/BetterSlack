# History

Everything Slack changes and never tells you about — edits, deletions, reactions taken back, renames, statuses, arrivals and departures — on one page you can search and sort.

A tab in Slack's rail, under Home and Activity, or `⌘⇧H`, or `⌘K` → **History**. A badge on it counts what has arrived since you last looked. It is a view like Slack's own: it takes the whole panel, channel list included, and you leave it by going somewhere else. The conversation you were in is hidden rather than covered, so a message arriving in it while you are reading your history stays unread.

## What it keeps

| | |
| --- | --- |
| **Messages** | A message rewritten, with both wordings. A message deleted, with what it said — and the message left where it was, struck through, with whose it was beside it, instead of the gap closing over it. Where it was is worked out from the timestamps of what is on screen each time it is drawn, so it lands in the right place even when the conversation has moved on. |
| **Reactions** | A reaction added or taken back, with the emoji and the person who did it. |
| **Names** | A channel renamed, a sidebar section renamed, somebody changing their display name. Slack says nothing about any of the three. A section is told apart by Slack's own id for it, so reordering the sidebar — or switching workspace — is not a rename. |
| **People** | Somebody joining or leaving a conversation, and people's statuses as they change. |

Each card can be forgotten on its own, beside the button that empties the lot. The page has a search that runs over everything a row draws — a name finds it whether it was the person, the channel, or the word that changed — filters by family, and five sorts. Each row offers the old text to copy, and takes you to the message where there is still one to land on. And an edited message answers for itself: Slack's own **(edited)** becomes the control, and clicking it unfolds what the message used to say under the message — not what it says now, which is the message itself an inch above. The caret and the unfold move if Motion is installed, and do not if it is not. Slack already marks the message and already puts the mark where the question is asked — it just does not answer it. Only where there is something to show: Slack marks every edit, including ones made before this was installed, and those labels are left exactly as Slack drew them.

## What it can and cannot see

**It listens to Slack's own socket, and it works in conversations you never open.** Slack keeps a socket per workspace and pushes everything that happens in every conversation you are in down it — a message, an edit, a deletion, a reaction, somebody's name or status changing, somebody joining — whether or not that conversation is open. It is how the unread badges in the sidebar move without you looking. That is where nearly everything here now comes from, and it is why a message edited in a channel you have not opened in a month is in this list.

**Nothing is marked read by any of it.** Slack marks a conversation read when its client sends `conversations.mark`; being told that a message exists sends nothing at all. Watching every conversation leaves every unread exactly where it was — which is the difference between this and the obvious alternative of opening conversations to look at them.

**It also reads the screen, and asks Slack once per channel you open.** The screen is what catches a change as it happens, second by second. Opening a channel also asks `conversations.history` for its last sixty messages and compares them with what the channel looked like when you left it — so an edit, a deletion or a reaction taken back while you were somewhere else is caught the moment you come back. The first visit to a channel is the baseline and never an event, and a message older than that page is outside the window rather than deleted.

That second half is also the only place **who** reacted can be known: Slack hands over the ids there, while on screen it says so only in a tooltip built on hover, in the reader's language, with names rather than ids.

**What the screen is still read for is the sidebar's section names.** Slack pushes messages, edits, deletions, reactions, renames and people down its socket; it says nothing about the sections *you* made in your own sidebar, because they are yours and no other client has them.

Nothing else is inferred from the screen any more, and the reason is worth stating: **editing a message takes it out of the document.** Slack replaces it with an editor while you type, so working a deletion out from "the message left the window" wrote your own edit down as your own deletion — and typing takes longer than any amount of waiting. Slack's socket says which of the two happened, and the catch-up covers what the socket missed.

**What an app does to its own messages is not kept.** A deploy status moving through its stages, an alert resolving, a bot rewriting the same line six times a minute: every one of those is an edit, and none of them is somebody taking something back. They also arrive far faster than anything a person does, so a log that keeps them is a log with nothing else visible in it. Only the app's *own* changes — a person reacting to an alert is still a person, and the message arriving in the first place was never an event here. **Keep what apps change about their own messages** turns it back on.

**A reaction is named or it is not recorded.** Watching the screen can see a count move and nothing more — Slack says who reacted only in a tooltip it builds when you hover, in the reader's language and with names rather than ids. So a count moving is not written down: it is what sends this to ask `conversations.history`, which does hand over the ids, and the row is written from that answer with the person on it. "Somebody took a reaction back" answers the only question it raises with a shrug, and a history that cannot say who is no use as a history.

The one case that leaves nothing at all is a reaction with a great many people on it, where Slack truncates the list of ids and the count is all that moved. That is a reaction still sitting on the message for anyone who wants to count it, so silence is the better half of the trade.

**A message is drawn the way Slack draws it.** What `conversations.history` answers with is not what Slack shows: a mention arrives as `<@U04ED8UPV>`, a link as `<https://…|https://…>`, an ampersand as `&amp;`, and emphasis as the asterisks somebody typed. Left alone, a log of messages is a log of wire format. The renderer is the runtime's — the command palette draws its search results with the same one — so a mention is a name, a channel is a name you can click, and a link is its label.

**And the line left in the conversation wears Slack's own message markup.** Not for convenience: a theme styles the client through those class names, so anything drawn inside a conversation with markup of its own is the one thing on screen a theme cannot reach. Discord rounds every avatar through `.c-message_kit__avatar img`, and a square face in a column of circles reads as broken rather than as a mod. Slack's `data-qa` is deliberately not copied — that is what every mod here matches messages on, this one included.

**Emoji are drawn, not spelled.** A shortcode cannot be turned into a picture from its name: Slack serves a standard emoji by codepoint, so `slightly_smiling_face` builds no URL, and `emoji.list` answers with the workspace's custom ones only. Slack's own screen is the table nobody publishes — every emoji it draws is an image carrying its name — so the pairs are collected as you use Slack and kept. An emoji you have seen once is one this can draw for ever after, in a message's text and on a reaction alike.

The table fills itself, so an emoji you have never seen in this client shows as its shortcode the first time and as itself from then on. On a reaction row, where the emoji is the whole content, one that cannot be drawn is left out rather than spelled, and the name goes in the row's tooltip.

**A join is a difference between two member lists**, not a notice parsed out of a sentence. Slack does draw "X joined", then folds it away and eventually stops showing it — and the wording depends on the reader's language.

**A display name comes from `users.info`, not from the screen.** Measured in a live client: `[data-qa="message_sender"]` holds the name twice on some messages — "Ada LovelaceAda Lovelace :" — and once on others, so comparing what is drawn reports a rename every few seconds from somebody who changed nothing. What Slack's own client believes somebody is called is the thing that actually changes.

**It stands aside for Demo Mode.** While Demo Mode is on, every name and message on screen is invented; reading then would fill the log with words nobody wrote. Nothing is recorded until it is switched off, and Demo Mode sweeps this mod's own text so a real sentence cannot ride into a screenshot inside a headstone.

## Requests, and where the log lives

The log is in `~/.betterslack/settings.json` under this plugin, capped by a setting, and the page empties it. Nothing is sent to Slack or anywhere else.

The requests it makes are the ones it cannot avoid: one page of history per channel you open, the member list of the channel you are in, and the statuses of people you have seen — the last two every five minutes and both switchable off. Turning names into names uses `api.slack.web`, which is cached per workspace.

## Settings

| | |
| --- | --- |
| **Keep what apps change about their own messages** | Off by default: an app rewriting or removing its own message is not somebody taking something back. |
| **Leave deleted messages on screen** | The struck-through line where the message was. Off means it is still recorded, quietly. |
| **Watch statuses and who is in a channel** | The only part that makes requests. Off leaves everything else running. |
| **Entries to keep** | The cap. The log is in the settings file the loader reads at every launch, so it is not allowed to grow without limit. |
| **Shortcut** | Opens and closes the page. `mod+shift+h` by default. |

## It keeps other people's words

That is what it is for, and it is worth saying plainly rather than burying. The log holds text and names that somebody chose to change or take back. It never leaves your machine, the page empties it, and switching the mod off stops it — but the responsibility for what you do with it is yours, not the mod's.
