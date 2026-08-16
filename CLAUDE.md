# CLAUDE.md

Notes for an agent working in this repository. Everything here was measured
against a live Slack, not assumed; re-measure before contradicting it.

## What this is

A loader (Node) drives the Slack desktop app over the Chrome DevTools Protocol
and injects a runtime (browser) into the renderer. The runtime applies themes,
hosts plugins, and exposes an API to them. Mods live in `mods/`.

```
src/loader/    Node: spawns Slack, CDP, filesystem, settings
src/runtime/   Renderer: themes, plugin host, Mods panel, plugin API
src/shared/    The protocol between the two
mods/          Themes and plugins, one folder each
tests/         Shared test harness (jsdom + a recording fake api)
```

## Commands

**pnpm, not npm.** `pnpm-workspace.yaml` carries `allowBuilds: esbuild: true` --
pnpm refuses to run a dependency's install script unless it is named there, and
esbuild fetches its platform binary in one, so a fresh checkout fails on every
command that touches the bundler without it.

```bash
pnpm install            # once; pnpm, and the lockfile is committed
pnpm build            # both bundles + dist/download.mjs
pnpm start                # launch Slack with mods
pnpm test                 # every mod's tests
ppnpm test:mod -- <id> # one mod
ppnpm test:core        # loader unit tests
pnpm check-structure  # is every mod loadable
pnpm validate-mods    # manifests
pnpm registry         # regenerate mods/registry.json (commit it)
pnpm typecheck
```

Full gate before pushing: `typecheck`, `build`, `validate-mods`, `registry`,
`test:core`, `test`, `check-structure`.

## Hard constraints, all verified against Slack 4.51 / Electron 43

- **`eval()` and `new Function()` throw in the page.** Slack's CSP has no
  `'unsafe-eval'`. Plugins load as ES modules through `blob:` URLs, which *is*
  in `script-src`. Note that code run through CDP `Runtime.evaluate` is exempt,
  so a console test of `eval` misleadingly succeeds.
- **A `blob:` URL has no directory**, so `import './x.js'` inside one resolves
  to `blob:https://app.slack.com/x.js` and fails. `buildModuleGraph` in
  `plugins.ts` is the answer: read the folder, blob each file leaves-first, and
  rewrite relative specifiers to the blob URL of the file they name. It rewrites
  *only* specifiers, and skips comments -- mods type `api` with a JSDoc
  `{import('../../../src/runtime/api.js')}`, which is not an import.
- **No debugging port.** The loader uses `--remote-debugging-pipe` (fds 3 and 4),
  so Slack listens on no TCP port. Do not add a flag that reopens one.
- **`app.asar` cannot be patched.** `EnableEmbeddedAsarIntegrityValidation` and
  `OnlyLoadAppFromAsar` are on, with the hash in a code-signed `Info.plist`.
- **Slack's CDN has no CORS headers.** `fetch('https://ca.slack-edge.com/…')`
  from the renderer always fails; downloads go through `api.files.save`, which
  the loader performs.
- **Switching workspace does not reload the client.** Same page, same mods,
  same api objects, new team id in the URL. Anything a mod cached at boot then
  belongs to the workspace the user has left. `web-api.ts` keys its config on
  `currentTeamId()` for exactly this reason — caching the token once made every
  call go out for the wrong team, which Slack reports as ordinary errors and
  which reads as "this plugin is broken". If a mod holds per-workspace state
  (members, VIPs, anything from `users.info`), it has to watch the team in the
  URL and drop it. Two workspaces can also use the same channel id, so compare
  the team, not only the channel.
- **Slack's API refuses cookie-only auth.** It needs the `xoxc-` token from
  `localStorage`. Only `src/runtime/web-api.ts` may read it; mods use
  `api.slack.web`.

## Slack DOM and CSS

- **Slack has two "jump to unread" pills** in the sidebar, one for unread above
  and one for below, and they share every class except a hashed CSS-module name
  (`sidebarBannerBottom__8F6br`) that changes with each build. Tell them apart
  by which half of the sidebar they sit in, not by that class: a rule matching
  both sets `top` and `bottom` on the same element, and the top one stretches
  between them.
