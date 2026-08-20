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

## Tools

- [`highlight · detect`](api/tools-highlight.md) — Code Highlight's two halves. Slack sends a code block as plain grey text with nothing saying what is in it, so the language is worked out from the code itself — and `detect` answers null when it is not confident, which leaves the block alone rather than colouring it as the wrong language.
- [`renderMarkdown`](api/tools-markdown.md) — What the panel runs on a mod's README, and the reason a readme can be rendered at all: it escapes first and drops a `javascript:` URL, so nothing in a mod's markdown can execute.
- [`derivePalette`](api/tools-roles.md) — Two colours in, the twelve roles a theme is written from out. This is what the theme builder runs before it writes a stylesheet, so a colour chosen here is a colour Slack would be painted with.

## Component kit

- [`button`](api/kit-button.md) — Slack's button in its four weights: the default, primary for the one action that matters, ghost for the quiet one, and danger for the one that destroys something.
- [`card`](api/kit-card.md) — A titled box with an optional subtitle and a row of actions, for grouping controls that belong together.
- [`CHECKER`](api/kit-checker.md) — The checkerboard, as a CSS value. Put it behind a colour and a colour with alpha reads as translucent rather than as a slightly different flat colour.
- [`code`](api/kit-code.md) — A CSS editor that colours what you type: a highlighted `<pre>` under a transparent `<textarea>`. Both have to agree on every metric or the caret drifts from the text, which is why their stylesheet lives beside the tokeniser rather than in each caller.
- [`confirm`](api/kit-confirm.md) — A yes/no dialog that resolves to a boolean, so the caller reads as a question rather than a callback.
- [`copyText`](api/kit-copytext.md) — Put text on the clipboard, and say whether it worked -- the clipboard can refuse.
- [`el`](api/kit-el.md) — The maker every other primitive is built from: a tag, its attributes, and its children.
- [`emptyState`](api/kit-emptystate.md) — What to draw when there is nothing to draw: a title, a sentence, and the one button that fixes it.
- [`field`](api/kit-field.md) — A labelled control with an optional hint underneath, which is the shape almost every setting takes.
- [`hoverable`](api/kit-hoverable.md) — Attach enter and leave handlers to an element without writing the pair of listeners each time.
- [`iconButton`](api/kit-iconbutton.md) — A square button carrying a glyph rather than a word, for the places a label would not fit.
- [`input`](api/kit-input.md) — A single-line text box wearing the kit's own focus ring. Any attribute you pass goes through to the element, so `type`, `placeholder` and `maxlength` all work.
- [`popover`](api/kit-popover.md) — A floating panel anchored to an element, dismissed by a click outside. It returns a handle so it can be closed or repositioned from code.
- [`segmented`](api/kit-segmented.md) — A row of mutually exclusive tabs, each able to carry a count. Returns a handle so the selection can be moved from code as well as by a click.
- [`select`](api/kit-select.md) — A dropdown built from a list of options, with the current value and a change handler.
- [`swatch`](api/kit-swatch.md) — A colour chip. Translucent colours are drawn over the checkerboard, so a colour with alpha reads as one.

## api.helpers

