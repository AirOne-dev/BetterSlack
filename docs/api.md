# The plugin API

A plugin is an ES module that exports `start(api)`. Everything it registers is
undone when it is switched off.

Each entry has a page of its own in [`docs/api/`](api/), with its signature, what
it is for and an example. Most of them also run in a browser: the same list is at
**<https://airone-dev.github.io/BetterSlack/api.html>**, where you can change the
arguments and watch the result.

The format those files are written in is described in
[CLAUDE.md](../CLAUDE.md#the-api-documentation-format) — one file per entry, a
few keys at the top, prose, and one example.

Each entry names the release it arrived in. A mod needs the highest release
among the calls it makes, and an install older than that refuses it.

## Tools

- [`highlight · detect`](api/tools-highlight.md) — Code Highlight's two halves. Slack sends a code block as plain grey text with nothing saying what is in it, so the language is worked out from the code itself — and `detect` answers null when it is not confident, which leaves the block alone rather than colouring it as the wrong language. _(since 2.0.1)_
- [`renderMarkdown`](api/tools-markdown.md) — What the panel runs on a mod's README, and the reason a readme can be rendered at all: it escapes first and drops a `javascript:` URL, so nothing in a mod's markdown can execute. _(since 2.0.1)_
- [`derivePalette`](api/tools-roles.md) — Two colours in, the twelve roles a theme is written from out. This is what the theme builder runs before it writes a stylesheet, so a colour chosen here is a colour Slack would be painted with. _(since 2.0.1)_

## Component kit

- [`button`](api/kit-button.md) — Slack's button in its four weights: the default, primary for the one action that matters, ghost for the quiet one, and danger for the one that destroys something. _(since 2.0.1)_
- [`card`](api/kit-card.md) — A titled box with an optional subtitle and a row of actions, for grouping controls that belong together. _(since 2.0.1)_
- [`CHECKER`](api/kit-checker.md) — The checkerboard, as a CSS value. Put it behind a colour and a colour with alpha reads as translucent rather than as a slightly different flat colour. _(since 2.0.1)_
- [`code`](api/kit-code.md) — A CSS editor that colours what you type: a highlighted `<pre>` under a transparent `<textarea>`. Both have to agree on every metric or the caret drifts from the text, which is why their stylesheet lives beside the tokeniser rather than in each caller. _(since 2.0.1)_
- [`confirm`](api/kit-confirm.md) — A yes/no dialog that resolves to a boolean, so the caller reads as a question rather than a callback. _(since 2.0.1)_
- [`copyText`](api/kit-copytext.md) — Put text on the clipboard, and say whether it worked -- the clipboard can refuse. _(since 2.0.1)_
- [`el`](api/kit-el.md) — The maker every other primitive is built from: a tag, its attributes, and its children. _(since 2.0.1)_
- [`emptyState`](api/kit-emptystate.md) — What to draw when there is nothing to draw: a title, a sentence, and the one button that fixes it. _(since 2.0.1)_
- [`field`](api/kit-field.md) — A labelled control with an optional hint underneath, which is the shape almost every setting takes. _(since 2.0.1)_
- [`hoverable`](api/kit-hoverable.md) — Attach enter and leave handlers to an element without writing the pair of listeners each time. _(since 2.0.1)_
- [`iconButton`](api/kit-iconbutton.md) — A square button carrying a glyph rather than a word, for the places a label would not fit. _(since 2.0.1)_
- [`input`](api/kit-input.md) — A single-line text box wearing the kit's own focus ring. Any attribute you pass goes through to the element, so `type`, `placeholder` and `maxlength` all work. _(since 2.0.1)_
- [`popover`](api/kit-popover.md) — A floating panel anchored to an element, dismissed by a click outside. It returns a handle so it can be closed or repositioned from code. _(since 2.0.1)_
- [`segmented`](api/kit-segmented.md) — A row of mutually exclusive tabs, each able to carry a count. Returns a handle so the selection can be moved from code as well as by a click. _(since 2.0.1)_
- [`select`](api/kit-select.md) — A dropdown built from a list of options, with the current value and a change handler. _(since 2.0.1)_
- [`swatch`](api/kit-swatch.md) — A colour chip. Translucent colours are drawn over the checkerboard, so a colour with alpha reads as one. _(since 2.0.1)_

## api.helpers

- [`badge`](api/helpers-badge.md) — A small count or dot pinned to any element, kept in sync by a getter rather than by you remembering to redraw it. Return null from the getter and the badge goes away. _(since 2.0.1)_
- [`cache`](api/helpers-cache.md) — A cache that survives a restart and refreshes itself in the background. _(since 2.1.0)_
- [`copy`](api/helpers-copy.md) — Put text on the clipboard and confirm it with a toast, which is the pair almost every copy button wants. Resolves false if the clipboard refused. _(since 2.0.1)_
- [`debounce`](api/helpers-debounce.md) — Wrap a function so a burst of calls runs it once, `ms` after the last call, with that call's arguments. _(since 2.0.1)_
- [`describeHotkey`](api/helpers-describehotkey.md) — A combo as a person would read it: `mod` becomes ⌘ on a Mac and Ctrl elsewhere, and the modifiers come out in the order that platform writes them. For a tooltip or a menu subtitle. _(since 2.0.1)_
- [`disclosure`](api/helpers-disclosure.md) — Make something Slack already draws open and close — an "(edited)" label, a member count — so a mod with more to say puts it behind the label a reader would click rather than adding another toolbar button. _(since 3.2.0)_
- [`each`](api/helpers-each.md) — Run a handler for every element matching a selector, now and as more arrive, and undo it when the plugin stops. _(since 2.0.1)_
- [`field`](api/helpers-field.md) — A labelled row in Slack's own profile style, so a mod's extra details sit in a profile pane looking like the details Slack put there. _(since 2.0.1)_
- [`hotkey`](api/helpers-hotkey.md) — Bind a keyboard shortcut in the platform's idiom: `mod+shift+f`. _(since 2.0.1)_
- [`iconButton`](api/helpers-iconbutton.md) — An icon button wearing Slack's classes for the surface you name — the control strip, a header, the composer, a message's toolbar. The right classes are what keep it 28px instead of 36px. _(since 2.0.1)_
- [`mount`](api/helpers-mount.md) — Keep an element in a container across Slack's re-renders, and take it away when the plugin stops. `before` puts it above an existing button rather than at the end, which is where Slack's own re-renders land. _(since 2.0.1)_
- [`poll`](api/helpers-poll.md) — Run something every so often, and stop while nobody is looking. _(since 2.0.1)_
- [`section`](api/helpers-section.md) — A titled group of rows in Slack's profile style, for adding a block of detail to a pane Slack drew. _(since 2.0.1)_
- [`toggle`](api/helpers-toggle.md) — A persisted on/off flag that also puts a class on `<html>`, so the behaviour can be pure CSS. This is the shape most "mode" mods want. _(since 2.0.1)_
- [`tooltip`](api/helpers-tooltip.md) — Slack's tooltip on any element. Slack's own tooltips are React portals a mod cannot register with, so this builds one from Slack's classes, with Slack's ~150ms hover delay. _(since 2.0.1)_

## api.slack

- [`addMessageAction`](api/slack-addmessageaction.md) — A button in the toolbar Slack draws while the pointer is over a message. The handler is given the message: its channel, its timestamp, its permalink and its text. _(since 2.0.1)_
- [`addProfileButton`](api/slack-addprofilebutton.md) — A button in a member's profile pane, given the user id when it is pressed. It appears in anything wearing Slack's profile markup, including a pane another mod drew. _(since 2.0.1)_
- [`addToolbarButton`](api/slack-addtoolbarbutton.md) — Add a button to one of Slack's toolbars: _(since 2.0.1)_
- [`addView`](api/slack-addview.md) — A whole view of your own, with its tab in Slack's rail — everything Home, Direct messages and Activity do. The tab sits beside theirs wearing Slack's own classes, so it follows every theme; the page takes the whole tab panel, the channel sidebar included, because those views replace it too, and what is under it is hidden rather than covered — covered, Slack keeps the conversation on screen and marks anything arriving in it as read; the workspace rail is all that is left beside it; one tab is lit at a time, and clicking another of Slack's tabs leaves, exactly as leaving Activity does. `render` is called each time it opens, and `refresh()` runs it again in place. Use `tabSelector` to hang a `helpers.badge` on the tab rather than rebuilding the selector by hand. _(since 3.1.0)_
- [`avatarUrl`](api/slack-avatarurl.md) — The same avatar at another size. _(since 2.0.1)_
- [`composer`](api/slack-composer.md) — The message box. `insertText` types into it as though you had, `insertLink` puts a real hyperlink at the caret, and `focus` puts the caret there in the first place — every insert focuses first, so calling it yourself is only needed when you want the caret and nothing else. _(since 2.0.1)_
- [`currentChannelId`](api/slack-currentchannelid.md) — The conversation on screen: the channel of the messages Slack has drawn, or the conversation named in the address when none are drawn yet. Null when neither names one. _(since 2.0.1)_
- [`currentTeamId`](api/slack-currentteamid.md) — The workspace the client is showing, which is not always the one in the address bar. _(since 2.1.0)_
- [`describeMessage`](api/slack-describemessage.md) — Everything about a message that a mod usually wants, read off the element Slack drew: its channel, its timestamp, its permalink and its text. _(since 2.0.1)_
- [`describeStatus`](api/slack-describestatus.md) — Somebody's status, ready to draw: the sentence, the emoji name without its colons, an image for that emoji when one could be found, and when it clears. Null when there is no status at all, so a caller can test the result rather than three fields. _(since 2.1.0)_
- [`desktop`](api/slack-desktop.md) — Slack's own desktop preferences, the ones it keeps outside `app.asar`: a translucent window (`windowVibrancy`), GPU acceleration, the tray, the zoom level and a few more. `keys()` lists what may be set, with each key's type and whether it needs a restart. _(since 2.0.1)_
- [`emojiUrl`](api/slack-emojiurl.md) — An image for an emoji name, or `null` when nothing can draw it. The colons are optional — `tada` and `:tada:` are the same question. _(since 3.0.0)_
- [`events`](api/slack-events.md) — Slack keeps a socket per workspace and pushes everything that happens in every conversation you are in down it — a message, an edit, a deletion, a reaction, somebody's status, somebody joining — whether or not that conversation is open. It is how the unread badges in the sidebar move without you looking at them, and it is the only way for a mod to know about a conversation it is not in front of without asking Slack for it one at a time. _(since 3.2.0)_
- [`filesFrom`](api/slack-filesfrom.md) — The files somebody shared, newest first. `limit` caps how many come back; without one you get Slack's own default page, which is rarely what a panel wants to draw. _(since 2.0.1)_
- [`hideConversation`](api/slack-hideconversation.md) — Take a conversation out of the sidebar. The history is untouched — this is Slack's own hide, not a leave. _(since 2.0.1)_
- [`onTeamChange`](api/slack-onteamchange.md) — Switching workspace does not reload the client. Same page, same mods, same api objects, new team id in the address — so anything a mod cached belongs to the workspace the user has just left, and a mod that does not drop it goes quietly wrong rather than visibly broken: a member list of people who are not there, a status from somewhere else, a channel name on the wrong conversation. _(since 3.2.0)_
- [`openConversation`](api/slack-openconversation.md) — Move the client to a conversation without a page load. _(since 2.0.1)_
- [`openDirectMessage`](api/slack-opendirectmessage.md) — Open the direct message with someone, creating it if there is none. _(since 2.0.1)_
- [`openMessage`](api/slack-openmessage.md) — Move the client to one message and highlight it, the way Slack's own search results do. It is `openConversation`'s deep link with the message's timestamp on it. _(since 3.0.0)_
- [`openStatusEditor`](api/slack-openstatuseditor.md) — Slack's own "set a status" dialog. There is no deep link for it and no action a mod can dispatch: the entry lives in the account menu, so this opens the menu and then presses it. _(since 2.1.0)_
- [`openUserProfile`](api/slack-openuserprofile.md) — Open somebody's profile, through Slack's own deep link — same document, no reload. Not every id has one: an app, or a conversation with yourself, gives a pane that never appears. _(since 2.0.1)_
- [`renderMrkdwn`](api/slack-rendermrkdwn.md) — What Slack's API answers with is not what Slack draws. A mention arrives as `<@U04ED8UPV>`, a link as `<https://…|label>`, an ampersand as `&amp;`, and emphasis as the asterisks somebody typed — so anything showing a message as it came off the wire shows the wire. _(since 3.2.0)_
- [`restart`](api/slack-restart.md) — Stop Slack and start it again, with the loader still driving. _(since 2.0.1)_
- [`selectors`](api/slack-selectors.md) — The Slack selectors BetterSlack keeps working, for a mod that needs to go past these helpers. They are anchored on `data-qa` attributes rather than class names, which change with Slack releases. Read one from here rather than writing your own copy, so it is updated along with BetterSlack. _(since 2.0.1)_
- [`setVip`](api/slack-setvip.md) — Add or remove someone from your VIP list, and report the new state. _(since 2.0.1)_
- [`startHuddle`](api/slack-starthuddle.md) — Start a huddle with someone: open the conversation, then press Slack's own start control in the channel header. _(since 2.0.1)_
- [`statusNode`](api/slack-statusnode.md) — A status as a node: an image when the emoji resolved, the unicode character when Slack sent one, and the sentence beside it. Its stylesheet ships with the runtime, so every mod that shows a status draws the same thing. _(since 2.1.0)_
- [`userIdFromMessage`](api/slack-useridfrommessage.md) — The author's id, read off the avatar's URL — Slack writes them as `<team>-<user>-<hash>-<size>`. Null when the message has no avatar to read, which is the case for a consecutive message from the same person. _(since 2.0.1)_
- [`vipUsers`](api/slack-vipusers.md) — The workspace's VIP list. VIP is a preference rather than an endpoint: a comma-separated list under `vip_users`. _(since 2.0.1)_
- [`web`](api/slack-web.md) — Slack's own web API, as the signed-in user. `call(method, params)` reaches any method; `userInfo`, `users` (one batched request for a list, cached per workspace), `emoji` (the workspace's custom emoji), `presence`, `dndInfo`, `teamInfo` and `availability` (presence and do-not-disturb folded into one state) cover the common reads, and `available`, `teamDomain` and `selfId` describe the session. _(since 2.0.1)_

