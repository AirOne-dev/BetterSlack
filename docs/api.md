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

## Component kit

- [`button`](api/kit-button.md) — Slack's button in its four weights: the default, primary for the one action that matters, ghost for the quiet one, and danger for the one that destroys something.
- [`card`](api/kit-card.md) — A titled box with an optional subtitle and a row of actions, for grouping controls that belong together.
- [`CHECKER`](api/kit-checker.md) — The checkerboard, so a translucent colour reads as translucent.
- [`code`](api/kit-code.md) — A CSS editor that colours what you type.
- [`confirm`](api/kit-confirm.md) — A yes/no dialog that resolves to a boolean, so the caller reads as a question rather than a callback.
- [`copyText`](api/kit-copytext.md) — Put text on the clipboard, and say whether it worked -- the clipboard can refuse.
- [`el`](api/kit-el.md) — The maker every other primitive is built from: a tag, its attributes, and its children.
- [`emptyState`](api/kit-emptystate.md) — What to draw when there is nothing to draw: a title, a sentence, and the one button that fixes it.
- [`field`](api/kit-field.md) — A labelled control with an optional hint underneath, which is the shape almost every setting takes.
- [`hoverable`](api/kit-hoverable.md) — Attach enter and leave handlers to an element without writing the pair of listeners each time.
- [`iconButton`](api/kit-iconbutton.md) — A square button carrying a glyph rather than a word, for the places a label would not fit.
- [`input`](api/kit-input.md) — A single-line text box, wearing the kit's own focus ring.
- [`popover`](api/kit-popover.md) — A floating panel anchored to an element, dismissed by a click outside. It returns a handle so it can be closed or repositioned from code.
- [`segmented`](api/kit-segmented.md) — A row of mutually exclusive tabs, each able to carry a count. Returns a handle so the selection can be moved from code as well as by a click.
- [`select`](api/kit-select.md) — A dropdown built from a list of options, with the current value and a change handler.
- [`swatch`](api/kit-swatch.md) — A colour chip. Translucent colours are drawn over the checkerboard, so a colour with alpha reads as one.

## api.helpers

- [`badge`](api/helpers-badge.md) — A small count/dot badge pinned to any element, kept in sync by a getter.
- [`copy`](api/helpers-copy.md) — Copy text and confirm with a toast, the way three mods were doing by hand.
- [`debounce`](api/helpers-debounce.md) — Debounce. No shipped mod calls this today -- the two that debounce
- [`describeHotkey`](api/helpers-describehotkey.md) — Human-readable form of a combo, for tooltips: ⌘⇧F or Ctrl+Shift+F.
- [`each`](api/helpers-each.md) — Run a handler for every element matching a selector, now and in future,
- [`field`](api/helpers-field.md) — A labelled row in Slack's profile/field style.
- [`hotkey`](api/helpers-hotkey.md) — Bind a keyboard shortcut in the platform's idiom: `mod+shift+f`.
- [`iconButton`](api/helpers-iconbutton.md) — Build an icon button wearing Slack's classes for a given surface.
- [`mount`](api/helpers-mount.md) — Keep an element mounted somewhere, surviving Slack's re-renders.
- [`poll`](api/helpers-poll.md) — Run something every so often, and stop while nobody is looking.
- [`section`](api/helpers-section.md) — A section with Slack's own header styling, for panes.
- [`toggle`](api/helpers-toggle.md) — A persisted on/off flag that also drives a class on <html>, so the whole
- [`tooltip`](api/helpers-tooltip.md) — Slack-styled tooltip on anything.

## api.slack

- [`addMessageAction`](api/slack-addmessageaction.md) — Add a button to the hover toolbar on messages.
- [`addProfileButton`](api/slack-addprofilebutton.md) — Add a button to the member profile pane.
- [`addToolbarButton`](api/slack-addtoolbarbutton.md) — Add a button to one of Slack's toolbars:
- [`avatarUrl`](api/slack-avatarurl.md) — The same avatar at another size.
- [`composer`](api/slack-composer.md) — The message composer.
- [`currentChannelId`](api/slack-currentchannelid.md) — The channel currently open, read from the client URL.
- [`describeMessage`](api/slack-describemessage.md) — Read channel, timestamp, permalink and text off a message element.
- [`desktop`](api/slack-desktop.md) — Slack's own translucent window, which it ships switched off.
- [`filesFrom`](api/slack-filesfrom.md) — Files someone shared, newest first.
- [`hideConversation`](api/slack-hideconversation.md) — Remove a conversation from the sidebar. The history is untouched.
- [`onProfilePane`](api/slack-onprofilepane.md) — Run a handler each time a member profile pane opens.
- [`openConversation`](api/slack-openconversation.md) — Move the client to a conversation, without a page load.
- [`openDirectMessage`](api/slack-opendirectmessage.md) — Open the direct message with someone, creating it if there is none.
- [`openUserProfile`](api/slack-openuserprofile.md) — Show someone's profile in Slack, through the same deep-link scheme.
- [`restart`](api/slack-restart.md) — Stop Slack and start it again, with the loader still driving.
- [`selectors`](api/slack-selectors.md) — Stable selectors, for mods that need to go beyond these helpers.
- [`setVip`](api/slack-setvip.md) — Add or remove someone from your VIP list, and report the new state.
- [`startHuddle`](api/slack-starthuddle.md) — Start a huddle with someone: open the conversation, then press Slack's own
- [`userIdFromMessage`](api/slack-useridfrommessage.md) — The author of a message, read from their avatar URL.
- [`vipUsers`](api/slack-vipusers.md) — The people marked VIP, in Slack's own order.
- [`web`](api/slack-web.md) — Slack's own web API, as the signed-in user. Reads the session token in one