- [`badge`](api/helpers-badge.md) — A small count or dot pinned to any element, kept in sync by a getter rather than by you remembering to redraw it. Return null from the getter and the badge goes away.
- [`cache`](api/helpers-cache.md) — A cache that survives a restart and refreshes itself behind you.
- [`copy`](api/helpers-copy.md) — Put text on the clipboard and confirm it with a toast, which is the pair almost every copy button wants. Resolves false if the clipboard refused.
- [`debounce`](api/helpers-debounce.md) — Debounce. No shipped mod calls this today -- the two that debounce
- [`describeHotkey`](api/helpers-describehotkey.md) — A combo as a person would read it: `mod` becomes ⌘ on a Mac and Ctrl elsewhere, and the modifiers come out in the order that platform writes them. For a tooltip or a menu subtitle.
- [`each`](api/helpers-each.md) — Run a handler for every element matching a selector, now and in future,
- [`field`](api/helpers-field.md) — A labelled row in Slack's own profile style, so a mod's extra details sit in a profile pane looking like the details Slack put there.
- [`hotkey`](api/helpers-hotkey.md) — Bind a keyboard shortcut in the platform's idiom: `mod+shift+f`.
- [`iconButton`](api/helpers-iconbutton.md) — An icon button wearing Slack's classes for the surface you name — the control strip, a header, the composer. Getting the classes right is what keeps it 28px instead of 36px.
- [`mount`](api/helpers-mount.md) — Keep an element in a container across Slack's re-renders, and take it away when the plugin stops. `before` puts it above an existing button rather than at the end, which is where Slack's own re-renders land.
- [`poll`](api/helpers-poll.md) — Run something every so often, and stop while nobody is looking.
- [`section`](api/helpers-section.md) — A titled group of rows in Slack's profile style, for adding a block of detail to a pane Slack drew.
- [`toggle`](api/helpers-toggle.md) — A persisted on/off flag that also drives a class on <html>, so the whole
- [`tooltip`](api/helpers-tooltip.md) — Slack's tooltip on any element. Slack's own are React portals a mod cannot register with, so this rebuilds one from Slack's classes — including the ~150ms delay, measured with a real pointer.

## api.slack

- [`addMessageAction`](api/slack-addmessageaction.md) — A button in the toolbar Slack draws while the pointer is over a message. The handler is given the message: its channel, its timestamp, its permalink and its text.
- [`addProfileButton`](api/slack-addprofilebutton.md) — A button in a member's profile pane, given the user id when it is pressed. It appears in anything wearing Slack's profile markup, including a pane another mod drew.
- [`addToolbarButton`](api/slack-addtoolbarbutton.md) — Add a button to one of Slack's toolbars:
- [`avatarUrl`](api/slack-avatarurl.md) — The same avatar at another size.
- [`composer`](api/slack-composer.md) — The message box. `insertText` types into it as though you had, `insertLink` puts a real hyperlink at the caret, and `focus` puts the caret there in the first place — every insert focuses first, so calling it yourself is only needed when you want the caret and nothing else.
- [`currentChannelId`](api/slack-currentchannelid.md) — The channel on screen, read out of the URL. Null when what is on screen is not a conversation. Two workspaces can use the same channel id, so compare the team as well when you keep anything per-channel.
- [`currentTeamId`](api/slack-currentteamid.md) — The workspace the client is showing. Not simply the one in the address bar, and that distinction is the whole reason this exists rather than a one-line regex in each mod.
- [`describeMessage`](api/slack-describemessage.md) — Everything about a message that a mod usually wants, read off the element Slack drew: its channel, its timestamp, its permalink and its text.
- [`describeStatus`](api/slack-describestatus.md) — Somebody's status, ready to draw: the sentence, the emoji name without its colons, an image for that emoji when one could be found, and when it clears. Null when there is no status at all, so a caller can test the result rather than three fields.
- [`desktop`](api/slack-desktop.md) — Slack's own translucent window, which it ships switched off.
- [`filesFrom`](api/slack-filesfrom.md) — The files somebody shared, newest first. `limit` caps how many come back; without one you get Slack's own default page, which is rarely what a panel wants to draw.
- [`hideConversation`](api/slack-hideconversation.md) — Take a conversation out of the sidebar. The history is untouched — this is Slack's own hide, not a leave.
- [`onProfilePane`](api/slack-onprofilepane.md) — Run a handler each time a profile pane appears, with the pane and the user id it is showing. Mount per pane rather than once: a single mount fills whichever profile it reaches first and starves the other.
- [`openConversation`](api/slack-openconversation.md) — Move the client to a conversation, without a page load.
- [`openDirectMessage`](api/slack-opendirectmessage.md) — Open the direct message with someone, creating it if there is none.
- [`openMessage`](api/slack-openmessage.md) — Move the client to one message, and highlight it. The same deep link
- [`openStatusEditor`](api/slack-openstatuseditor.md) — Slack's own "set a status" dialog. There is no deep link for it and no action a mod can dispatch: the entry lives in the account menu, so this opens the menu and then presses it.
- [`openUserProfile`](api/slack-openuserprofile.md) — Open somebody's profile, through Slack's own deep link — same document, no reload. Not every id has one: an app, or a conversation with yourself, gives a pane that never appears.
- [`restart`](api/slack-restart.md) — Stop Slack and start it again, with the loader still driving.
- [`selectors`](api/slack-selectors.md) — The Slack selectors this project has measured and kept working, for a mod that needs to go past these helpers. Anchored on `data-qa` attributes rather than class names, which churn with every Slack release.
- [`setVip`](api/slack-setvip.md) — Add or remove someone from your VIP list, and report the new state.
- [`startHuddle`](api/slack-starthuddle.md) — Start a huddle with someone: open the conversation, then press Slack's own
- [`statusNode`](api/slack-statusnode.md) — That status as a node, so the two mods that show one draw the same thing. An image when an emoji resolved, the unicode character when Slack sent one, and the sentence beside it.
- [`userIdFromMessage`](api/slack-useridfrommessage.md) — The author's id, read off the avatar's URL — Slack writes them as `<team>-<user>-<hash>-<size>`. Null when the message has no avatar to read, which is the case for a consecutive message from the same person.
- [`vipUsers`](api/slack-vipusers.md) — The workspace's VIP list. VIP is a preference rather than an endpoint: a comma-separated list under `vip_users`.
- [`web`](api/slack-web.md) — Slack's own web API, as the signed-in user. Reads the session token in one

