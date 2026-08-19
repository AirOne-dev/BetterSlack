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

**Keep `pnpm start` running the whole time you are working.** Not as a final
check -- from the first minute, in the background, for the length of the
session. Everything this project gets wrong is invisible until it is on screen:
an animation that reads as a blink, a button that never mounted, a selector that
stopped matching, a renderer that has quietly stopped answering. The loader
prints the page's own errors to that terminal, so a mod that threw at boot says
so there instead of hiding in a DevTools window you have to go and open.

**And leave it running.** Somebody is using Slack while you work -- it is their
messaging app before it is your test fixture. Stopping it is a last resort, not
a step in a loop, and the mistake that makes it a loop is easy to fall into:
Slack is launched with `--remote-debugging-pipe` and the loader holds the
descriptors, so a CDP probe of your own cannot attach while it runs. One
question, one stop, one restart -- do that per question and the app is down
more than it is up, which is what happened over one long session here.

So: write the code first, and let the questions pile up. Answer the ones that
need no client at all -- unit tests, jsdom, reading Slack's own bundle, reading
the source -- and batch what genuinely needs a live renderer into a single
probe that asks everything at once. `pnpm shoot` is the shape to copy: every
screenshot the site and the README use in one launch, and `pnpm shoot --mods`
one per mod in another, because the runtime can be driven in place through
`window.__betterslack` instead of being restarted between frames.

Mods hot-reload into the running client -- edit anything under `mods/` and the
loader broadcasts it, no restart at all. A mod asking for `api.slack.restart()`
does not cost the session either: the loader stops Slack, applies whatever
preferences were wanted, launches it again and rebuilds its CDP connection in
place, so the same process and the same terminal carry on. Only a change under
`src/` needs `pnpm build` and a restart, and `pnpm dev` (esbuild watch) makes
that one keystroke -- so batch those too rather than restarting per edit.

`pnpm test:live` and `pnpm shoot` both take the client for themselves as well.
Run them when the work is done, not while it is in progress.

`pnpm test:live` boots the real Slack, asks the runtime what loaded and turns
the answer into an exit code. Every failure that has mattered here -- a wedged
renderer, two runtimes in one document, a mod that threw on start -- was
invisible to the unit tests and obvious to this. It closes Slack afterwards,
which is why it is not part of `pnpm test`.

The loader also watches while it runs: if the renderer stops answering, it says
so, names the mods that were on, and re-arms the safe-start marker.

**In that launcher, `set -e` swallowed the explanation.** Under `set -e` an
assignment takes the exit status of its command substitution, so
`WHY="$(cat missing-file 2>&1 >/dev/null)"` does not leave `WHY` holding the
error -- it ends the script, on that line, before the alert that was supposed
to read `WHY` can run. Launching the app did nothing at all: no window, no
dialog, an empty log. The guard added to explain a failure was itself the
reason nothing was explained. `|| true` on the assignment, and both paths
verified by running the script with a repository path that does not exist.

**A bundle whose executable is a shell script is not an application**, as far
as the gate on Desktop, Documents and Downloads is concerned. The process macOS
sees is `/bin/bash`, a platform binary with no identity of its own, so the read
is refused outright and there is nothing to grant. Measured with throwaway
bundles, in order:

| bundle | result |
| --- | --- |
| script executable, unsigned | refused |
| script executable, ad-hoc signed | refused |
| script executable + `NSDesktopFolderUsageDescription` | refused |
| Mach-O executable | macOS asks, and remembers |
| Mach-O executable exec'ing the same script | same |

So `Contents/MacOS/betterslack` is compiled from `scripts/launcher.c`, and
execs `Contents/Resources/launch.sh`. Three things follow, each of which was a
bug report before it was written down:

- **The app cannot live in the gated folder either.** `dist/` is inside the
  repository, so an app built there cannot read its own `launch.sh`, `execl`
  fails, `main` returns, and a double-click does *nothing at all* -- no window,
  no dialog, no log. `pnpm build-app --install` copies it to `~/Applications`,
  where it reads itself normally and only the project needs permission.
- **The stub explains rather than dying.** Running another program is not
  gated, only reading a file is, so it can still reach `osascript` even when it
  cannot read its own launcher.
- **The grant lasts until the next build.** An ad-hoc signature identifies a
  bundle by its contents, so rebuilding asks again. That is fine for a user who
  builds once and invisible to anyone iterating on the launcher -- which is how
  a working app turned into a silent one mid-session, twice.

The C is a file rather than a string in `build-app.mjs`. It was a template
literal for one revision, and between JavaScript escapes, C escapes and
AppleScript quoting inside one `execl`, nothing would compile.

**pnpm, not npm.** `pnpm-workspace.yaml` names esbuild under
`onlyBuiltDependencies` -- pnpm refuses to run a dependency's install script
unless it is listed there, and esbuild fetches its platform binary in one, so a
fresh checkout fails on every command that touches the bundler without it. The
file also needs a `packages` field (`- .`, this one repo): pnpm 11 treats the
mere presence of a `pnpm-workspace.yaml` as a workspace and aborts with
`packages field missing or empty` if it is absent -- so both keys are load-
bearing, and the earlier `allowBuilds: esbuild: true` was neither a real pnpm
key nor enough on its own.