## api.ui

- [`confirm`](api/ui-confirm.md) — Yes/no dialog; resolves false if dismissed.
- [`kit`](api/ui-kit.md) — Slack's design system, as components, bound to a document.
- [`kitCss`](api/ui-kitcss.md) — The kit's stylesheet. Put it in the document the kit is building in.
- [`menu`](api/ui-menu.md) — Slack's overflow menu, against an anchor you give it.
- [`modal`](api/ui-modal.md) — A dialog. Returns a handle so you can update or close it later.
- [`palette`](api/ui-palette.md) — The command palette, as a component.
- [`toast`](api/ui-toast.md) — Transient message at the bottom of the window.
- [`tooltip`](api/ui-tooltip.md) — Slack-style tooltip on any element you built yourself.

## api.dom

- [`h`](api/dom-h.md) — Build an element: a tag, its attributes, its children. Strings become text nodes.
- [`keepMounted`](api/dom-keepmounted.md) — Keep an element in a container, putting it back whenever Slack re-renders that container away. It gives up after 25 remounts in two seconds rather than looping.
- [`onEach`](api/dom-oneach.md) — Run a handler for every element matching a selector, now and as more arrive.
- [`onShortcut`](api/dom-onshortcut.md) — The low-level key listener. Prefer helpers.hotkey, which takes a combo string and handles the platform.
- [`waitFor`](api/dom-waitfor.md) — Wait for an element to appear, up to a timeout. It resolves null rather than throwing, so a mod that starts before Slack has drawn can say so.

## api.i18n

- [`language`](api/i18n-language.md) — Its primary subtag, e.g. "fr". This is what dictionaries are keyed by.
- [`locale`](api/i18n-locale.md) — The app's language tag, e.g. "fr-FR". Use it for toLocaleString and friends.
- [`strings`](api/i18n-strings.md) — Build a translator.

## api.settings

- [`all`](api/settings-all.md) — Everything this mod has stored, as one object.
- [`get`](api/settings-get.md) — Read one of this mod's settings, with a fallback for the first run.
- [`onChange`](api/settings-onchange.md) — Called when the panel changes one of the declared settings.
- [`set`](api/settings-set.md) — Write one of this mod's settings. The loader owns the file, so it survives a restart and an update.

## api.commands

- [`add`](api/commands-add.md) — Publish something this mod can do, so it is findable by typing rather than by hunting for a button.

## api.files

- [`save`](api/files-save.md) — Fetch a URL and save it to the download folder. The renderer cannot do this for Slack's CDN, which serves without CORS headers.
- [`screenshot`](api/files-screenshot.md) — Photograph the Slack window and put the picture in the download folder.

## api.assets

- [`list`](api/assets-list.md) — Every readable file in the folder.
- [`text`](api/assets-text.md) — One file's contents. Throws if the folder has no such file.

## api.themes

- [`list`](api/themes-list.md) — The themes the user has, with whether each is on.
- [`source`](api/themes-source.md) — One theme's stylesheet, as text.
- [`suspend`](api/themes-suspend.md) — Hold every enabled theme back, or let them through again.

## api.app

- [`commands`](api/app-commands.md) — What every other mod has registered, so a palette can show them all.
- [`mods`](api/app-mods.md) — Every mod in the catalogue, with what the user has done about it.
- [`openMod`](api/app-openmod.md) — Open the panel on one mod, with its settings unfolded.
- [`openPanel`](api/app-openpanel.md) — Open the Mods panel, optionally straight to a tab.
- [`setEnabled`](api/app-setenabled.md) — Switch a mod on or off, as the panel's own toggle does.
- [`setInstalled`](api/app-setinstalled.md) — Install or remove a mod from the user's own folder.

## api.log

- [`error`](api/log-error.md) — The same, at error level.
- [`info`](api/log-info.md) — Write a line to the console, prefixed with this mod's id. The loader forwards it to the terminal, which is where a mod that failed at boot says so.
- [`warn`](api/log-warn.md) — The same, at warning level. The loader forwards these even without BETTERSLACK_VERBOSE.

## On the api object

- [`css`](api/plugin-css.md) — Stylesheet owned by this plugin; replaced wholesale on each call.
- [`id`](api/plugin-id.md) — This mod's id: its folder name, and the key its settings are stored under.
- [`manifest`](api/plugin-manifest.md) — This mod's own mod.json, as the loader parsed it.
- [`onDispose`](api/plugin-ondispose.md) — Register a teardown callback; runs when the plugin is disabled.
- [`saveTheme`](api/plugin-savetheme.md) — Write a theme into the user's own mods folder, where it appears in the
- [`version`](api/plugin-version.md) — BetterSlack's version, not the mod's. The mod's is in api.manifest.version.