## api.ui

- [`confirm`](api/ui-confirm.md) — A yes/no dialog that resolves to a boolean, so a destructive action reads as a question in the code rather than as a pair of callbacks.
- [`kit`](api/ui-kit.md) — Slack's design system, as components, bound to a document.
- [`kitCss`](api/ui-kitcss.md) — The kit's stylesheet, as text, for the document a mod opened. A window a mod opens is blank — no Slack stylesheet to borrow — so this is what makes the primitives look like anything.
- [`menu`](api/ui-menu.md) — Slack's overflow menu, against an anchor you give it.
- [`modal`](api/ui-modal.md) — A dialog wearing Slack's own `c-dialog` classes, so it follows every theme without BetterSlack owning a second design system. Returns a handle, so it can be updated or closed from outside the callback that opened it.
- [`palette`](api/ui-palette.md) — The command palette, as a component.
- [`toast`](api/ui-toast.md) — A short confirmation in the corner, with an optional action. Toasts live in a shadow root rather than the light DOM: Slack has no toast to borrow from, and an unreadable error message is worse than an off-brand one.
- [`tooltip`](api/ui-tooltip.md) — The lower-level tooltip, when you need to say where it goes. `helpers.tooltip` is the two-argument form for the common case.

## api.dom

- [`h`](api/dom-h.md) — Build an element: a tag, its attributes, its children. Strings become text nodes.
- [`keepMounted`](api/dom-keepmounted.md) — Keep an element in a container, putting it back whenever Slack re-renders that container away. It gives up after 25 remounts in two seconds rather than looping.
- [`onEach`](api/dom-oneach.md) — Run a handler for every element matching a selector, now and as more arrive.
- [`onShortcut`](api/dom-onshortcut.md) — The low-level key listener. Prefer helpers.hotkey, which takes a combo string and handles the platform.
- [`waitFor`](api/dom-waitfor.md) — Wait for an element to appear, up to a timeout. It resolves null rather than throwing, so a mod that starts before Slack has drawn can say so.

## api.i18n