```bash
pnpm check             # the whole gate, in one command -- run this before pushing
pnpm install           # once; pnpm, and the lockfile is committed
pnpm new-mod plugin my-plugin "What a user gets"   # a mod that already passes
pnpm release patch     # bumps, writes CHANGELOG.md from the commits, tags
pnpm test:live         # boots real Slack and checks what loaded
pnpm build             # both bundles + dist/download.mjs
pnpm build-app         # macOS: dist/BetterSlack.app, a launcher for this checkout
pnpm start             # launch Slack with mods
pnpm test              # every mod's tests
pnpm test -- <id>  # one mod
pnpm test:core         # loader and runtime unit tests
pnpm check-structure   # is every mod loadable
pnpm validate-mods     # manifests
pnpm registry          # regenerate mods/registry.json (commit it)
pnpm typecheck
pnpm site              # regenerate site/data.js from the registry (commit it)
pnpm site:dev          # serve site/ with live reload (--port, --open)
```

There are two screenshot recipes, and each takes its whole set in **one** Slack
launch. Both start the loader with a scratch home -- your own installed and
enabled mods are untouched -- and switch mods on and off through
`window.__betterslack` between frames rather than restarting anything.

```bash
pnpm shoot         # site/shots: the panel, a mod's page, Browse, the palette,
                   # and Discord Dark with its plugins -- five frames
pnpm shoot --mods  # one frame per mod, filed as mods/<kind>/<id>/screenshot.webp
pnpm shoot --mods -- --only=motion,devtools   # just those two, when one goes stale
```

`scripts/shoot-site.mjs` photographs the **empty demo workspace** and refuses,
by team id, to photograph any other: those frames are the hero images and go
into a public README.

`scripts/shoot-mods.mjs` photographs a **real** workspace, because a mod has
nothing to show in an empty one, and therefore replaces everything on screen
first -- see the section below. It walks the workspaces by deep link until it
finds a conversation with some history, then, per mod, switches that one on,
puts whatever the mod needs on screen, checks that something of the mod is
actually there, and files the frame in the mod's own folder. The panel and the
site both read it from there.

Rules baked into both, each of which cost a set of pictures:

- **Shoot at the size the picture is published at.** Cropping a taller frame
  afterwards takes the crop from the middle, which is how the top bar and the
  composer went missing from every panel shot on the site.
- **Force the viewport.** Otherwise every picture depends on how wide whoever
  took it happened to have Slack open, and the catalogue ends up with
  thumbnails that do not match each other.
- **Every frame has to show the mod.** Each entry names a selector that must be
  on screen -- the member column, the palette's box, the highlighted block --
  and the run fails if it is not. Without it a message action, which only
  exists while the pointer is over a message, photographs as an ordinary
  channel, and fifteen identical pictures go into the catalogue unnoticed.
- **A mod can want more than one frame**, and seven do: the member column and
  the dialog it opens, the palette empty and filtered by `/` and `@`, focus
  mode on and off. An entry carries `frames: [...]`, each inheriting the
  entry's staging unless it overrides it, and each filed as
  `screenshot-<name>.webp` beside the first. The manifest's order is what the
  panel and the site draw, so the frame that shows the mod best goes first.
- **`stage` runs before the frame is opened; `then` runs after.** Typing into
  the palette is a `then` -- there is no box to type into until it is up -- and
  the two are easy to confuse because both look like "do this as well".
- **Every staging verb is checked before Slack launches.** An edit once cut four
  of them out of `openFor`, and nothing said so: the fallback returned the
  string `'true'`, the recipe evaluated it happily, and the frames came out
  staged with nothing.

A recipe is handed `evaluate`, `sleep`, `shoot`, and three things the page
cannot do for itself:

- `shootWindow(match, name, size)` -- photograph a window a mod opened. It is a
  separate renderer, so the client's session cannot see it, and `screencapture`
  misses it because Slack routinely puts it on another Space. Match on
  `window.name`: a window opened with `window.open('', name)` is `about:blank`
  with a title in the user's language.
- `click(selector, index)` and the `hover` argument to `shoot` -- a **real**
  pointer through `Input.dispatchMouseEvent`. Slack draws the message action
  toolbar from CSS `:hover`, which no synthetic event reaches.
- The loader brings the client to the front before the recipe runs: Slack in
  the background is Slack that is not rendering, and a deep link that should
  slide a profile in does nothing there.

`BETTERSLACK_SHOT=<dir>` alone still writes one picture per attached window,
which is how a window a mod opened gets looked at outside a recipe.