- Class names churn. Anchor on `data-qa` attributes first, then design tokens.
  `.circleButton__cMiUK`-style names are CSS-module output and change per build;
  `.p-channel_sidebar__channel`-style BEM names are stable.
- **Colours come from four families**, and a theme that only overrides the first
  leaves the app chrome untouched:
  `--dt_color-<role>` (content), `--dt_color-theme-*` (chrome: rail, sidebar,
  headers), `--sk_*` (legacy, bare `r, g, b` triplets), `--dt_color-plt-*` (raw
  palette, also triplets). The middle two need `!important`.
- `.p-theme_background` is a full-viewport opaque layer above `<body>`; clear or
  repaint it or any gradient is invisible.
- **Never insert next to `.c-coachmark-anchor`.** Anchoring a toolbar button
  before the coachmark wrapper around the user button freezes the renderer
  solid: grey window, no error, no console, `Runtime.evaluate` times out and
  Slack has to be killed. Slack's coachmark code evidently loops with whatever
  changes the DOM around it. Bisected against a running client — the same button
  anchored on `#betterslack-control-button` is fine every time, which is now the
  control strip's default. When an anchor is missing, `addToolbarButton`
  prepends rather than appends: the end of a container is where the app's own
  re-renders land.
- `keepMounted` gives up after 25 remounts in two seconds and logs which node
  and container, rather than looping forever. A missing button is a bug report;
  a frozen Slack is not.
- **Two mods anchored on the same neighbour froze Slack**, and this is the
  second freeze of exactly that shape. `keepMounted` used to ask its node to be
  the anchor's *immediate previous sibling*; every control-strip button defaults
  to `before: '#betterslack-control-button'`, so with two of them each shoved the
  other aside, forever, inside a MutationObserver callback. Being anywhere
  before the anchor satisfies both. Every DOM touch -- move as well as insert --
  now counts toward the give-up limit, so no branch of that callback can spin.
  Covered by `tests/mount.test.mjs`.
- **When Slack freezes, `Debugger.pause` names the loop** -- but only if
  `Debugger.enable` was sent *before* the thread got busy; enabling it
  afterwards never takes, and the first attempt at this came back empty.
  `BETTERSLACK_DIAGNOSE=1` does both, and prints what the client looks like at 3s,
  8s and 16s. `BETTERSLACK_NO_BOOTSCRIPT=1` forces the runtime in against a
  finished document, which is what made the freeze reproducible every time
  instead of one boot in five. `sample <renderer pid>` confirms it is JS rather
  than layout: V8 frames under `MicrotasksScope`.
- **Plugins start only once `.p-client_container` exists** (`waitForClient` in
  `manager.ts`); themes go in immediately, since CSS cannot loop. The runtime is
  injected at document-start on a fresh navigation *or* straight into a page the
  loader caught mid-boot, and in that second case mods used to start against a
  half-built DOM -- mount observers firing on every node Slack adds while it
  renders, with the microtask queue never draining. The renderer blocks outright:
  grey window, no error, `Runtime.evaluate` never returning. It is intermittent,
  it depends on when the attach loop finds the target, and it looks exactly like
  the coachmark freeze, so check both.
- **The loader forwards the page's own errors to the terminal**: uncaught
  exceptions always, console warnings and errors mentioning betterslack, and
  everything with `BETTERSLACK_VERBOSE=1`. Without it the only way to see why a mod
  failed at boot is DevTools inside a Slack that may not be responding.
- Reuse Slack's button classes rather than styling your own. Watch for
  `c-icon_button--default`: without it, icon buttons render 36px instead of 28px.
- Slack's real DevTools open with **`desktop.app.toggleDevTools()`** — its own
  preload method, posting to the TOGGLE_DEV_TOOLS IPC channel. Confirmed in
  `~/Library/Application Support/Slack/logs`: `openDevToolsEpic: Received action
  { willOpen: true }`. The epic only acts on a *focused* webContents, so it does
  nothing while Slack is in the background.
  `desktop.redux.dispatchUpdate` looks like a generic action forwarder and is
  **not**: it wraps the argument as the payload of REDUX_UPDATE_FROM_WEBAPP,
  whose reducer only reads `payload.teams`, so anything else is silently
  dropped. That cost an afternoon.