## api.ui

- [`confirm`](api/ui-confirm.md) — A yes/no dialog that resolves to a boolean, so a destructive action reads as a question in the code rather than as a pair of callbacks. _(since 2.0.1)_
- [`kit`](api/ui-kit.md) — Slack's design system, as components, bound to a document. _(since 2.0.1)_
- [`kitCss`](api/ui-kitcss.md) — The kit's stylesheet, as text, for the document a mod opened. A window a mod opens is blank — no Slack stylesheet to borrow — so this is what makes the primitives look like anything. _(since 2.0.1)_
- [`menu`](api/ui-menu.md) — Slack's overflow menu, against an anchor you give it. _(since 2.0.1)_
- [`modal`](api/ui-modal.md) — A dialog wearing Slack's own `c-dialog` classes, so it follows every theme without BetterSlack owning a second design system. Returns a handle, so it can be updated or closed from outside the callback that opened it. _(since 2.0.1)_
- [`palette`](api/ui-palette.md) — The command palette, as a component. _(since 2.0.1)_
- [`toast`](api/ui-toast.md) — A short confirmation in the corner, with an optional action. Toasts live in a shadow root rather than the light DOM: Slack has no toast to borrow from, and an unreadable error message is worse than an off-brand one. _(since 2.0.1)_
- [`tooltip`](api/ui-tooltip.md) — The lower-level tooltip, when you need to say where it goes. `helpers.tooltip` is the two-argument form for the common case. _(since 2.0.1)_