**Everything is WebP, and Chromium is the encoder.** `Page.captureScreenshot`
writes the format directly, so there is no conversion step and no external tool
in the pipeline at all -- which matters, because the two `sips` calls it
replaced are macOS-only and `sips` cannot write WebP anyway (it reads it; the
format is not listed Writable). Measured on one frame: 472 kB as PNG, 132 kB as
the 1400-wide JPEG this project used to publish, 160 kB as WebP at the full
3200x2000. The retina resolution costs 28 kB, so the downscale is gone too and
every picture is now 2x. Quality 78 is measured as well -- 70 starts showing on
Slack's text, 85 costs 28 kB for nothing visible.

## Photographing somebody's real Slack

`mods/plugins/demo-mode/redaction.js` replaces everything on screen that
belongs to anybody: names, faces, messages, channels, files, links, the
workspace's name. It substitutes rather than blurs -- a blurred name is still a
name that was on the screen -- and derives every replacement from a hash of the
original, so the same person is the same invented person in every frame and two
runs produce the same picture.

**It is a mod, and the recipe bundles it.** `shoot-mods.mjs` builds that file
with esbuild and evaluates it in the page. It used to be a copy in `scripts/`,
which is the shape this repository refuses everywhere else: two implementations
of one idea, and the one users run would have been the one nothing checks. Now
the recipe is Demo Mode's test against a real Slack, and anybody taking their
own screenshots hides exactly what the repository's hide.

**What makes it safe is not the list of selectors.** A list can always miss
one. It is that the recipe reads the screen before and after and refuses to
take the picture if anything survived, and re-checks before *every* frame,
since Slack keeps rendering. A missed selector is a failed run, which is a bug
report; it is not a leak. `remaining()` is the same check offered to a user, as
a command. Everything below was found by it rather than by looking:

- The composer's grey prompt carries the channel's name.
- A link Slack unfurled is a card with somebody's title and author in it.
- Sidebar section headings are named by the person who made them.
- Slack narrates every navigation for screen readers -- into
  `.c-aria_live_announcer_api`, and into a second region whose only class is a
  CSS-module hash. Match those on `[aria-live]`, which is what they are; a
  hashed class could never have been listed.
- **Slack's own paths carry ids**, and the absolute rule never sees them
  because they have no host: `/team/U…` for a mention, `/archives/C…/p…` for a
  permalink, `/services/B…` for an integration. The audit caught a real app id
  that way. Replace the ids and keep the path's shape, so `/client/…` still
  navigates.
- `aria-label` on every avatar reads "show X's profile" -- not drawn, but Slack
  builds a tooltip out of a `title`, and a picture taken with the pointer
  resting anywhere is a picture with a real name in it.
- **The workspace's name is not a direct child of the element that holds it.**
  Slack wraps it in a span, so walking `childNodes` misses it and walking the
  whole subtree finds it. Assigning `textContent` would find it too and is what
  the script did -- but a mod has to be able to put the node back, so it writes
  the first text node and empties the rest.
- The audit reads what is **drawn**: text nodes that are visible, links and
  images. Reading `body.textContent` put Slack's own inline `<script>` in it --
  the word "master" from a bundler path -- and a hidden support link, and both
  failed runs that were clean.
- Slack's own vocabulary is not a leak. The words the audit is allowed to see
  survive are listed, in one place, in `shoot-mods.mjs`, and anything not on
  that short list still fails the run.
- A mod that reads the screen once and decorates what it found -- the syntax
  highlighter -- has to be switched off and on after the sweep, or what it
  decorated is the text that has since been replaced.

It also carries the camera. `api.files.screenshot({ size })` is the loader
photographing the renderer that asked -- a page cannot photograph itself -- and
writing the PNG where a download would have gone, through the same fixed
directory and safe-name rules. It forces the viewport first and clears it in a
`finally`, so the file needs no cropping and the client is never left drawn at
the picture's size. Measured: 1600x1000 comes back as 3200x2000, which is the
catalogue's size at the 2x scale factor.

The mod hides its own switch, camera and strip before asking and puts them back
in a `finally` -- with a class on `<html>`, not an inline style, because the
toolbar buttons are re-mounted whenever Slack re-renders around them and a
remount during the two seconds a capture takes would put one back in shot.

Two things the mod needs that the script never did, both measured against a
live client rather than assumed:

- **Every write is recorded and put back**, and only where what is on screen is
  still what it wrote -- Slack re-renders, and restoring blind would put a
  stale message back over a newer one. Verified live: body, sender, workspace
  name and avatar all returned identical after switching it off.
- **The composer is swept once and then left alone.** Sweeping it on every
  mutation rewrites what you are typing as you type it. The draft that was
  there when the demo started is somebody's words; what you type during the
  demo is your own.

## The API documentation format

**Every entry in the plugin API is one file in `docs/api/`, and that file is the
source.** `site/api.html` and `docs/api.md` are both built from the folder, so
nothing about an entry is written twice and nothing about an entry can disagree
with itself. `scripts/api-doc.mjs` is the parser; `scripts/build-api-page.mjs`
turns the folder into the page.