- **The leftmost column is the workspace switcher** (`.p-team_sidebar__item`,
  one per signed-in workspace) and it only exists with more than one. That, not
  `.p-tab_rail`, is Slack's counterpart to Discord's server list; the tab rail
  next to it holds sections (Home, DMs, Activity).
- **`.p-client_workspace__tabpanel` is a named-area grid** (`"…--sidebar
  …--primary"`) whose column widths carry the resizable sidebar. Do not override
  its template. To add a column, flip `.p-view_contents--primary` to
  `flex-direction: row` and append to it.
- **The member list is a modal**, opened from `[data-qa="avatar_stack"]` in the
  channel header. Slack has no persistent member pane to restyle.
- **`[data-qa="member_profile_pane"]` + `.p-r_member_profile__avatar__img` is a
  contract, not just Slack's markup.** Anything presenting a profile carries
  both; `user-inspector` finds it and appends its sections, and reads the user
  id off the avatar URL. `member-sidebar`'s dialog is the first non-Slack thing
  to do it. `user-inspector` mounts **per pane** (stamped with
  `data-betterslack-pane`) — a single `helpers.mount` filled whichever profile it
  reached first and starved the other.
- **Borrowing a Slack class borrows its layout.** The avatar class above is
  `position: absolute` in Slack's stylesheet, which parked the dialog's avatar
  on top of its title. Reset explicitly.
- **Slack does not render while its window is hidden.** `visibilityState ===
  'hidden'` and the channel-details modal never opens, so anything that drives
  Slack's own UI fails in the background — which is also why measuring by
  clicking through Slack from a terminal is flaky.
- **Slack's deep links are the only navigation that works from a mod**, and
  they work well: assigning `slack://channel?team=…&id=…` or
  `slack://user?team=…&id=…` hands the URL to the desktop app's protocol
  handler, which routes it in place — same document, no reload, view follows.
  Both measured. `slack://huddle?…` does nothing. `api.slack.openConversation` /
  `openUserProfile` wrap them.
- **VIP is a preference, not an endpoint.** `users.prefs.set` with
  `name=vip_users` and a comma-separated list of user ids; `users.prefs.get`
  reads it back. Wrapped as `api.slack.vipUsers()` / `setVip()`. Verified by
  adding, reading back and restoring.
- **A huddle cannot be started from a mod, and this is now precise rather than a
  shrug.** `rooms.join` exists and takes `channel_id`; it answers `ok` with
  `call`, `canvas` and `huddle` — but the room it hands back has
  `participants: []` and never rings anyone. It *provisions* the room; joining
  is the WebRTC session Slack's own client establishes, which no mod can. (For
  completeness: `rooms.leave` needs `channel_id` + `call_id` + `attendee_id`,
  and answers `feature_not_enabled` here. `rooms.create`, `huddles.*` and
  `slack://huddle` do not exist, `calls.*` refuses an `xoxc` token, and
  `member_profile_huddle_btn` ignores `element.click()` *and* a trusted
  `Input.dispatchMouseEvent`.) So do not offer a Huddle button; offer
  `openUserProfile`, which puts Slack's own one click away.
- **When a trusted click seems to do nothing, check what is on top of it.** A
  leftover `ReactModal__Overlay` (z-index 1053) from Slack's own dialog swallowed
  every click aimed at the profile pane, and made "trusted clicks do not work"
  look true for a while. `document.elementFromPoint(x, y).closest('[data-qa]')`
  before clicking says whether the point reaches what you think it does. The
  harness can now dispatch a trusted Escape, which is what dismisses that
  overlay -- a synthetic one does not.
- **A huddle does start, from the channel header.** `member_profile_huddle_btn`
  in the profile pane is only a menu trigger (both halves open it, and its
  entry does nothing); the control that works is
  `[data-qa="huddle_channel_header_button__start_button"]`, and a plain
  `element.click()` is enough -- no trusted gesture needed. It opens a separate
  Electron window, "Slack - aperçu de l'appel d'équipe", which is why nothing
  showed in the main renderer and why no API call was ever recorded. Wrapped as
  `api.slack.startHuddle(userId)`. The earlier user-activation theory was wrong:
  `navigator.userActivation.isActive` is true under a CDP click, and the
  microphone is granted.