## api.dom

- [`h`](api/dom-h.md) — Build an element: a tag, its attributes, its children. Strings become text nodes. _(since 2.0.1)_
- [`keepMounted`](api/dom-keepmounted.md) — Keep an element in a container, putting it back whenever Slack re-renders that container away. It gives up after 25 remounts in two seconds rather than looping. _(since 2.0.1)_
- [`onEach`](api/dom-oneach.md) — Run a handler for every element matching a selector, now and as more arrive. _(since 2.0.1)_
- [`onShortcut`](api/dom-onshortcut.md) — The low-level key listener. Prefer helpers.hotkey, which takes a combo string and handles the platform. _(since 2.0.1)_
- [`waitFor`](api/dom-waitfor.md) — Wait for an element to appear, up to a timeout. It resolves null rather than throwing, so a mod that starts before Slack has drawn can say so. _(since 2.0.1)_

## api.i18n

- [`language`](api/i18n-language.md) — The language on its own, without the region: `fr` for `fr-FR`. What a translation table is usually keyed by. _(since 2.0.1)_
- [`locale`](api/i18n-locale.md) — The app's language tag, e.g. "fr-FR". Use it for `toLocaleString` and friends. _(since 2.0.1)_
- [`strings`](api/i18n-strings.md) — Build a translator from a table per language. It returns `t(key, vars)`, where `{count}`-style placeholders are filled from the second argument. _(since 2.0.1)_