- [`language`](api/i18n-language.md) — The language on its own, without the region: `fr` for `fr-FR`. What a translation table is usually keyed by.
- [`locale`](api/i18n-locale.md) — The app's language tag, e.g. "fr-FR". Use it for `toLocaleString` and friends.
- [`strings`](api/i18n-strings.md) — Build a translator from a table per language. It returns a `t(key, vars)` where

## api.settings

- [`all`](api/settings-all.md) — Everything this mod has stored, as one object — for a settings screen that draws them all rather than asking for each.
- [`get`](api/settings-get.md) — Read one of this mod's settings, with a fallback for the first run. Synchronous: the values arrive with the plugin.
- [`onChange`](api/settings-onchange.md) — Called when the panel changes one of the declared settings.
- [`set`](api/settings-set.md) — Write one of this mod's settings. The loader owns the file, so it survives a restart and an update.

## api.commands

- [`add`](api/commands-add.md) — Publish something this mod can do, so it is findable by typing rather than by hunting for a button.

## api.files

- [`save`](api/files-save.md) — Fetch a URL and save it to the download folder. The renderer cannot do this for Slack's CDN, which serves without CORS headers.
- [`screenshot`](api/files-screenshot.md) — Photograph the Slack window and put the picture in the download folder.

## api.assets

- [`list`](api/assets-list.md) — Every readable file in the mod's own folder, folder-relative and forward-slashed — the same strings you would import.
- [`text`](api/assets-text.md) — One of the mod's own files, as text. This is what lets a plugin keep its stylesheet in a real `.css` file, with an editor that highlights it, instead of a template literal.

## api.themes

- [`list`](api/themes-list.md) — The themes the user has, with whether each is on, for a tool that builds on top of them.
- [`source`](api/themes-source.md) — One theme's stylesheet as text, so a builder can start from it rather than from nothing.
- [`suspend`](api/themes-suspend.md) — Hold every enabled theme back, or let them through again.

## api.app

- [`commands`](api/app-commands.md) — What every other mod has registered, so a palette can offer all of them rather than only its own.
- [`mods`](api/app-mods.md) — The catalogue as the panel sees it: what is installed, what is enabled, and how many settings each one declares.
- [`openMod`](api/app-openmod.md) — Open the panel on one mod, with its settings unfolded.
- [`openPanel`](api/app-openpanel.md) — Open the Mods panel, optionally on a particular tab. With no argument it opens wherever it was left.
- [`setEnabled`](api/app-setenabled.md) — Switch a mod on or off, exactly as the panel's own toggle does — including writing it to the settings file.
- [`setInstalled`](api/app-setinstalled.md) — Install a mod into the user's own folder, or remove it. Installing is what the Browse shelf does.

## api.log

- [`error`](api/log-error.md) — The same, at error level. The loader forwards these to its terminal whatever the verbosity, because an error at boot is the one line you need.
- [`info`](api/log-info.md) — Write a line to the console, prefixed with this mod's id. The loader forwards it to the terminal, which is where a mod that failed at boot says so.
- [`warn`](api/log-warn.md) — The same, at warning level. The loader forwards these even without BETTERSLACK_VERBOSE.

## On the api object

- [`css`](api/plugin-css.md) — This plugin's stylesheet, replaced wholesale on each call. That is the contract: a mod that recomputed its CSS on every settings change would otherwise stack copies of it for ever. The helpers write through a node of their own, so using both is safe.
- [`id`](api/plugin-id.md) — This mod's id: its folder name, the key its settings are stored under, and the prefix on everything it puts in the DOM.
- [`manifest`](api/plugin-manifest.md) — This mod's own `mod.json`, as the loader parsed it — its version, its author, the settings it declares.
- [`onDispose`](api/plugin-ondispose.md) — Register a teardown callback. It runs when the plugin is switched off, which is the moment everything a mod started has to stop: intervals, listeners, anything it put on the page.
- [`saveTheme`](api/plugin-savetheme.md) — Write a theme into the user's own mods folder, where it appears in the
- [`version`](api/plugin-version.md) — BetterSlack's version, not the mod's — the mod's is `api.manifest.version`.
