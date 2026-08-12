# Contributing a mod

Mods are distributed from this repository. To publish one, open a pull request
that adds a folder under `mods/`. Every mod is read by a maintainer before it
merges.

## Why the review is strict

A SlackMod plugin runs inside an authenticated Slack tab. It can read every
message you can read, and it can talk to the network. There is no sandbox around
it and no permission prompt in front of it.

That means the code review **is** the security model. A plugin that would be
harmless in a browser extension store is not automatically acceptable here,
because there is no second line of defence behind it.

## Using the Slack API

Some mods need more than what is painted on screen. Slack's API refuses
cookie-only requests, so the desktop client authenticates with a token it keeps
in `localStorage`.

Mods must never read that token. Use `api.slack.web`, which is the audited
wrapper in `src/runtime/web-api.ts`: it reads the token in one place, can only
send requests to Slack's own origin, and never hands the token back to callers.
One file to review instead of one per mod.

Using the signed-in session to call Slack's own API is fine. Sending anything
derived from it anywhere else is not.

## What gets a pull request rejected

- Network calls to anywhere other than a clearly stated, purpose-obvious
  endpoint — and never with message content, tokens or workspace identifiers.
- Reading `localStorage`, cookies, or the session token directly, instead of
  going through `api.slack.web`.
- Obfuscated, minified or generated code. Submit the source a human can read.
- Code fetched at runtime from a URL. The reviewed source must be the code that
  runs.
- Anything that changes what a message says, who it appears to be from, or
  whether it appears to have been sent.

If your mod genuinely needs one of these, say so explicitly in the pull request
description and explain why. It is a conversation, not an automatic no — but an
unexplained one is an automatic no.

## Checklist

1. Folder layout, where `<id>` matches your `mod.json` `id` exactly:

   ```
   mods/themes/<id>/mod.json + <entry>.css
   mods/plugins/<id>/mod.json + <entry>.js
   ```

2. `npm run validate-mods` passes.
3. **A `test.mjs` next to your `mod.json`, and `npm run test:mod -- <id>`
   passes.** Every mod ships tests. There is no way to opt out: a mod with no
   `test.mjs` fails the structure check immediately.
4. `npm run registry` has been run and `mods/registry.json` is committed.
5. Tested against the current Slack release. Put the version you tested in
   `slackVersion`.
6. The description is one sentence that says what a user gets, not how it works.

### What CI does with your pull request

Two workflows look at mods, and both consider **only the mods your branch
touches** — somebody else's failing mod cannot block your merge, and yours
cannot block theirs:

| Workflow | Per changed mod | Checks |
| --- | --- | --- |
| **Mod structure** | `node scripts/check-structure.mjs <id>` | manifest, entry file exists and imports, a real `start()` export, CSS parses, `test.mjs` present, registry entry current |
| **Mod tests** | `npm run test:mod -- <id>` | your own tests |

Each mod gets its own job, so a failure names the mod at fault. Both workflows
end in a job with a stable name (`mod structure`, `mod tests`) — those are the
ones branch protection requires, because matrix job names change with every
pull request.

One deliberate exception: if a branch changes the shared runtime API or the test
harness, *every* mod is tested, because the contract they were written against
has moved.

Run the same thing locally before pushing:

```bash
node scripts/changed-mods.mjs           # what CI will pick up
npm run check-structure -- <id>
npm run test:mod -- <id>
```

### Writing the tests

`tests/harness.mjs` gives you a DOM shaped like Slack's and a recording stand-in
for `api`, so a test never needs Slack, Electron or a network:

```js
import { createTestApi, installDom } from '../../../tests/harness.mjs';
import plugin from './index.js';

const dom = installDom();
const { api, recorded } = createTestApi();
await plugin.start(api);
recorded.messageActions[0].onClick({ permalink: 'https://…' });
// then assert on recorded.toasts, recorded.composerLink, the DOM, …
dom.cleanup();
```

Themes get their checks for free — a three-line `test.mjs` calling
`themeChecks()` from `tests/theme.mjs` covers balanced braces, no remote
resources, and no hashed Slack class names.

## Writing mods that survive Slack updates

Slack's CSS class names (`c-menu_item__li`, `p-ia__sidebar_header__info`) are
build output and change without warning. Two things are far steadier:

- **`data-qa` attributes** — Slack's own end-to-end tests depend on them.
- **`--dt_color-*` custom properties** — Slack's design tokens.

Prefer them, in that order, over anything else. A mod pinned to a hashed class
name will break, and the breakage lands on the maintainers.

### Theming: four families, not one

This costs everyone a wasted afternoon the first time, so it is worth stating
plainly. Slack's colours come from four separate sets of custom properties:

| Family | Drives | Format |
| --- | --- | --- |
| `--dt_color-<role>` | message content, controls, text | CSS colour |
| `--dt_color-theme-*` | the workspace chrome: rail, sidebar, headers | CSS colour |
| `--sk_*` | older components, still widespread | bare `r, g, b` |
| `--dt_color-plt-*` | the raw palette the others are built from | bare `r, g, b` |

Two traps come with them:

- **`--dt_color-theme-*` and `--sk_*` need `!important`.** Something more
  specific than `:root` defines them, so a plain declaration silently loses.
  Override only the ones you actually need, and say why in a comment.
- **`.p-theme_background` is a full-viewport opaque layer above `<body>`.** A
  gradient, an image or any translucency on `<body>` is invisible until you
  repaint or clear that element.

A dark theme can get away with skipping the chrome families, because Slack's
default chrome is already dark. A light theme cannot — it will come out as
light content inside a dark frame.

Other things worth knowing before you write code:

- `eval()` and `new Function()` throw. Slack's CSP has no `'unsafe-eval'`, so
  `validate-mods` rejects them up front rather than letting you find out at
  runtime.
- Use `api.dom.keepMounted` rather than your own `MutationObserver` when you
  insert a node. Slack re-renders constantly, and a naive observer inserts
  duplicates.
- Start from `api.helpers` — see [API.md](API.md). Most mods are one or two
  calls, and a pull request that hand-rolls something the API provides will be
  asked why.
- Reach for `api.slack.addToolbarButton` and `api.ui.*` before writing your own
  markup. A hand-styled button drifts out of step with Slack the moment its
  palette changes; one built from Slack's classes cannot. Reviewers will ask why
  if a pull request rebuilds something the API already provides.
- If Slack has no shared class for what you need — its channel-header buttons
  size themselves from a per-page class, for instance — state the value directly
  in CSS rather than borrowing an unrelated Slack class whose name would then
  lie about what your element is.
- Register teardown through `api.onDispose`, or the cleanup helpers that return
  one. A plugin that leaks observers slows down the whole app.

## Local development

```bash
npm install && npm run build
npm start
```

Edit files in `mods/` and they reload in Slack immediately. Mods in
`~/.slackmod/mods/` shadow the repo copies, which is convenient for iterating on
something already merged.