```md
---
name: button
group: kit
title: Component kit
signature: (label: string, options?: ButtonOptions): HTMLButtonElement
preview: kit-button
control: label | text | Save
control: variant | select | primary | | default, primary, ghost, danger
control: wide | boolean | false
---

Slack's button, in its four weights.

```js
kit.button('Save', { variant: 'primary', onClick: () => save() });
```
```

- The file name is the slug: `<group>-<name>`, lowercased. `group: tools` is
  the one that is not on `PluginApi` -- the pieces a mod *imports* rather than
  receives, like the readme renderer and the tokeniser -- and is skipped by the
  cross-check rather than called an orphan.
- `name`, `group`, `title` and `signature` are required. So are one paragraph of
  prose and one fenced example -- the parser refuses a file without either,
  because a reference that shows an example for two thirds of what it lists
  teaches the reader to distrust the third.
- `preview` names a renderer in `scripts/api-previews.js`. A preview is code and
  cannot be anything else; everything a writer writes about it is not. **Every
  entry has one.** The ones that reach something a web page has not got --
  Slack's API, the loader's filesystem, a window that can be restarted --
  imitate it rather than saying "inside Slack", because a reference is read to
  find out what a call *looks* like and "not available here" answers nothing.
  Where the data can be real it is real: `site/api-fixtures.js` is generated
  from a theme's stylesheet and a plugin's folder in this repository. Where it
  cannot be -- a workspace, a download folder -- the preview wears the
  `stubbed()` note, so the reader is never left to guess which.
- Each `control` line is a knob beside the preview:
  `key | type | value | label | options`. `text`, `number`, `boolean` and
  `select`; `label` defaults to the key, and `options` is a comma-separated list
  that only means anything for a select.
- Deliberately not YAML. Five keys and a repeated line do not need a parser with
  a specification, and a dependency that can only be wrong about indentation is
  a poor trade for a file a person writes by hand.

**A `preview:` must name a renderer, and a renderer must be named.** Both halves
are checked, because both have failed: a preview naming nothing leaves an empty
box that reads as a demo which broke, and a renderer nobody names is a demo that
was written and then quietly lost -- which is what happened to three of the
helpers the first time this folder was generated.

**Adding a method to the API means adding its file.** The build cross-checks the
folder against the TypeScript interfaces -- `PluginApi`, `SlackApi`, `Helpers`,
`I18n`, `Kit` -- and fails naming anything that is in one and not the other. It
compares *what exists*, not the text of the signatures: those get reformatted by
hand often enough that a character-by-character check would only cry wolf. Docs
are the source; code is the proof.

`scripts/api-previews.js` holds the render functions, bundled into
`site/api-previews.js`. They import the real modules -- `createKit`,
`createHelpers`, `createI18n`, `renderMarkdown`, `addToolbarButton` and friends,
Code Highlight's tokeniser, the theme builder's `derivePalette` -- so the page
renders what runs in Slack, and the site build fails if one of them stops
compiling.

Three things make that possible:

- **`HelperContext` is five things**: an id, a way to write CSS, a toast, a
  settings store and a cleanup tracker. The site supplies all five against an
  in-memory map and gets the shipped helpers.
- **`site/slack-context.css` is Slack's stylesheet's understudy** -- the classes
  the widgets wear (`c-button`, `c-dialog`, `c-menu`, `c-tooltip`) plus the
  imitated client, **scoped to `body.api-page`, not to the preview box**.
  `api.ui.modal`, `menu`, `confirm` and `tooltip` all render into
  `document.body`; scoped to the box that asked for them, the modal was a
  60px heading in the page flow with no dialog, no scrim and no colours. Note
  that `.c-dialog` is Slack's *overlay*, and `.c-dialog__content` the box.
- **The colours are not invented.** `site/api-themes.css` is generated from
  `mods/themes/*/theme.css` and the picker in the bar switches the whole page.
  Three things that each cost a wrong-looking page:
  - **A theme has more than one `:root` block** -- `--dt_color-*` in one, the
    legacy `--sk_*` triplets in another. Taking the first dropped the whole
    legacy family, whose fallbacks in BetterSlack's own CSS are Slack's *light*
    defaults, so a dialog's hint text came out near-black on near-black.
    `--sk_foreground_low` alone is referenced 31 times.
  - **Half the themes are translucent by design.** Aurora's `--dt_color-base-pry`
    is 34% opaque over a gradient it paints on `body`. So `--api-backdrop` and
    `--api-backdrop-image` travel with the tokens, and a pane is painted as the
    client paints it: backdrop colour, backdrop image, pane colour.
  - **The backdrop *image* only goes on the imitated client.** It is sized in vw
    and vh; on a 90px box holding one button it is a flat wash, and every widget
    preview came out lilac.
  - `LAUNCHER_CSS` is installed alongside `PANEL_CSS`. It is the only place a
    toolbar button's icon is given a size, and without it every `addToolbarButton`
    preview drew its SVG at 300x150 -- the same omission that once shipped.