- **Slack opens other windows, and they are separate renderers.** The loader
  attaches to every page target, not only the client, and paints the enabled
  themes into the others -- stylesheet only, no runtime, no panel, no plugins.
  Without it the huddle preview sits in Slack's default colours in the middle
  of a themed app. `Target.getTargets` is how you see them at all.
- **Discovering the API surface beats intercepting it.** Slack answers
  `unknown_method` for what does not exist and an argument error for what does,
  so calling a candidate with no arguments maps the surface without performing
  anything. That is how `rooms.join` and `vip_users` were found, after
  intercepting `fetch`, XHR and the WebSocket had all come back empty.
- **A profile cannot be opened by URL.** Slack keeps it out of the address bar,
  and a synthesised `<a href="/team/U…">` is intercepted by nothing: clicking
  one navigates the window off the client entirely. The way in is Slack's own
  member list — open the details modal and click the row whose avatar URL holds
  the user id (match on the id, not the name beside it).
- **`users.info` takes a comma-separated `users` list** and answers with a
  `users` array. Undocumented, but it is what Slack's own client sends, and it
  turns one request per member into one request. `users.getPresence` has no such
  form: passing `users` is accepted and ignored, and it answers about the caller
  instead — a silent wrong answer, so presence is one call each and has to be
  capped.
- **Your own presence is in the DOM**: `[data-qa="user-button"] .c-presence`
  carries `c-presence--active` or `c-presence--away`, and Slack swaps it the
  moment it changes. Copy that rather than polling `users.getPresence`, which
  lags the client -- worst right after the window comes back to the front, where
  it reported away for up to a minute while the app plainly said available.
  `sidebar-account` was doing exactly that. Do-not-disturb is *not* in that
  class, so it still comes from the API, slowly. The word beside the dot is
  painted from the same reading -- it used to be read once at mount, from
  Slack's screen-reader label, and never again, so it kept saying whatever was
  true when the strip happened to be built. A green dot next to "Absent(e)" is
  worse than either being wrong alone.
- Slack's tooltips are React portals you cannot register with. `ui/tooltip.ts`
  rebuilds them from Slack's classes; the hover delay is ~150ms, measured with a
  real pointer (synthetic mouse events take a different path and mislead).

## The plugin API

**[docs/api.md](docs/api.md) is the reference — keep it in step with the code.**
Adding a helper or changing a signature without updating it, with an example, is
an incomplete change. [docs/getting-started.md](docs/getting-started.md) is the
human entry point and [docs/themes.md](docs/themes.md) holds the CSS knowledge;
both are part of the same contract.

Shape of it:

- `api.helpers` — the first thing to reach for. `toggle` (persisted flag + a
  class on `<html>` so behaviour is pure CSS), `hotkey` (`mod+shift+f`, with a
  `when` guard that gates the *match* so an inapplicable shortcut does not
  swallow the key), `mount`, `each`, `badge`, `tooltip`, `copy`, `iconButton`,
  `field`, `section`, `debounce`.
- `api.slack` — Slack's chrome: `addToolbarButton` (controlStrip / composer /
  channelHeader, with `before` to sit above another button), `addMessageAction`,
  `addProfileButton`, `onProfilePane`, `describeMessage`, `userIdFromMessage`,
  `currentChannelId`, `composer`, `web`, `selectors`.
- `api.ui` — `toast`, `modal`, `confirm`, `tooltip`, in shadow roots.
- `api.i18n` — `strings({ en, fr, ... })` returns `t(key, vars)`; `locale` and
  `language` come from Slack's `<html lang>`, never from `localConfig_v2` (that
  is the token file, and only `web-api.ts` reads it). English is required and is
  the fallback for an unknown language *and* for a missing key; a key missing
  everywhere renders as the key rather than as a blank. Every shipped plugin has
  `en` and `fr`, and `tests/i18n.test.mjs` fails a mod whose tables do not cover
  the same keys.
- `api.dom`, `api.files.save`, `api.settings`, `api.css`, `api.log`.

