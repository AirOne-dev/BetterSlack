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

```bash
npm run build            # both bundles + dist/download.mjs
npm start                # launch Slack with mods
npm test                 # every mod's tests
npm run test:mod -- <id> # one mod
npm run test:core        # loader unit tests
npm run check-structure  # is every mod loadable
npm run validate-mods    # manifests
npm run registry         # regenerate mods/registry.json (commit it)
npm run typecheck
```

Full gate before pushing: `typecheck`, `build`, `validate-mods`, `registry`,
`test:core`, `test`, `check-structure`.

## Hard constraints, all verified against Slack 4.51 / Electron 43

- **`eval()` and `new Function()` throw in the page.** Slack's CSP has no
  `'unsafe-eval'`. Plugins load as ES modules through `blob:` URLs, which *is*
  in `script-src`. Note that code run through CDP `Runtime.evaluate` is exempt,
  so a console test of `eval` misleadingly succeeds.
- **No debugging port.** The loader uses `--remote-debugging-pipe` (fds 3 and 4),
  so Slack listens on no TCP port. Do not add a flag that reopens one.
- **`app.asar` cannot be patched.** `EnableEmbeddedAsarIntegrityValidation` and
  `OnlyLoadAppFromAsar` are on, with the hash in a code-signed `Info.plist`.
- **Slack's CDN has no CORS headers.** `fetch('https://ca.slack-edge.com/…')`
  from the renderer always fails; downloads go through `api.files.save`, which
  the loader performs.
- **Slack's API refuses cookie-only auth.** It needs the `xoxc-` token from
  `localStorage`. Only `src/runtime/web-api.ts` may read it; mods use
  `api.slack.web`.

## Slack DOM and CSS

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
  `data-slackmod-pane`) — a single `helpers.mount` filled whichever profile it
  reached first and starved the other.
- **Borrowing a Slack class borrows its layout.** The avatar class above is
  `position: absolute` in Slack's stylesheet, which parked the dialog's avatar
  on top of its title. Reset explicitly.
- **Slack does not render while its window is hidden.** `visibilityState ===
  'hidden'` and the channel-details modal never opens, so anything that drives
  Slack's own UI fails in the background — which is also why measuring by
  clicking through Slack from a terminal is flaky.
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
- `api.dom`, `api.files.save`, `api.settings`, `api.css`, `api.log`.

When two mods want the same block, it belongs in `helpers.ts`, and the mods get
refactored onto it in the same change.

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