- **`tests/slack-fixture.mjs`** holds the Slack-shaped fragment, so the real
  `addToolbarButton` and `addMessageAction` have the containers they look for.
  It stays a flat list of empty containers, which is all jsdom needs; the page
  moves those same nodes into Slack's layout and fills them (`dressChrome`), so
  the answer to "where did my button go" is a client with a ring on it rather
  than five dashed rectangles. Avatars keep their real `src` in the **fragment
  of a 1x1 transparent SVG**: `onProfilePane` and `userIdFromMessage` read the
  user id out of that URL, so it has to be the real one, and a docs page has no
  business fetching faces from Slack's CDN.
- **Only the open panel's demo is mounted.** `addToolbarButton` and
  `addMessageAction` mount by observing the whole document, so with four fake
  clients in the page at once each collected every other entry's button --
  `addProfileButton` showed a message action nobody had asked for. A panel's
  demo is drawn when it is opened and torn down through the cleanup those same
  functions return, and the helper context's `track` collects the rest: `mount`,
  `each`, `badge`, `hotkey` and `poll` all keep observing after they return, and
  an untracked `keepMounted` went on putting its button into the *next* entry's
  client.
- **The grid is the client, not the frame around it.** It was on `.chrome` with
  `.p-client_container { display: contents }`, so anything a demo appended to
  the frame became a fifth grid item: it landed in the 64px rail column, over
  the control strip, cut off by the frame's `overflow: hidden`.
  `describeMessage` printed its channel id into a sliver. Demos append to the
  stage, and the layout no longer punishes them for forgetting. Nothing in the
  rail may `flex-shrink` either, or a second button in the strip squashes the
  first.
- **Anything mounted into the fake client wears Slack's classes**, never
  `kit.button`. The kit is for a window a mod opens, where there is no
  stylesheet at all, and its colours are its own -- mounted into Slack's rail on
  a light theme it came out white on cream. Same rule as the client.
- **The output panes stay dark whatever the theme is.** They are the site
  talking, not a Slack surface, and the tokeniser's colours are fixed values
  chosen against a dark background. `rgba(0, 0, 0, .4)` did follow the theme,
  which on Cocoa's cream stage came out grey-on-grey.

**The guide is `docs/guide/*.md`, and it is markdown rather than the entry
format.** Three keys -- `name`, `title`, `order` -- and then ordinary markdown,
rendered by a small renderer in `build-api-page.mjs`: headings, paragraphs,
lists, fenced code, inline code, bold, links. An entry's format exists because
every entry has a signature and a preview; a guide page has neither, and forcing
it into that shape would have meant inventing keys nobody fills in. A fence's
language reaches the page as `data-lang` and is coloured by Code Highlight's
tokeniser -- the same one running in Slack -- so a `json` manifest is coloured
as JSON rather than as JavaScript that happens to parse.

**The guide comes first and the page opens on it.** Landing somebody on
`tools.highlight` was an accident of the ordering, not a decision: a reference
is what you come back to, a guide is what you need the first time. The tab in
the bar says *Doc* for the same reason.

**One file, one panel at a time.** Every entry is a `<section class="panel">` in
that single document and the list on the left switches between them; the page
itself does not scroll. Ninety-eight separate files was an earlier shape and the
wrong one: a reference is read by jumping around it, and a jump that costs a
page load loses the theme you picked, the arguments you set and your place in
the list.

**The Pages job installs the dependencies**, and its comment said the opposite
for a while: it was true when `build-site.mjs` only read the repository and
wrote one file, and stopped being true the moment the API page arrived, since
bundling `site/api-previews.js` is esbuild. Every push then failed on
`Cannot find package 'esbuild'`. Its `paths:` filter had gone stale the same
way -- it listed `site/**` and `mods/**` only, so a change to `docs/api/`, to
the preview renderers or to the TypeScript they are checked against did not
trigger the job at all, and the drift check did not run for the one change it
exists to catch.

`site/` is the presentation page published to GitHub Pages by
`.github/workflows/pages.yml`. It is plain HTML, one stylesheet and one script
-- nothing fetched from a CDN, so it renders the same whatever else the network
is doing. Its catalogue is generated from `mods/registry.json`, and the workflow
fails if the committed `site/data.js` has drifted from it. `pnpm site` also
copies each mod's `screenshot.webp` into `site/shots/mods/`, since the page is
published on its own and cannot reach `mods/`; the catalogue and the panel
therefore show the same frame, out of the same file.

**`pnpm check` is the gate**, and it is one command because seven remembered in
the right order is not a gate. It runs typecheck, build, validate-mods,
registry, site, test:core, test and check-structure, in that order -- build
before the tests, since the harness imports the built runtime, and the registry
before the site, which reads it. It regenerates `mods/registry.json` and
`site/data.js` on the way through, both of which are committed, so a dirty tree
afterwards means one of them had drifted and the fix is to commit it.