## api.settings

- [`all`](api/settings-all.md) — Everything this mod has stored, as one object — for a settings screen that draws them all rather than asking for each. _(since 2.0.1)_
- [`get`](api/settings-get.md) — Read one of this mod's settings. When the user has not set it, the default declared in `mod.json` is returned, then `fallback`. Synchronous: the values arrive with the plugin. _(since 2.0.1)_
- [`onChange`](api/settings-onchange.md) — Called when the panel changes one of this mod's settings. _(since 2.0.1)_
- [`set`](api/settings-set.md) — Write one of this mod's settings. The loader owns the file, so it survives a restart and an update. _(since 2.0.1)_

## api.commands

- [`add`](api/commands-add.md) — Publish something this mod can do, so it is findable by typing rather than by hunting for a button. _(since 2.0.1)_

## api.files

- [`save`](api/files-save.md) — Fetch a URL and save it to the download folder. The renderer cannot do this for Slack's CDN, which serves without CORS headers. _(since 2.0.1)_
- [`screenshot`](api/files-screenshot.md) — Photograph the Slack window and put the picture in the download folder. _(since 2.0.1)_

## api.data

- [`list`](api/data-list.md) — Every file this mod has kept, by name, with its size and when it was last written. Only this mod's: another mod's folder is not reachable from here. _(since 3.4.0)_
- [`read`](api/data-read.md) — A file this mod kept, as a Blob typed from its extension, or null when there is none by that name. Typed, so an `<audio>` or an `<img>` can use it straight away through an object URL. _(since 3.4.0)_
- [`remove`](api/data-remove.md) — Delete a file this mod kept. Answers true if there was one to delete, so asking twice is harmless. _(since 3.4.0)_
- [`write`](api/data-write.md) — Keep a file of this mod's own, on disk, across restarts and updates: a sound somebody picked, a picture, an export. It goes under `~/.betterslack/data/<mod id>/`, which no other mod can name; the name is reduced to a safe basename, at most 8 MB a file and 64 MB a mod. A file of the same name is replaced. Nothing is deleted when the mod is switched off or removed. _(since 3.4.0)_

