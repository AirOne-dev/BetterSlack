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
- Slack's tooltips are React portals you cannot register with. `ui/tooltip.ts`
  rebuilds them from Slack's classes; the hover delay is ~150ms, measured with a
  real pointer (synthetic mouse events take a different path and mislead).

## Working on mods

Every mod ships a `test.mjs`. `tests/harness.mjs` gives a Slack-shaped jsdom and
a recording stand-in for `api`, so tests need no Slack, Electron or network.

CI runs two workflows per **changed** mod, one job each: structure
(`check-structure.mjs`) and tests. A change to `src/runtime/`, `src/shared/` or
`tests/` puts every mod back in scope, because the contract moved.

Use `api.dom.keepMounted` rather than a raw `MutationObserver`: Slack re-renders
constantly and a naive observer inserts duplicates. Register teardown through
`api.onDispose` so disabling a plugin really leaves the DOM as it was found.

## Conventions

- Comments explain *why*, especially where the code looks odd because Slack
  forced it. Several of the strangest lines here are load-bearing.
- Mods are distributed through pull requests and reviewed by a human; that
  review is the security model, since plugins run unsandboxed in an
  authenticated Slack tab. `CONTRIBUTING.md` lists what gets rejected.
- Commits and PRs are authored by the repository owner. Do not add AI
  co-author trailers.