`pnpm test:core` finds its own files rather than being handed a list. It used
to name all eight in `package.json`, which meant a new test file ran nowhere
until somebody remembered to add it -- and checking that by hand is not a thing
to rely on.

It was `node --test tests/` for a while, which is the same idea in one line, and
**Node 22 took that away**: positional arguments to `--test` became glob
patterns, so a bare directory is no longer expanded but treated as a file to
run, and the suite dies with `Cannot find module '…/tests'` before a single test
starts. Measured, because neither form works on both:

| node | `--test tests/` | `--test "tests/**/*.test.mjs"` |
| --- | --- | --- |
| 20.20.2 | ok | fails |
| 22.21.1 | fails | ok |
| 24.16.0 | fails | ok |
| 25.9.0 | fails | ok |

`scripts/test-core.mjs` walks `tests/` and hands Node the files, which works on
every version and needs no shell glob. The CI pins `node-version: 22`, which
floats, so this broke on a push that had nothing to do with it. (Node 18 fails
four of them, and did so before this change too.)

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
- **`app.asar` cannot be patched, but it can be read** -- and reading it is how
  the one genuinely new capability in this project was found. Slack's main
  process builds its window options from its own settings:
  `windowVibrancy` true gives macOS `vibrancy: "titlebar"` and Windows 11
  `backgroundMaterial: "acrylic"` with `transparent: true`, and in both cases
  drops the opaque `backgroundColor` behind the page. The flag lives in
  `~/Library/Application Support/Slack/storage/root-state.json`, plain JSON
  outside the archive, so switching it on is a preference and not a patch.
  Measured: with the page's own backgrounds cleared, the window's darkest pixel
  goes 27 -> 43 over an identical backdrop, and an opaque window with no
  `backgroundColor` would have been white.
  **On macOS the ceiling is the material, not the CSS.** `vibrancy: "titlebar"`
  is an NSVisualEffectView: frosted by construction, with a blur and a grey of
  its own, and `transparent: true` is set only alongside Windows 11 acrylic --
  never on macOS. A fully clear window is therefore not reachable from here
  however transparent the page is, and it was worth proving rather than
  assuming: with every dial at zero, no element covering more than 20% of the
  window paints anything at all, and the only other filtered node is Slack's
  split-view handle at `opacity: 0`. What is left is the operating system.
  **But which material is a choice, and it is reachable.** Slack's main process
  registers `EXEC_BROWSERWINDOW_METHOD`, which runs an allow-listed set of
  `BrowserWindow` methods for the page -- `setVibrancy`, `setOpacity`,
  `setBackgroundColor`, `setBackgroundMaterial` are all on it -- and the preload
  exposes it as `desktop.window.callBrowserWindowMethod`. Measured first deciles
  over one wallpaper (which alone reads 3): `hud` 22, `fullscreen-ui` 24,
  `none` 29, `under-window` 33, `titlebar` 43. Slack asks for the frostiest of
  them. `api.slack.desktop.setMaterial` is the narrow wrapper: that one method,
  those five names. No mod ships using it today -- the one it was built for was
  dropped -- but the measurements are why it stays. On a window created opaque
  it succeeds and does nothing (27.3 before and after), so the preference and
  its restart are still what make any of it visible. It must be written *before*
  Slack
  starts, and re-written at every launch since Slack rewrites that file itself.
  `src/loader/slack-settings.ts` owns the file, keeps one backup of the original
  before its first write, and answers only for the keys in `SLACK_PREFS` --
  `api.slack.desktop` publishes that same list, so a key cannot be offered and
  then refused. Anything read when a window is created needs
  `api.slack.restart()`; compare `desktop.get(key)` with `desktop.launched(key)`
  to know whether a restart would change anything before offering one.
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
- **`installLauncher` owns more than the launcher.** It is also what installs
  `LAUNCHER_CSS`, where `.betterslack-toolbar-button svg` gets its 20px. A
  refactor once dropped the `mountUi()` call in `index.ts`: the BetterSlack
  button vanished, every mod's icon drew at its SVG's intrinsic size, and the
  other buttons lost the anchor they position against (`before:
  '#betterslack-control-button'`). `--healthcheck` reports `launcher` and fails
  on it -- it caught nothing because `pnpm test:live` was not run.
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
- **`slack://open?team=<id>` switches workspace**, in place, same document --
  and it is the only way to, from a script. The workspace rail is in the
  document with every workspace in it and measures **zero by zero** in Slack
  4.51, so a click aimed at it lands on the window and reports success while
  nothing moves. The ids are on the rows all the same, in
  `data-rbd-draggable-id`.
- **`[data-qa="channel_sidebar_name_button"]` no longer exists.** The sidebar's
  rows are `[data-qa="channel-sidebar-channel"]`. A selector that matches
  nothing announces nothing, which is why the redactor's list is checked by an
  audit rather than trusted.