When two mods want the same block, it belongs in the API, and the mods get
refactored onto it in the same change. Five things were lifted that way after an
audit of all eleven plugins, and each one had been written two or three times:

- `api.slack.web.users(ids)` — the batched `users.info`, cached per workspace.
  Three plugins kept their own cache and their own drop-on-switch rule.
- `api.slack.web.availability(id)` — presence and dnd folded into one state.
  `dnd_enabled` alone is a **schedule**, not a state: someone with quiet hours
  every night is not away all day, which is what the three copies all showed.
- `api.ui.menu(anchor, items)` — Slack's `c-menu`, positioned and dismissed.
- `api.slack.avatarUrl(url, size)` — Slack serves them as `<base>-<size>`.
- `api.helpers.poll(fn, ms)` — an interval that stops while the window is
  hidden. Slack does not render then, so a poll that keeps going spends a rate
  limit shared with the client on answers nobody will see.

## The theme builder

`mods/plugins/theme-builder` opens a window of its own and paints the client
live through `api.css`, so **the preview is Slack**. It used to draw fragments
of Slack inside its own window as well; they were a worse copy of what was
already on screen and took half the width. The window is one narrow column of
controls now, deliberately.

Its own chrome is fixed, not themed: a workbench repainted by the work becomes
unreadable exactly when you have just written something wrong. `window.css`
mirrors Slack's design system by hand instead -- separate window, so none of
Slack's stylesheet reaches it.

It opens on a **door** (`views/start.js`): new theme, open one you have, or
carry on. Work is kept through `api.settings` -- the loader's file on disk --
not `localStorage`, which is Slack's storage and is wiped by an app update.