## api.net

- [`request`](api/net-request.md) — One request to a server that sends no CORS headers, made by the loader, since _(unreleased)_

## api.assets

- [`list`](api/assets-list.md) — Every readable file in the mod's own folder, folder-relative and forward-slashed — the same strings you would import. _(since 2.0.1)_
- [`text`](api/assets-text.md) — One of the mod's own files, as text. This is what lets a plugin keep its stylesheet in a real `.css` file, with an editor that highlights it, instead of a template literal. _(since 2.0.1)_

## api.themes

- [`list`](api/themes-list.md) — The themes the user has, with whether each is on, for a tool that builds on top of them. _(since 2.0.1)_
- [`source`](api/themes-source.md) — One theme's stylesheet as text, so a builder can start from it rather than from nothing. _(since 2.0.1)_
- [`suspend`](api/themes-suspend.md) — Hold every enabled theme back, or let them through again. _(since 2.0.1)_

## api.app

- [`commands`](api/app-commands.md) — What every other mod has registered, so a palette can offer all of them rather than only its own. _(since 2.0.1)_
- [`mods`](api/app-mods.md) — The catalogue as the panel sees it: what is installed, what is enabled, and how many settings each one declares. _(since 2.0.1)_
- [`openMod`](api/app-openmod.md) — Open the panel on one mod, with its settings unfolded. _(since 2.0.1)_
- [`openPanel`](api/app-openpanel.md) — Open the Mods panel, optionally on a particular tab. With no argument it opens wherever it was left. _(since 2.0.1)_
- [`setEnabled`](api/app-setenabled.md) — Switch a mod on or off, exactly as the panel's own toggle does — including writing it to the settings file. _(since 2.0.1)_
- [`setInstalled`](api/app-setinstalled.md) — Install a mod into the user's own folder, or remove it. Installing is what the Browse shelf does. _(since 2.0.1)_