- **`slack://user?team=…&id=…` opens a profile**, but not for everyone: an app
  or a conversation with yourself gives a pane that never appears. Try ids in
  turn rather than trusting the first.
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
- **Timings for anything that animates a view change**, measured from the click
  on a channel in the sidebar: `navigation.currententrychange` fires at **9ms**
  (same tick as `history.pushState`), the conversation column starts repainting
  at **50ms** and stops at **291ms**, and a 250ms poll comparing
  `location.pathname` only notices at **286ms** -- after the repaint has
  finished, which is why a poll-triggered entrance reads as a blink rather than
  as a transition. Also: **Slack blocks the main thread for ~100ms after the
  click**, so no frame at all is painted between the two, and the first frame
  anyone sees is the new content at the animation's time zero. An entrance
  therefore has to start from opacity 0; anything that starts at 1 and dips
  paints the new content solid first and flickers. `mods/plugins/motion` is
  where all of this is written down next to the code it decides.
- **Slack's Preferences is a tabbed dialog whose panel really is remounted.**
  `.p-prefs_dialog__modal` is the ReactModal content, `.p-prefs_dialog__menu` the
  vertical rail, and clicking a section adds a fresh `<section>` into
  `.p-prefs_dialog__panel` -- so an `animation` on the panel's child fires on
  exactly the right frame with no trigger at all. Scope such a rule inside
  `.ReactModal__Content`: `.c-tabs__tab_panel--active` is also what the *main*
  workspace area wears, and a rule matching both animates the whole conversation
  column. The Mods panel is the opposite case and needs JavaScript -- it rebuilds
  itself wholesale on every change, so it stamps its body only when the tab
  really changed.
- **`:host-context()` does not work.** Chromium has dropped it, so the obvious
  way for a rule inside a shadow root to follow a class on `<html>` silently
  matches nothing -- the stylesheet is inert and there is no error. Custom
  properties *do* inherit through a shadow boundary (measured: a property set on
  `<html>` read back inside one), so the way to switch shadow-root rules from
  outside is to define or not define a property, not to write a selector.
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

**A plugin writes CSS through two nodes, not one.** `api.css` replaces the
plugin's stylesheet whole -- that is the contract, and it is right, since a mod
that recomputes its CSS on a settings change would otherwise stack copies of it
for ever. `helpers.toggle({ whenOn })`, `helpers.badge` and `helpers.tooltip`
write CSS too, and they used to write it through that same node, so a mod using
both kept only whichever went last. A shipped mod went out that way: it put its
class on `<html>`, drew its indicator, and folded nothing away, because its
indicator stylesheet had overwritten the rules that hide the sidebar. Its tests
passed the whole time -- they asserted on every call the mod made, and the bug
is that only one of those calls survives. The helpers now own
`plugin:<id>:helpers`, covered by `tests/styles.test.mjs`, which carries that
shape as a fixture rather than importing the mod: the mod has since been
dropped, and a regression test that can be deleted along with its subject is not
covering the runtime.

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
of actions along the bottom (`views/` is a file per section, and the primitives
come from `api.ui.kit(doc)` + `api.ui.kitCss` -- the builder used to carry its
own `ui.js` and that is exactly the drift the kit exists to stop). A first
attempt stacked every tool in one scrolling column and it read as a list of
controls in the order they were written, which is the thing to avoid if this is
ever rebuilt again.

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

**Discord Light is Discord Dark's stylesheet with one block changed**, and a
test in its folder fails if the two drift below the palette. Two stylesheets
meaning to be one design come apart the moment a fix lands in whichever file was
open, and the one that misses out is always the one nobody is looking at. Five
things a light palette cannot inherit are variables for that reason --
`--dc-header-shadow`, `--dc-float`, `--dc-float-text` and the two scrollbar
colours: a shadow that has to be a tint rather than a shade, a floating surface
that is the darkest thing on screen in one and the brightest in the other, and a
scrollbar whose thumb and track trade places. A second test refuses any hex or
`rgb()` below the palette at all, white excepted -- the text on the blurple
accent and on the red badge, which is the same colour either way.

The two are honest about coming from different places, and say so in their own
headers: Discord Dark's colours were sampled off a screenshot of the real
client, Discord Light's are Discord's published design tokens by name.

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

**Nothing may touch the document while a module is being evaluated.** The
runtime is injected at document-start, before Slack's markup exists, so
`document.documentElement` is genuinely `null` there. `ui/panel.ts` built its
translator at module scope, `detectLocale` read `lang` off that null, and the
*whole bundle* threw at evaluation -- so the document-start injection failed and
the mods arrived through the loader's re-injection fallback instead, against a
DOM Slack had already half built, which is precisely where both renderer
freezes came from. It was silent for months because the fallback works.

There were two of them, and the second only became reachable once the first was
fixed: `waitForClient` and `dom.waitFor` both called
`observer.observe(document.documentElement, …)`, which throws on `null` for the
same reason. Both now observe `document.documentElement ?? document` -- the
Document node is observable and sees `<html>` itself arrive.