**Choosing a base reads that theme's colours into the palette** -- loading its
stylesheet under the generated one is not enough, and the way that failed was
confusing: the base went in first, the twelve derived roles went in after and
painted over every colour it had set, so a chosen theme's fonts and layout
appeared while its colours did not. `read-theme.js` maps Slack's tokens back to
the twelve roles, following `var()` references (themes name their own colours
and point Slack's tokens at them) and unwrapping triplets. Roles a theme is
silent about stay derived.

**While the builder is open it holds the user's themes back**
(`api.themes.suspend`, which detaches the whole `theme` layer without touching
the settings). Without that, choosing a base changes nothing you can see: the
theme that is switched on is still painting underneath, and the builder's job is
to show what *it* is painting. `StyleManager.reattachOrphans` skips a suppressed
layer, or Slack's next touch of `<head>` puts it straight back.

Laid out like Slack's preferences: a rail of sections, one view at a time, a bar
of actions along the bottom (`ui.js` holds the primitives, `views/` a file per
section). A first attempt stacked every tool in one scrolling column and it read
as a list of controls in the order they were written, which is the thing to
avoid if this is ever rebuilt again.

**Hovering a colour outlines what it paints**, which is `highlight.js`: the
stylesheet inverted once into token -> selectors, then queried. Two things that
look like details and are not. State pseudo-classes are *stripped* from a
selector rather than skipped -- the hover colour only ever appears in a `:hover`
rule, so skipping them left the role called "the row under the pointer"
highlighting nothing. And a role reaches Slack through its tokens *and* through
the handful of rules `roles.js` writes directly (rail, sidebar,
`.p-theme_background`), so `targetsForRole` returns both; tokens alone left
Chrome lighting up nothing. Both derived from `buildThemeCss` with a sentinel
colour per role, never from a second table.

**To see a mod's own window, screenshot it through CDP** -- `BETTERSLACK_SHOT=<dir>`
writes a PNG per attached window. `screencapture` photographs the desktop, and a
window Slack opened is routinely on another Space or display, so it comes back
without the window in it. This is how the builder's interface was looked at
while it was being built.

`tokens.js` reads the client's own custom properties rather than shipping a
list: there are ~525 colour tokens in Slack 4.51, they change between releases,
and the only honest source is the page. Two families take bare `r, g, b`
triplets (`--sk_*`, `--dt_color-plt-*`) -- writing a colour there parses, paints
nothing, and reports nothing, which is why every value goes through
`formatFor(kind, colour)`.

## Themes require plugins; they do not run code

A theme is CSS and nothing else. When a look needs behaviour, the theme lists a
plugin id in `requires` and the panel offers to switch it on.

- Only themes may declare `requires`, and only plugin ids, so no cycle is
  possible. Every id must exist in the catalogue; `validate-mods.mjs` and
  `check-structure.mjs` both fail otherwise.
- `Panel.enableWithRequirements` asks before switching a plugin on, and enables
  the theme either way if the user declines. Both facts are tests in
  `tests/requires.test.mjs` — a plugin is code that keeps running after the
  theme is off, so it is never turned on silently.
- The required plugin must stand alone: it reads Slack's tokens and follows any
  theme, and the theme must not style its markup. Also a test.
- **A `script` + `permissions` system for themes was built and then removed.**
  It put a second, weaker plugin model beside the real one — its own API to keep
  in step, its own consent dialog to explain — for something plugins already
  did. If it comes up again, that is the reason it is not there.

## The design system, twice

Inside the client, **borrow Slack's classes** -- the Mods panel wears
`.c-dialog` / `.c-button` and follows every theme for nothing. Anywhere else
there is no stylesheet at all: a window a mod opens is a blank document. That is
what `api.ui.kit(doc)` + `api.ui.kitCss` are for (`src/runtime/ui/kit.ts`), and
they exist because the theme builder had rebuilt the whole system by hand and it
was drifting on its own. Everything is prefixed `sm-`, so the stylesheet is safe
in the client too.

`kit.code()` is the CSS editor: a highlighted `<pre>` under a transparent
`<textarea>`. Both must agree on **every** metric or the caret drifts from the
text; that is why `CODE_CSS` lives beside the tokeniser and is shared by the kit
and by `PANEL_CSS` rather than copied.

**Two runtimes can boot into one document.** `window.__betterslack` is only
assigned at the *end* of an async boot, so the document-start script and a
loader injection into the same live page both found it empty, both built a
Bridge, and both started every plugin -- the second receiver on `window` won and
the first runtime's plugins were left with a bridge nothing answers: every
request timed out after fifteen seconds while their buttons sat there looking
fine. `boot()` now claims `window.__BETTERSLACK_BOOTING__` synchronously. Found
through a theme gallery that came up blank, with six answers delivered by the
loader and six timeouts in the page.

## The Mods panel

The repository is a **catalogue**, not a set of pre-installed mods: a fresh
install starts with `installed: []` and the user installs from the Browse shelf.
`enabled` is always a subset of `installed`, enforced in `store.ts` so a
hand-edited settings file cannot produce an enabled-but-not-installed state.

The panel and `api.ui.modal` render into the **light DOM** wearing Slack's own
`c-dialog` / `c-menu` / `c-button` classes, so Slack's stylesheet styles them
directly and they follow every theme exactly. They used to live in a shadow
root, reimplementing the look from tokens — which lands close but never right.
The trade-off is deliberate: a theme that restyles `.c-dialog` restyles them
too. Toasts stay in a shadow root, since Slack has no toast to borrow from and
an unreadable error message is worse than an off-brand one.

Destructive actions belong behind the row overflow menu, not on the row: a
Remove button on every line shouted louder than anything else in the dialog.

The panel re-renders wholesale on every change, and one toggle triggers several
renders in a frame. Scroll position therefore comes from the user's own scroll
events, not from reading the DOM at render time — reading it captured a 0 left
by an earlier render in the same frame.

## Conventions

- Comments explain *why*, especially where the code looks odd because Slack
  forced it. Several of the strangest lines here are load-bearing.
- **Never put a backtick inside `PANEL_CSS`**, comments included. It is a
  template literal, so a backticked `.c-dialog` in a comment closes the string
  and the rest parses as JavaScript — `.c - dialog` — which builds cleanly and
  then throws `ReferenceError: dialog is not defined` at boot, taking the whole
  runtime down with no styling on the failure. This has happened twice.
  `tests/requires.test.mjs` now fails if a backtick appears in there.
- Mods are distributed through pull requests and reviewed by a human; that
  review is the security model, since plugins run unsandboxed in an
  authenticated Slack tab. `CONTRIBUTING.md` lists what gets rejected.
- Commits and PRs are authored by the repository owner. Do not add AI
  co-author trailers.