## api.log

- [`error`](api/log-error.md) — The same, at error level. The loader forwards these to its terminal whatever the verbosity, because an error at boot is the one line you need. _(since 2.0.1)_
- [`info`](api/log-info.md) — Write a line to the console, prefixed with this mod's id. The loader forwards it to the terminal, which is where a mod that failed at boot says so. _(since 2.0.1)_
- [`warn`](api/log-warn.md) — The same, at warning level. The loader forwards these even without BETTERSLACK_VERBOSE. _(since 2.0.1)_

## On the api object

- [`css`](api/plugin-css.md) — This plugin's stylesheet, replaced wholesale on each call. That is the contract: a mod that recomputed its CSS on every settings change would otherwise stack copies of it for ever. The helpers write through a node of their own, so using both is safe. _(since 2.0.1)_
- [`id`](api/plugin-id.md) — This mod's id: its folder name, the key its settings are stored under, and the prefix on everything it puts in the DOM. _(since 2.0.1)_
- [`manifest`](api/plugin-manifest.md) — This mod's own `mod.json`, as the loader parsed it — its version, its author, the settings it declares. _(since 2.0.1)_
- [`onDispose`](api/plugin-ondispose.md) — Register a teardown callback. It runs when the plugin is switched off, which is the moment everything a mod started has to stop: intervals, listeners, anything it put on the page. _(since 2.0.1)_
- [`saveTheme`](api/plugin-savetheme.md) — Write a theme into the user's own mods folder, where it appears in the panel like any other and survives a restart. _(since 2.0.1)_
- [`version`](api/plugin-version.md) — BetterSlack's version, not the mod's — the mod's is `api.manifest.version`. _(since 2.0.1)_