Build translators, read attributes and observe elements lazily or defensively;
assume nothing on the page exists yet.

**`runtime went missing after a navigation, re-injecting` is not that bug, and
is not a bug at all.** It was tempting to blame it for the above; it survived
the fix, which settled it. `boot()` is async and only assigns
`window.__betterslack` on its last line, after themes are in and
`waitForClient` has returned -- seconds later. Slack's load event fires long
before that, the loader looks for the marker, finds nothing and says so. The
re-injection it then performs is a no-op, because `boot()` claims
`window.__BETTERSLACK_BOOTING__` synchronously on the way in. So the line means
"has not finished starting", not "is not there". What tells you a boot really
failed is a `page error` line, which the loader forwards for exactly that
reason.

**`store.ts` resolves `~/.betterslack` once, when it is imported.** A test that
wants a scratch home has to set `BETTERSLACK_HOME` *before* importing it —
`tests/update.test.mjs` does that at module scope, with a comment saying why.
Getting it the wrong way round runs the test against the real home, and the
backup test then wrote its empty fixture over a real settings file. It cost
someone their installed list once; it should not cost it twice.

## Safe mode, and mods that will not start

`pnpm start --safe` applies nothing. So does the next start after a run that
never reported itself healthy: the loader writes `~/.betterslack/booting` before
launching Slack and the runtime clears it with `app.ready` once the panel and
the mods are in, so a marker left behind means the last run did not get there.
This is the escape hatch the two renderer freezes did not have -- the only way
out was killing Slack and editing settings.json by hand.

A mod that throws during `start()` is recorded in `manager.errors` and shown on
its own row, and the count is kept in `settings.modFailures`: **counted before
the attempt, cleared after it**, because a mod that takes the renderer down
never reaches the line that would have recorded it. Two consecutive failures and
it is skipped at boot; switching it off and on clears the count, which is what
the message on the row tells you to do.

## Mod updates are separate from the app's

A mod carries its own version, and `mod-updates.ts` compares the installed ones
against `mods/registry.json` on the default branch. Updating one fetches its
folder through GitHub's contents API and goes through the same install path the
Browse shelf uses, which re-validates the manifest loader-side -- files off the
network are untrusted whichever button asked for them. Before this, a one-line
fix to a theme meant pulling the loader and the runtime with it.

## The panel speaks both languages

`ui/strings.ts` is the panel's dictionary and `tests/i18n.test.mjs` holds it to
the rule mods are held to: en and fr must cover the same keys, everything the
panel asks for must exist, and a bare English sentence left in `panel.ts` fails
the test. It was English-only until now, around mods that were required to be
bilingual.

**The palette is a mod, not the app.** `mods/plugins/command-palette` binds the
shortcut and assembles the list; the runtime only provides the component
(`api.ui.palette`) and a small surface for mods that extend BetterSlack rather
than Slack (`api.app`: the catalogue, enable/install, open the panel, other
mods' commands). Taking a key that belongs to Slack should be something you can
switch off, and the whole thing doubles as the worked example of what the API
can do.

**⌘K, taken from Slack on purpose.** Slack binds it to its quick switcher, but
⌘K is the key everyone reaches for and a palette on a key nobody presses is a
palette nobody uses; Slack's switcher stays reachable from its search field, and
the plugin's own `shortcut` setting puts it back on ⌘⇧K for anyone who
disagrees. The
handler runs in the capture phase, or both open at once. `api.commands.add` is
how a mod gets in without taking a button in the rail.

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

**Every mod has a page**, reached by clicking its name: its icon, its version
and author, its description in the reader's language, a screenshot with a
caption, its README rendered, and its settings. `renderMarkdown` in
`ui/markdown.ts` escapes first and drops a `javascript:` URL; a picture in a
README is fetched from the mod's folder through `manager.asset`, one at a time,
and nothing else is fetched at all. `panel.openMod(id)` -- what `api.app` and
the palette call -- opens that page rather than the row's settings drawer,
which is what it used to do when the settings were all there was.

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
  runtime down with no styling on the failure. This has happened **three times**,
  and every time it was a comment explaining a CSS property by naming it in
  backticks. Write the property in words instead: "sets display flex", not the
  backticked declaration. `tests/requires.test.mjs` fails if a backtick appears
  in there, and typecheck usually gets there first with a baffling
  `',' expected` pointing at the middle of a sentence.
- Mods are distributed through pull requests and reviewed by a human; that
  review is the security model, since plugins run unsandboxed in an
  authenticated Slack tab. `CONTRIBUTING.md` lists what gets rejected.
- Commits and PRs are authored by the repository owner. Do not add AI
  co-author trailers.
- **Never push without asking.** Commit freely -- finish a piece of work, run
  `pnpm check`, commit -- but `git push` is the owner's call every time, and a
  force-push doubly so. A commit is local and can be rewritten; a push is out in
  the world, and this repository's history gets rewritten often enough that a
  push nobody asked for is a push somebody has to undo.
