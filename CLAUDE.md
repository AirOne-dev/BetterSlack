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
install.sh     What a user runs: macOS and Linux
install.ps1    What a user runs: Windows
```

**A user never runs pnpm.** Everything under Commands below is for working on
BetterSlack; installing it is one script that needs nothing installed first.
Keep the two apart in every document -- that separation is the point.

## Commands

**Keep `pnpm start` running the whole time you are working.** Not as a final
check -- from the first minute, in the background, for the length of the
session. Everything this project gets wrong is invisible until it is on screen:
an animation that reads as a blink, a button that never mounted, a selector that
stopped matching, a renderer that has quietly stopped answering. The loader
prints the page's own errors to that terminal, so a mod that threw at boot says
so there instead of hiding in a DevTools window you have to go and open.

**And leave it running.** Somebody is using Slack while you work -- it is their
messaging app before it is your test fixture, and they are being paid to answer
the messages in it. Stopping it is a last resort, not a step in a loop, and the
mistake that makes it a loop is easy to fall into: Slack is launched with
`--remote-debugging-pipe` and the loader holds the descriptors, so a CDP probe
of your own cannot attach while it runs. One question, one stop, one restart --
do that per question and the app is down more than it is up, which is what
happened over one long session here, and the person whose Slack it was said so.

Three rules follow, and none of them is a preference:

- **Never end a step with Slack down.** If you stopped it, the same command
  that stopped it brings it back. Not the next message, not after the report --
  before you do anything else. A client left stopped while you write a summary
  is somebody unreachable at work for as long as the summary takes.
- **`pnpm check`, `pnpm test`, `pnpm build`, `pnpm typecheck` and the whole gate
  need no client at all.** Run them against the running one, as often as you
  like. Only `pnpm test:live`, `pnpm shoot` and a probe of your own take the
  client, and each of those is a decision rather than a step.
- **One probe answers every open question.** Not one probe per question. Write
  the code, let the questions pile up, then ask them all in a single launch --
  and if the answer raises a new question, write down what you would have
  asked and batch it with the next one rather than relaunching.

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

**A tag is not a release, and only GitHub can make one.** `pnpm release` does
everything git can -- bumps `package.json`, writes the changelog, commits, tags
-- and a pushed tag then sits on the releases page as a bare tag with no notes.
`.github/workflows/release.yml` closes that: a pushed `v*` tag has its own
section lifted out of `CHANGELOG.md` and posted as the release notes, so the
changelog is the only place those words are written. It is idempotent, because
the reason to re-run it is that the changelog was rewritten afterwards, and it
takes a tag by hand (`workflow_dispatch`) so a tag pushed before it existed can
still be given its release. The version heading is dropped from the notes: the
release already carries the version and the date.

## Installing is one script, and the checkout is not part of it

`install.sh` (macOS and Linux) and `install.ps1` (Windows) are what a user runs.
`git clone` then one command, with nothing installed first -- not Node, not
pnpm. Everything below was measured while making that true.

**The three installers share one answer about what an install is.**
`scripts/stage-install.mjs` copies `package.json`, `bin/`, `dist/`, `mods/` and
`scripts/node-ok.cjs` into `~/.betterslack/app` and writes `node-path` beside
them. Three installers each with their own list, in three languages, is three
lists that drift the first time one is edited.

**git is not a dependency, and nothing may make it one.** It is one way to get
the folder and that is all: `install.sh` and `install.ps1` never call it -- the
header of each says so -- staging does not, and an install updates itself from
the branch tarball rather than by pulling. `update.ts` reaches for git only
behind `isCheckout()`, which is false for `~/.betterslack/app`, and every one of
those calls fails soft. Verified by unpacking
`codeload.github.com/.../tar.gz/refs/heads/master`: a complete tree with
`install.sh` in it and no `.git`. Most people do not have git, so a step that
needed it would be the one step this installer exists to avoid.

**It is 6 MB because the loader bundle imports nothing but `node:` built-ins**,
so an install needs no `node_modules` at all. That is a claim about the bundle
rather than a fact of nature, so staging *checks* it and refuses to produce an
install whose loader has an import it cannot satisfy -- naming the import. The
failure it prevents is the one this whole installer exists to prevent: a
module-not-found at startup, in a log, where nothing puts it on screen.

**`ws` was a dependency and was never imported.** The loader uses
`--remote-debugging-pipe` and no WebSocket. Removing it is what made the
paragraph above true.

**A Node is chosen by version, never by position on `PATH`.** Sourcing `nvm.sh`
puts nvm's `default` alias in front of everything, and that alias is whatever
the user last pointed it at -- `lts/fermium` on the machine this was found on,
which is Node 14. The loader is modern JavaScript, so an old Node dies parsing
it before running a line, the `SyntaxError` goes to the log, and a double-click
does *nothing at all*. That is the same symptom as a missing Node and as a
refused folder, which is why every launcher here has to tell them apart rather
than assume the last one.

`scripts/node-ok.cjs` is the single judge, used by all three installers and all
three launchers. Two rules shape it:

- **It reads the range out of `package.json`.** Two answers to which Node this
  needs is one answer too many, and the copy nobody edits is the one the user
  meets.
- **It is ES5 CommonJS** -- no arrow functions, no template literals, no `let`.
  It runs on the Node it is judging, including one far too old to be used.
  Anything newer in it and an old Node fails on a syntax error instead of being
  told it is old. Verified against Node 14, 18, 20.18, 22.23 and 23.6 on one
  machine: only 22.23 was accepted, which is what `engines` says.

**Passing that judge is not enough to *build* the checkout, and the two
installers check the second half by running it.** `packageManager` names one
exact pnpm, and that pnpm has a Node floor of its own which is higher than the
app's: pnpm 11 requires `node:sqlite`, added in Node 22.5, while `engines.node`
still admits 20.19 because that is all the loader and the tests need. Measured
on a Mac whose shell node was 20.20.2 -- announced as usable, then
`ERR_UNKNOWN_BUILTIN_MODULE` out of pnpm's own bundle at the install step, with
fourteen newer Nodes sitting unused under `~/.nvm`. So the installers rank
*every* qualifying Node (the shell's first, then newest first) and take the
first one that can print `pnpm --version`, falling back to downloading one.
Writing pnpm's floor down beside `engines` instead would be a second number
nobody bumps when `packageManager` moves.

**A Node that is downloaded is verified before it is unpacked.**
`nodejs.org/download/release/latest-v22.x/SHASUMS256.txt` names the exact file
and its digest in one request, so no version is pinned in a script to go stale
and nothing has to parse JSON on a machine that has no Node yet. Match the
architecture slug anchored at both ends: `darwin-x64` contains the substring
`win-x64`, and the same file lists `win-x64/node_pdb.zip`.

**The launchers read `node-path`; they do not go looking.** A GUI process gets
none of the user's shell PATH. If the recorded Node has gone -- an nvm version
pruned, a Homebrew upgrade -- they fall back to a scan judged by the same
`node-ok.cjs`, staged beside the app for exactly that, and rewrite `node-path`
with what they found.

**corepack no longer ships with Node, and the updater assumed it did.** It was
removed in Node 25: that bin directory holds `node`, `npm` and `npx` and nothing
else. The update path's fallback was `corepack pnpm` -- with a comment saying
corepack ships inside Node, which had been true -- so an install whose recorded
Node is a 25 answered `command not found` and the panel said the update could
not be built here, on a machine that was working perfectly. Reported from a real
one, against a published release.

`packageManagerCommand` tries `pnpm`, then `corepack`, then
`npx --yes <the pinned pnpm>`, and asks **in the environment the install will
actually run in**. A bare `exec` probing `pnpm --version` gets the ambient
environment, which for an app launched from the Dock carries none of the user's
shell PATH, and the answer would then be run with a different PATH entirely. `npx` is beside every
Node there has ever been and fetches the pinned pnpm on demand, which is exactly
what corepack was doing; it is the last rung rather than a probed one, since
probing it means downloading pnpm to ask whether pnpm can be downloaded.
Measured end to end with only a Node 25 on `PATH`: install and build both
complete.

**`install.sh` is not affected but is wasteful there**, and it is worth knowing
before someone reports it as the same bug: `pnpm_ok` simply rejects a Node it
cannot find corepack or pnpm for, so a machine with only Node 25 falls through
to downloading Node 22 -- which does ship corepack. It works; it costs 190 MB
that the machine did not need to spend.

**A failed command's first line is the invocation, not the reason.** `exec`
rejects with `Command failed: <the whole command line>` and the cause on the
lines after it, so taking the first line and replacing it with a sentence of our
own threw away the only useful part -- which is how a missing corepack reached a
user as a shrug rather than as three words they could have searched for.
`describeFailure` takes the *last* thing the command said, since that is where a
tool puts its conclusion, and falls back to the generic line only when it said
nothing at all.

**The in-app updater knows the two shapes apart.** A checkout is replaced by the
new tree; an install is re-staged from it, using the *new* copy's
`stage-install.mjs` rather than the running one's idea of what an install
contains. Handing a staged install the whole source tree would undo what it is,
and every later update would then need a package manager on `PATH` -- which an
install that fetched its own Node has no reason to have. The `exec` calls carry
`dirname(process.execPath)` on `PATH` for the same reason: `corepack` and `npm`
live beside the Node that is running, and nowhere a shell would look.

**The version reaches the loader from `package.json`, through the build.** It
was a constant in `src/loader/index.ts`, which `pnpm release` does not touch, so
it sat at the first release's number while `package.json` moved on. The update
check compares the two: a stale constant reports an update for ever, and
installing it clears nothing.

### The macOS app

**A bundle whose executable is a shell script is not an application**, as far
as the gate on Desktop, Documents and Downloads is concerned. The process macOS
sees is `/bin/bash`, a platform binary with no identity of its own, so the
access is refused outright and there is nothing to grant. It matters because
`api.files.save` writes to `~/Downloads`. Measured with throwaway bundles, in
order:

| bundle | result |
| --- | --- |
| script executable, unsigned | refused |
| script executable, ad-hoc signed | refused |
| script executable + `NSDesktopFolderUsageDescription` | refused |
| Mach-O executable | macOS asks, and remembers |
| Mach-O executable exec'ing the same script | same |

So `Contents/MacOS/betterslack` is compiled from `scripts/launcher.c`, and
execs `Contents/Resources/launch.sh`. Two things follow:

- **The stub explains rather than dying.** Running another program is not
  gated, only reading a file is, so it can still reach `osascript` even when it
  cannot read its own launcher.
- **The grant lasts until the next build.** An ad-hoc signature identifies a
  bundle by its contents, so installing again asks again. That is fine for a
  user who installs once and invisible to anyone iterating on the launcher --
  which is how a working app turned into a silent one mid-session, twice.

The app lives in `/Applications`, which is `root:admin` and group-writable, so
an administrator needs no password; the elevation is attempted **only after** an
ordinary copy has been refused, since asking up front is a password prompt for
something that does not need one. When it is needed, the removal, the copy and
the signing all happen inside the one elevated shell -- split across the two,
the copy would be root-owned and the signature would then fail as the user. And
a path travels through two parsers there: `do shell script` takes an AppleScript
string and hands it to `/bin/sh`, so it needs quoting for both.

The C is a file rather than a string in `build-app.mjs`. It was a template
literal for one revision, and between JavaScript escapes, C escapes and
AppleScript quoting inside one `execl`, nothing would compile.

### Linux and Windows

`scripts/build-desktop.mjs` writes three files under `~/.local` -- the command,
the `.desktop` entry and the icon -- so nothing needs a password and
uninstalling is deleting them. `StartupNotify=false`, because the loader drives
Slack rather than opening a window of its own and the desktop would otherwise
show a busy cursor waiting for one that never arrives. The launcher runs in the
foreground when there is a terminal and in the background when there is not.

`install.ps1` writes `betterslack.cmd` (run it from a terminal, output on
screen) and `betterslack.vbs` (what the Start menu shortcut points at: same
command, no console, output appended to a log). A shortcut aimed straight at
`node.exe` flashes a console on every launch and leaves one open for as long as
Slack runs. The `.vbs` checks the Node *before* launching, because from a
shortcut there is no console for an error to appear in.

Two PowerShell traps, both hit here: splatting the tail of a one-element array
asks for `$a[1..0]`, which is a descending range and hands the array back
*reversed* rather than empty; and PowerShell 5.1 still defaults to TLS 1.0, so
`Invoke-WebRequest` to nodejs.org fails with an error that says nothing about
protocols.

**Linux and Windows are written and reviewed, not executed.** Only macOS has
been run end to end.

**pnpm, not npm, and `allowBuilds` is the key that does it.** esbuild fetches
its platform binary in an install script, and pnpm refuses to run one unless it
is allowed by name -- without that, every command that touches the bundler
fails on a fresh checkout with `ERR_PNPM_IGNORED_BUILDS`, and so does
`install.sh`. Measured against the pinned pnpm 11.5.2 in a clean store, one key
at a time:

| `pnpm-workspace.yaml` | `pnpm install --frozen-lockfile` |
| --- | --- |
| `allowBuilds: esbuild: true` | succeeds |
| `onlyBuiltDependencies: [esbuild]` | `ERR_PNPM_IGNORED_BUILDS: esbuild` |
| both | succeeds |

So `allowBuilds` is load-bearing and `onlyBuiltDependencies` alone is not, which
is worth knowing before tidying either away: taking `allowBuilds` out shipped a
release whose install could not build, and pnpm quietly rewrote the key as
`set this to true or false` -- not a boolean, so the builds stayed ignored and
the file still *looked* like it said something. Both are kept, because
`onlyBuiltDependencies` is pnpm's own documented spelling and a later version
may prefer it.

The file also needs a `packages` field (`- .`, this one repo): pnpm 11 treats
the mere presence of a `pnpm-workspace.yaml` as a workspace and aborts with
`packages field missing or empty` if it is absent.

```bash
pnpm check             # the whole gate, in one command -- run this before pushing
pnpm install           # once; pnpm, and the lockfile is committed
pnpm new-mod plugin my-plugin "What a user gets"   # a mod that already passes
pnpm release patch     # bumps, writes CHANGELOG.md from the commits, tags
pnpm test:live         # boots real Slack and checks what loaded
pnpm build             # both bundles + dist/download.mjs
pnpm start             # launch Slack with mods, from this checkout
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
- **A mod can want more than one frame**, and six do: the member column and
  the dialog it opens, the palette empty and filtered by `/` and `@`, the
  composer under and over its limit. An entry carries `frames: [...]`, each inheriting the
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
format is not listed Writable). Measured on one frame: 472 kB as PNG, 132 kB as a
1400-wide JPEG, 160 kB as WebP at the full 3200x2000. The retina resolution
costs 28 kB, so there is no downscale and every picture is 2x. Quality 78 is measured as well -- 70 starts showing on
Slack's text, 85 costs 28 kB for nothing visible.

## Photographing somebody's real Slack

`mods/plugins/demo-mode/redaction.js` replaces everything on screen that
belongs to anybody: names, faces, messages, channels, files, links, the
workspace's name. It substitutes rather than blurs -- a blurred name is still a
name that was on the screen -- and derives every replacement from a hash of the
original, so the same person is the same invented person in every frame and two
runs produce the same picture.

**It is a mod, and the recipe bundles it.** `shoot-mods.mjs` builds that file
with esbuild and evaluates it in the page, rather than keeping a copy in
`scripts/`: two implementations of one idea means the one users run is the one
nothing checks. The recipe is therefore Demo Mode's test against a real Slack,
and anybody taking their own screenshots hides exactly what the repository's
hide.

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
- **The redactor's own words have to be excluded from the audit too.** The
  invented address ends `?ref=slack-digest&source=weekly`, and a run failed on
  the word "source" because a real link on the same screen had also contained
  it. A false alarm stops a shoot exactly as dead as a real leak, so everything
  this file writes is in `VOCABULARY`.
- **"It is only digits" is not "it is nobody's".** A badge count and a year
  belong to nobody and inventing them makes the screen look wrong; a six-digit
  order reference is a customer's. Four digits or fewer are kept, longer ones
  are replaced digit for digit so the bubble keeps its width. Found by the
  audit, after two of them sat alone in message bubbles through every sweep.
- **An unfurl is wider than `.c-message_attachment`.** Slack draws a link
  preview's title, its breadcrumb and its body in `.p-mrkdwn_element` outside
  the attachment box -- with a real name in a `<b>` inside one, which is how
  this was found.
- **The palette lists Slack and BetterSlack through one class**, and the badge
  on the right is what tells them apart. Getting it wrong fails both ways: a
  conversation left alone is somebody's name in a public screenshot, and an
  action swept is a row of nonsense in the catalogue. A row badged Slack is one
  of the palette's own doings -- its title is our copy and survives, its second
  line names a real conversation and does not.
- A mod that reads the screen once and decorates what it found -- the syntax
  highlighter -- has to be switched off and on after the sweep, or what it
  decorated is the text the sweep has replaced.
- **A frame may not depend on whose Slack is being photographed.** Every frame
  stages something a client always has. The palette's `>` message search has
  results only if the words are in *this* workspace, and there is no word that
  always is: `>ok` came back empty and failed the run, so there is deliberately
  no frame for it.
- **`shoot.mjs` files only what the run took, and clears up after itself.**
  `site/shots/mods` is also where `pnpm site` puts a copy of every committed
  screenshot, so the folder is full before a run starts: filing whatever is in
  it would have `--only=one-mod` announce the whole catalogue, and a run that
  failed its audit before taking a single picture announce it too. It skips
  `<name>-2`, `<name>-3` -- those are the one-picture-per-attached-window frames
  the loader writes whenever `BETTERSLACK_SHOT` is set, and read back as frames
  they land as `screenshot-2.webp` beside the real ones, where no manifest names
  them, nothing draws them and nobody deletes them. And once a named frame is
  filed into the mod's folder the working copy here is deleted: `pnpm site`
  brings it back as `<id>-2`, which is the only name the page asks for, so a
  `<id>-<name>.webp` left behind is a byte-identical second copy that no
  manifest names and that the published folder pays for.

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
- `name`, `group`, `title`, `signature` and `since` are required. So are one
  paragraph of prose and one fenced example -- the parser refuses a file without
  either, because a reference that shows an example for two thirds of what it
  lists teaches the reader to distrust the third.
- **`since` is the release the entry arrived in**, or `unreleased` for one that
  is on the default branch and in no release yet. It is not decoration: it is
  what makes a mod's minimum BetterSlack computable, and the section below
  depends on every entry having one. `pnpm release` turns every `unreleased`
  into the version it cuts, so nobody has to remember to.
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
  `key | type | value | label | options`. `text`, `textarea`, `number`,
  `boolean` and `select`; `label` defaults to the key, and `options` is a
  comma-separated list that only means anything for a select. **`\n` in a
  default is a newline**, since the line it is written on cannot contain one --
  without that, `renderMarkdown`'s sample arrived as a single line with the
  escapes in it, so the preview showed no headings, no list, and printed
  `\n` for everyone to read. `textarea` exists for the same defaults: a `text`
  control is an `<input>`, which collapses a newline to nothing.
- **The controls are the only place to type.** Three previews carried a
  `<textarea>` of their own beside their output, which was a second input after
  the knobs below were already one, and the two never agreed about which held
  the source. The exception is `kit.code`, where the editor *is* the component.
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
    toolbar button's icon is given a size. Without it an SVG with no intrinsic
    size lays out at 300x150, in the client as on this page.
- **`tests/slack-fixture.mjs`** holds the Slack-shaped fragment, so the real
  `addToolbarButton` and `addMessageAction` have the containers they look for.
  It stays a flat list of empty containers, which is all jsdom needs; the page
  moves those same nodes into Slack's layout and fills them (`dressChrome`), so
  the answer to "where did my button go" is a client with a ring on it rather
  than five dashed rectangles. Avatars keep their real `src` in the **fragment
  of a 1x1 transparent SVG**: `userIdFromMessage` and Member Sidebar read the
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
  stage, and the layout does not punish them for forgetting. Nothing in the rail
  may `flex-shrink` either, or a second button in the strip squashes the
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
as JSON rather than as JavaScript that happens to parse. Aliases are resolved at
build time (`js` -> `javascript`, `yml` -> `yaml`) and **an unknown one fails the
build**, because the alternative is silent: a skipped block renders as flat grey
text, which reads like a block that has no highlighting rather than like a
mistake. The label above the block keeps what the writer typed, since `JS` reads
better than `JAVASCRIPT`.

**The guide comes first and the page opens on it.** Landing somebody on
`tools.highlight` was an accident of the ordering, not a decision: a reference
is what you come back to, a guide is what you need the first time. The tab in
the bar says *Doc* for the same reason.

**One file, one panel at a time.** Every entry is a `<section class="panel">` in
that single document and the list on the left switches between them; the page
itself does not scroll. One file per entry would be the wrong shape: a reference
is read by jumping around it, and a jump that costs a page load loses the theme
you picked, the arguments you set and your place in the list.

**The Pages job installs the dependencies**, because bundling
`site/api-previews.js` is esbuild. Without them every push fails on
`Cannot find package 'esbuild'`.

**Its `paths:` filter has to cover everything the page is generated from** --
`docs/api/`, `docs/guide/`, the preview renderers and the TypeScript they are
cross-checked against, not just `site/**` and `mods/**`. A filter that misses
one of those does not run the job at all for that change, so the drift check
below is silent for exactly the change it exists to catch.

**The mark is `assets/mark.svg`, and everything else is made from it.**
`site/mark.svg` is a copy (the site is published on its own and cannot reach
`assets/`), `assets/icon.icns` is built by `pnpm icon`, and the client carries
the same shapes inline in `src/runtime/ui/mark.ts` -- **one** copy, read by both
the launcher in Slack's rail and the panel's own header, because a mark pasted
into whichever file needed it next is how a redraw ships in one place and not
the other. `tests/mark.test.mjs` compares the shapes across all three files and
fails if a fourth copy appears in the runtime. `scripts/build-icon.mjs` rasterises
the ten sizes `iconutil` wants, through `rsvg-convert`, ImageMagick or headless
Chrome, whichever is on the machine -- a committed `.icns` with no recipe means
redrawing the mark leaves the app wearing the old one with nothing to say so. It
is not part of `pnpm check`: an icon changes when somebody redraws it.

The mark has four colours of its own rather than taking `currentColor`, so the
launcher cannot dim with the icons beside it on hover: there is no single tint to
dim. `LAUNCHER_CSS` does that with opacity instead, which is the only reason that
rule exists.

`site/cover.webp` embeds the mark and is regenerated by hand -- the recipe is in
the comment at the top of `scripts/cover.html`, and the mod count in that file
is written by hand, so it goes stale on its own.

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

`pnpm test:core` is `scripts/test-core.mjs`, which walks `tests/` and hands Node
the files it finds. Two reasons it is a script rather than a line in
`package.json`.

A list of filenames means a new test file runs nowhere until somebody remembers
to add it, and checking that by hand is not a thing to rely on.

And there is no one-liner that works everywhere. Positional arguments to
`--test` are glob patterns from Node 22 on, so a bare directory is not expanded
but treated as a file to run, and the suite dies with
`Cannot find module '…/tests'` before a single test starts. Neither form works
on both:

| node | `--test tests/` | `--test "tests/**/*.test.mjs"` |
| --- | --- | --- |
| 20.20.2 | ok | fails |
| 22.21.1 | fails | ok |
| 24.16.0 | fails | ok |
| 25.9.0 | fails | ok |

An explicit list of files works on every version and needs no shell glob, which
is what the script produces. The CI pins `node-version: 22`, which floats -- so
a change in Node breaks the build on a push that has nothing to do with it.

**The floor is Node 20.19+, 22.13+ or 24+**, and it is jsdom's: the harness uses
it, and it `require()`s an ES module. `package.json` states that range. Four
tests fail below it.

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
- **At a cold start the URL names a workspace the client is not showing.**
  Measured with three workspaces signed in: `location.pathname` read
  `/client/T0BQ89Z4L4F/C0BQ8AG3771` while the client had drawn thirty-seven
  avatars belonging to `T025V5WN2` and a conversation from it, and the two
  stayed apart until the user navigated by hand. Slack restores the view before
  it settles the address, so anything reading the URL at boot works against the
  workspace the user *left*: the wrong token, and a member list showing the one
  person that workspace admits to -- yourself.

  The page is its own witness. An avatar URL carries the workspace
  (`<host>/T…-U…-<hash>-<size>`), and every message Slack renders carries its
  channel in `data-msg-channel-id`. `currentTeamId()` in `web-api.ts` trusts the
  URL whenever it can and overrules it only when its workspace appears nowhere
  in what has been drawn *and* another one does -- exactly the stale case and
  nothing else. `api.slack.currentChannelId()` prefers the drawn channel the
  same way. **No mod should parse that URL itself**; three did, and all three
  were wrong at boot.

  **A route is not a channel, and the pattern has to be case-sensitive.** The
  third segment is a conversation id only when it is an uppercase `C`, `D` or
  `G` id; Slack's own views are lowercase words -- `later`, `dms`,
  `activity-inbox`, `unified-files`, `platform`, `threads`. Read with a
  case-insensitive `[A-Z0-9]+` they all came back as channels, so
  `currentChannelId()` answered `LATER`, and the member column asked Slack for
  the members of it on every one of those views and logged `channel_not_found`
  each time. `tests/slack-routes.test.mjs` holds the runtime and the harness to
  the same pattern.

  **"Which conversation" and "is this a conversation at all" are two
  questions.** The drawn-channel fallback answers the first and must not be
  asked the second: Fils de discussion, Brouillons et envoyés and Activité all
  draw messages belonging to a dozen channels, so it says "a channel" in a view
  that has none. The address answers the second honestly even at a cold start --
  the id may be stale, but the shape of the view is not.
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
  second freeze of exactly that shape. `keepMounted` asks only that its node be
  *somewhere before* the anchor, never that it be the immediate previous
  sibling: every control-strip button defaults to
  `before: '#betterslack-control-button'`, and with two of them the strict form
  has each shoving the other aside, forever, inside a MutationObserver callback.
  Every DOM touch -- move as well as insert -- counts toward the give-up limit,
  so no branch of that callback can spin.
  Covered by `tests/mount.test.mjs`.
- **When Slack freezes, `Debugger.pause` names the loop** -- but only if
  `Debugger.enable` was sent *before* the thread got busy; enabling it
  afterwards never takes, and comes back empty.
  `BETTERSLACK_DIAGNOSE=1` does both, and prints what the client looks like at 3s,
  8s and 16s. `BETTERSLACK_NO_BOOTSCRIPT=1` forces the runtime in against a
  finished document, which is what made the freeze reproducible every time
  instead of one boot in five. `sample <renderer pid>` confirms it is JS rather
  than layout: V8 frames under `MicrotasksScope`.
- **Plugins start only once `.p-client_container` exists** (`waitForClient` in
  `manager.ts`); themes go in immediately, since CSS cannot loop. The runtime is
  injected at document-start on a fresh navigation *or* straight into a page the
  loader caught mid-boot. In that second case mods must not start against a
  half-built DOM: mount observers fire on every node Slack adds while it
  renders, and the microtask queue never drains. The renderer blocks outright:
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
- **A mod can have a whole view of its own, and `api.slack.addView` is it** --
  the tab in `.p-tab_rail__tab_menu` beside Accueil and Activité, the page over
  `.p-client_workspace__tabpanel` -- the whole panel, channel sidebar included,
  because Activité and Fichiers replace that too and a view that leaves it
  there is a page with somebody else's furniture down its side -- one tab lit
  at a time, and clicking another of Slack's tabs to leave.

  **What is under a view is hidden, never merely covered**, and this is the
  part that costs somebody something if it is got wrong. Covered, Slack's
  conversation stays mounted, sized, and as far as Slack is concerned on
  screen, so a message arriving in the channel behind the view is marked read
  and the unread is gone. `display: none` on the panel's other children instead
  -- and Slack's virtual list then renders nothing at all, measured: thirteen
  messages in the document before, zero while the view is open, thirteen again
  on the way out, with a half-written message still in the composer. Written as
  `:has(> .betterslack-view)` on the panel so it stops applying when the view
  unmounts, with no restore step to get wrong. Three things it knows that a mod should not have to. A rail entry
  is a `button.p-tab_rail__button.c-tabs__tab` inside a `p-autoclog__hook`
  wrapper, with `--active` on both classes and `aria-selected` marking the one
  you are on -- borrowing those classes is what makes the entry follow every
  theme. That menu is a descendant of a `.c-coachmark-anchor`, so the entry
  goes in through `keepMounted`, which gives up rather than looping. And
  Slack's own tab has to be put out by hand, because the route has not changed:
  its classes come off on open and go back on close, which holds because Slack
  re-renders the rail on navigation and navigation is what closes the view.
- **`.p-view_contents--primary` is `position: relative`, and the conversation
  inside it sits at `z-index: 201`.** So a mod drawing a whole view -- one that
  covers the conversation the way Activité does, with the rail and the sidebar
  still live beside it -- pins itself to that pane's inset and has to stack
  *above* 201. Below it the view is there, correctly sized, and completely see
  through, which reads as a stylesheet that did not load. Stay well under
  Slack's own modal overlay at 1053, or `api.ui.confirm` opens behind the view
  that asked for it.
- **`.p-client_workspace__tabpanel` is a named-area grid** (`"…--sidebar
  …--primary"`) whose column widths carry the resizable sidebar. Do not override
  its template. To add a column, flip `.p-view_contents--primary` to
  `flex-direction: row` and append to it -- **scoped to a pane that is actually
  holding your column**, with `:has(> #your-column:not([hidden]))`. That pane is
  not only the conversation: Répertoires, Fils de discussion, Brouillons et
  envoyés and Appels d'équipe all render into it, and unlike a channel they
  stack a header *above* their content. Unconditional, that one line laid the
  header down the left of each of them -- measured on Répertoires in a
  2560-wide window, a 52px header became a 1631px column with 243px of content
  beside it, which is four of Slack's own views broken by a mod that only ever
  meant to touch channels. `:has()` is supported in Slack 4.51 (measured:
  `CSS.supports('selector(:has(> div))')` is true), so the layout can travel
  with the column rather than with the mod being switched on.
- **The member list is a modal**, opened from `[data-qa="avatar_stack"]` in the
  channel header. Slack has no persistent member pane to restyle.
- **A reaction is `[data-qa="reactji"]`**, one button per emoji, carrying
  `data-stringify-emoji` (the shortcode, which is the same name in every
  language) and `.c-reaction__count`. The bar around them is
  `[data-qa="reaction_bar"]`. **Who reacted is not in the DOM**: Slack builds
  that as a tooltip when you hover, in the reader's language and with names
  rather than ids, so a mod can know the emoji and the count honestly and
  nothing else.
- **`[data-qa="message_sender"]` holds the name twice on some messages** --
  measured as `Ada LovelaceAda Lovelace :`, and once on others -- because Slack
  draws a second copy for screen readers. Anything comparing it across renders
  sees a rename every few seconds from somebody who changed nothing. Read
  `.c-message__sender_button` and treat the result as a label; a display name
  that is *compared* has to come from `users.info`.
- **The sidebar's section headings are `.p-channel_sidebar__section_heading`**,
  and they hold whatever the person who made the section typed.
- **`.p-resizer` is Slack's drag handle, and it can be borrowed.** Measured on
  the channel sidebar's: 8px wide, `position: absolute`, `cursor: col-resize`,
  `z-index: 1000`, transparent, `role="none"` and no tab stop, positioned by
  `left` rather than laid out -- a handle that took space would move the pane by
  its own width. Wearing `p-resizer p-ia4_client__resizer` means Slack's
  stylesheet draws it, so it follows every theme and hover state with no CSS of
  our own; `--sidebar` is the one modifier to leave off, since it also positions
  it against the channel list.
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
- **There is no `[data-qa="channel_sidebar_name_button"]`.** The sidebar's
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
- **A message timestamp on that link highlights the message.**
  `slack://channel?team=…&id=…&message=<ts>` routes in place *and* flashes the
  message it lands on, the way Slack's own search results do — measured against
  4.51, including across workspaces. `api.slack.openMessage` wraps it, and takes
  the team, because search answers across every workspace you are signed into
  and a link built without one lands on a channel id the current client has not
  got.
- **`conversations.history` answers for an `xoxc` token**, and it carries two
  things the screen cannot: `edited: { user, ts }` -- who rewrote a message and
  when -- and `reactions: [{ name, users, count }]`, where `users` are **ids**.
  So who took a reaction back is knowable through the API and not through the
  DOM, where Slack only says it in a hover tooltip, in the reader's language,
  with names. It answers a page with `has_more`, so a message older than the
  page is outside the window and not deleted -- treating the two the same
  empties somebody's history into a log every time they open a busy channel.
- **`client.counts` is where you have been, in one request.** It is what Slack's
  own client asks for at boot, and it answers a record per conversation:
  `last_read`, `latest`, `has_unreads`, `mention_count`. Measured: 52 channels
  in one answer on a live workspace. It is the recency the desktop client sorts
  by and it is shared across devices — but `last_read` only moves when there was
  something new to read, so a quiet channel you open every morning stays at the
  bottom of it for ever. The command palette therefore orders by its own
  remembered list first and by `last_read` under it.
- **A status can be set from a mod.** `users.profile.set` is allowed for an
  `xoxc` token — verified by reading a real account's status, replacing it,
  reading it back and restoring it. The whole profile goes as one JSON string
  under `profile`; `status_text` as a field of its own is accepted and ignored.
  `status_expiration` is a unix time in seconds, zero for "until I clear it".
  `users.setPresence` (`away` / `auto`), `dnd.setSnooze` (`num_minutes`),
  `dnd.endSnooze` and `conversations.mark` (channel plus the `latest` timestamp
  out of `client.counts`) all exist as well.
- **`search.modules.messages` answers conversations, not messages.** An item is
  `{ iid, team, channel, messages }` and the match is `messages[0]`:
  `{ ts, user, username, text, permalink, extracts, blocks }`. **`text` is empty
  on anything an integration posted** — measured, every Grafana alert in one
  workspace — and the words are in `attachments[].fallback` or in the blocks, so
  a row built from `text` alone reads "(no text)" eight times over. What comes
  back is Slack's own mrkdwn as well: `<url|label>`, `&amp;`, `*bold*`,
  `:shortcode:` and blockquote runs all have to come off before it goes on one
  line.
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
  leftover `ReactModal__Overlay` (z-index 1053) from Slack's own dialog swallows
  every click aimed at the profile pane, which reads as "trusted clicks do not
  work". `document.elementFromPoint(x, y).closest('[data-qa]')` before clicking
  says whether the point reaches what you think it does. The harness can
  dispatch a trusted Escape, which is what dismisses that overlay -- a synthetic
  one does not.
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
- **A status emoji cannot be drawn from its shortcode alone**, and the three
  things that make it possible were all measured against a live client:
  `emoji.list` answers with the workspace's **custom** emoji only -- fifteen in
  the workspace this was measured in, with `coffee` and `tada` absent -- and
  some of its values are `alias:other-name`, chains that have to be followed.
  Slack draws every emoji as an `<img>`, standard ones included, from
  `a.slack-edge.com/production-standard-emoji-assets/16.0/apple-small/<codepoint>@2x.png`
  -- the **codepoint**, so a name builds no URL. But each of those images
  carries `data-stringify-emoji`, which *is* the name, so Slack's own DOM is a
  name-to-image table for the set the workspace actually uses.
  `api.slack.describeStatus` takes all three in order: what Slack sent with the
  profile (`status_emoji_display_info`), then `web.emoji()`, then what is on
  screen. A name none of them knows draws no emoji and keeps its sentence --
  never the raw `:name:`, which reads as a rendering that failed.
  `emoji.list` with `include_categories: true` also answers with nine
  categories of standard **names**, which is a list of what exists and still not
  a way to draw any of it.

  **So the table is harvested rather than fetched.** `data-stringify-emoji` is
  on every emoji Slack draws, standard ones included, beside the `src` it drew
  it with -- so collecting the pairs off the screen and keeping them builds the
  name-to-image table nobody publishes, and it fills itself as the client is
  used. An emoji seen once is one a mod can draw for ever after. History does
  this, capped and persisted; without it a log of messages is a log of
  `:slightly_smiling_face:`, and `textContent` on a message body drops every
  emoji outright, because an image has no text.
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
  painted from the same reading, on every change. Read once at mount from
  Slack's screen-reader label, it says whatever was true when the strip happened
  to be built -- and a green dot next to "Absent(e)" is worse than either being
  wrong alone.
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
  **`--large` is the only modifier Slack styles**, and its one rule is
  `max-width: 400px`; `--small` has no rule at all, which is why a long status
  ran off the edge of the window in a single line where Slack's own wrapped.
  Read out of the live stylesheet -- `site/slack-context.css` had invented a
  `--small` with a smaller font, so the docs page was not showing what the
  client shows.
- **A tooltip's global listeners live only while it is showing.** `keydown`,
  `scroll` (capture) and `resize` are registered in `show()` and removed in
  `hide()`, because `attachTooltip` is called *per element* and some callers
  build a great many: `statusNode` attaches one per row and a member column
  redraws on every channel change. Registered for the life of the trigger
  instead, four channel changes left **38 capture-phase scroll handlers on
  `window`** with nothing to remove them, on a page that scrolls constantly.
  Found by patching `addEventListener` in a live client and counting -- a
  MutationObserver sees nothing here, because nothing is mutating. One tooltip
  is visible at a time, so there is at most one set of these and usually none.
- **A real pointer cannot photograph a tooltip.** `shoot`'s `hover` moves the
  pointer and captures in the same breath, and the tooltip is 150ms behind it,
  so the frame always comes back empty. Clicking is worse: `mousedown` is one of
  the things that hides one. Dispatch a synthetic `mouseenter` and read the DOM
  -- the warning above is about *Slack's* tooltip code, and this one is ours.

## The plugin API

**[docs/api.md](docs/api.md) is the reference — keep it in step with the code.**
Adding a helper or changing a signature without updating it, with an example, is
an incomplete change. [docs/guide/](docs/guide/) is the human entry point --
three pages, install / a plugin / a theme, and the site's Doc tab is built from
that folder -- and [docs/themes.md](docs/themes.md) holds the CSS knowledge.
[docs/getting-started.md](docs/getting-started.md) points at the three and holds
nothing of its own: one walkthrough written twice is one that goes wrong twice.
All of it is part of the same contract.

Shape of it:

- **`api.helpers.cache(name, { keys })` is stale-while-revalidate, persisted.**
  Both mods that list people asked Slack, waited, then drew -- and the answer is
  nearly always the one from last time, so the waiting confirmed what was
  already known. `swr` hands back what is stored, synchronously, goes to the
  network anyway, and calls back **only when the answer differs**: an unchanged
  list never repaints, a changed one does not stay wrong. Measured live on a
  member column: 805ms to show anybody, 81ms from the cache.

  It is written through `api.settings`, which is the file the loader reads at
  every launch -- so `keys` is not decoration. A cache that grows without limit
  is a slower start than the network it replaced. The member column keeps twelve
  channels of compact rows; the palette keeps four workspaces.
- `api.helpers` — the first thing to reach for. `toggle` (persisted flag + a
  class on `<html>` so behaviour is pure CSS), `hotkey` (`mod+shift+f`, with a
  `when` guard that gates the *match* so an inapplicable shortcut does not
  swallow the key), `mount`, `each`, `badge`, `tooltip`, `copy`, `iconButton`,
  `field`, `section`, `debounce`.
- `api.slack` — Slack's chrome: `addView` (a whole view, with its tab in the
  rail), `addToolbarButton` (controlStrip / composer /
  channelHeader, with `before` to sit above another button), `addMessageAction`,
  `addProfileButton`, `describeMessage`, `userIdFromMessage`,
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

**One hover per target.** `api.slack.statusNode` attaches the status tooltip
itself -- the emoji, the sentence, and when it runs out, which is what Slack's
own sidebar shows. A caller that has made the status into a control passes
`tooltipOn` (the element the pointer is really aiming at, since a 15px picture
leaves its padding silent) and `hint` (what clicking does, as the last line).
The strip in Slack's rail had its own tooltip on the button as well, so one
emoji opened two popovers. The order inside is the sentence, then the action,
then the emoji's own name **last** -- the name is there so a picture nobody
could draw is still findable, and it says nothing at all to a reader who can see
the picture.

**A plugin writes CSS through two nodes, not one.** `api.css` replaces the
plugin's stylesheet whole -- that is the contract, and it is right, since a mod
that recomputes its CSS on a settings change would otherwise stack copies of it
for ever. `helpers.toggle({ whenOn })`, `helpers.badge` and `helpers.tooltip`
write CSS too, so **the helpers own a node of their own**, `plugin:<id>:helpers`.
Sharing one node means a mod using both keeps only whichever wrote last -- it
puts its class on `<html>`, draws its indicator, and folds nothing away, because
the indicator stylesheet has overwritten the rules that hide the sidebar. Tests
that assert on every call the mod makes pass throughout, since the bug is that
only one of those calls survives. `tests/styles.test.mjs` covers it, and carries
that shape as a fixture rather than importing a mod: a regression test that can
be deleted along with its subject is not covering the runtime.

When two mods want the same block, it belongs in the API, and the mods get
refactored onto it in the same change. Five things were lifted that way after an
audit of every plugin, and each one had been written two or three times:

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
live through `api.css`, so **the preview is Slack**. Its window is one narrow
column of controls, deliberately: fragments of Slack drawn inside it would be a
worse copy of what is already on screen, for half the width.

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
come from `api.ui.kit(doc)` + `api.ui.kitCss`, never a `ui.js` of its own --
that drift is what the kit exists to stop). Do not stack every tool in one
scrolling column: it reads as a list of controls in the order they were
written.

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
**A theme can have settings, and still runs no code.** A field in its `mod.json`
carries `cssVar` naming a custom property; the runtime writes
`:root { <cssVar>: <value> }` into a `theme:<id>:vars` layer created after the
theme's own, so the value wins on order rather than on specificity. The theme
reads nothing and the panel does the writing -- which is the whole point, and
why this is not the `script` field below wearing a different hat.

Two things it would half-work without, both of which cost a repaint that only
covers some of the client:

- **The legacy families take bare triplets.** `--sk_*` and `--dt_color-plt-*`
  want `r, g, b`, and a `var()` holding a hex parses there, paints nothing and
  reports nothing. So a colour setting also writes `<cssVar>-rgb` as a triplet,
  and a theme points its legacy tokens at that. Terminal does.
- **A theme must not write a colour out by hand.** A tint written as a literal
  `rgba(53, 224, 127, …)` is a tint a colour chosen in the panel never reaches:
  the setting arrives at the tokens and at nothing else. Terminal derives all of
  its from `color-mix(in srgb, var(--term-green) N%, transparent)`, and a test
  fails the theme if a literal comes back.

Removing the theme removes its variables with it -- left behind they would paint
a theme that is off, and beat the next one, since they are written after every
theme's stylesheet. Changing one repaints rather than re-applies: the stylesheet
has not changed, only the handful of properties on top of it.

- **A theme never gets its own way to run code.** Behaviour belongs in a plugin,
  which already has an API, a lifecycle and a consent step; a second, weaker
  model beside it would be another surface to keep in step and another dialog to
  explain, for something plugins do.

## The design system, twice

Inside the client, **borrow Slack's classes** -- the Mods panel wears
`.c-dialog` / `.c-button` and follows every theme for nothing. Its fields do
too: `.c-input_text` for every text and number input, and `.c-input_select` for
a select. Two things that only show up once you try it:

- **Slack's select is not a `<select>`.** It is a bordered button carrying
  `.c-input_select__selected_value` and `.c-input_select__chevron` that opens a
  `c-menu`, which is why `panel.ts` has a `selectButton` helper rather than an
  element. A native dropdown is drawn by the operating system, so on a dark
  theme it opens as a white rectangle in the middle of a dark dialog.
- **Both of those classes carry `margin: 0 0 20px`**, because in Slack they are
  form fields stacked in a column. Undoing it needs the class written **twice**
  (`.betterslack-search.betterslack-search`): Slack's stylesheet loads after
  BetterSlack's, so one class ties on specificity and loses on source order --
  measured, the field kept the 20px as a gap under the toolbar.
- **Slack's focus is a halo, and the panel does not use it.** The rule is two
  stacked shadows -- `0 0 0 1px` plus `0 0 0 5px` at 30% -- with the border set
  transparent underneath, so what is left is a glow floating where the edge was.
  On a form of one field at a time that reads as attention; on a toolbar of two
  controls it reads as a light left on. The border shows focus instead: already
  there, already animating over the same 80ms, and still visible to anyone
  arriving by keyboard, which is the one thing removing a focus indicator may
  not cost. Doubling the class is needed here too -- `.c-input_text:focus`
  scores a class and a pseudo-class. Anywhere else
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
fine. `boot()` therefore claims `window.__BETTERSLACK_BOOTING__` synchronously.
The symptom is a theme gallery that comes up blank, with the answers delivered
by the loader and the same number of timeouts in the page.

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

There is a third, and it is `document.head`: `StyleManager.anchorFor` read
`querySelector` off it, which is `null` at document-start, so `boot()` threw
before a single stylesheet was written -- seen twice in four launches of a real
client, printed as `boot failed TypeError` and then covered up by the same
re-injection fallback. `set()` now holds the node and attaches it through the
ordinary anchor path once a head exists, so the layer order still holds.
`tests/styles.test.mjs` builds a document with no `documentElement` at all and
watches the stylesheet land.

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

## The start screen

`ui/splash.ts` covers the whole client from `boot()` until the last plugin has
had its turn. Between those two moments Slack draws itself, a theme repaints it,
and buttons appear one at a time as their mods start; each of those is correct
and the sequence looks like something going wrong.

`manager.applyInitial(onProgress)` reports the mod it is **about** to start, so
the name on screen when nothing moves again is the one that is stuck -- which is
the difference between "it is slow" and "it is that mod".

**The animation is `assets/loader.webm`, drawn by the repository owner.** VP9
with alpha, which Chromium plays and composites over whatever the splash's
background is. Four things about it that were measured rather than assumed:

- **It is delivered over the bridge, not bundled into the runtime.** The
  renderer bundle is a string run at document-start on *every* navigation and
  its own header says it must be cheap; ~95kB of video in it would be a
  decoration overruling that. `scripts/build.mjs` inlines the file into the
  loader bundle instead (`loader: { '.webm': 'base64' }`), the page asks for it
  with `app.art`, and the still mark is what is on screen for the few
  milliseconds in between -- and what stays if the answer never comes.
- **Slack's policy allows it.** Its CSP names `base-uri`, `object-src` and
  `script-src` and no `default-src`, so media is unrestricted: `data:` and
  `blob:` video both load and both decode the alpha. `data:` is used, since it
  needs nothing revoking afterwards.
- **Scale premultiplied, or the edges go dark.** The source is 848x848 and 2.4MB;
  rescaling it with plain `scale` bleeds black out of the transparent pixels and
  every shape comes back with a grey fringe, which is invisible on a dark theme
  and obvious on a light one. To regenerate:

  ```bash
  ffmpeg -c:v libvpx-vp9 -i "logo loader.webm" \
    -vf "format=rgba,premultiply=inplace=1,scale=192:192,unpremultiply=inplace=1,format=yuva420p" \
    -c:v libvpx-vp9 -pix_fmt yuva420p -auto-alt-ref 0 -b:v 0 -crf 40 -an assets/loader.webm
  ```

  `-auto-alt-ref 0` is required for alpha, and `-c:v libvpx-vp9` on the *input*
  is what makes ffmpeg decode the alpha at all -- the native decoder reports
  `yuv420p` and silently drops it. 192 is twice the 88px the screen draws it at.
  An animated WebP of the same frames came to 267kB against 95, so it is a video.
- **The still mark is the whole fallback**, swapped out only on the video's
  `canplay`. A codec that has gone, a refused request or a screen that has
  already lifted all end with what was already drawn, and there is no second
  animation to keep in step with the first. `prefers-reduced-motion` is honoured
  by never asking for the video -- CSS cannot stop one playing -- and the mark
  breathes instead.

Four rules, and every one of them is about it being a decoration over somebody's
messaging app rather than about how it looks:

- **It may never be what traps anybody.** There is a 20s ceiling, it comes down
  in the failure path as well as the success one, and it stops taking pointer
  events the moment it starts fading. This project has had two ways to be locked
  out of Slack; a splash that never lifts would be a third.
- **`boot()` never awaits it**, and everything inside it is wrapped: a
  decoration with the power to hold up the runtime, or to throw inside it, is
  worse than no decoration.
- **There is no body to mount into at document-start**, so it builds nothing
  until one arrives -- observing `document.documentElement ?? document`, the
  same fallback `waitForClient` and `dom.waitFor` take -- and `done()` before
  that cancels it rather than leaving it to appear afterwards. Its translator is
  built on first use for the same reason: `createI18n` reads the language off a
  `documentElement` that is null there.
- **A floor of 500ms.** Safe mode applies nothing at all, and the loader often
  attaches to a client that is already built, so without one the screen appears
  and vanishes inside a frame -- which reads as a flash of something broken.

It is in a shadow root with its own colours, because at document-start Slack's
stylesheet has not loaded and its tokens do not exist yet: every colour carries
a literal fallback and picks the token up by itself when a theme lands a moment
later. And it honours `prefers-reduced-motion`, unlike the Motion mod --
installing a mod called Motion is a statement of intent about animation, and
starting Slack is not.

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
network are untrusted whichever button asked for them. That separation is the
whole point: without it, a one-line fix to a theme means pulling the loader and
the runtime along with it.

**Both kinds of update are one number on one button.** The loader sweeps for
both -- its own version and the registry -- at start and every hour after
(`UPDATE_SWEEP_MS`), and pushes each answer: `update.status` and `mods.updates`.
`ModManager` holds them, `notify()` repaints the launcher's badge, and the panel
puts a dot on the tab that owns it: Themes, Plugins or About -- **which is also
where the notice itself is drawn**, rather than on every tab. Without a badge,
repeating it everywhere would be the right answer -- a notice you have to go
looking for is a notice nobody finds -- but with a count on the launcher and a
dot on the tab, a plugin's update sitting on the Themes tab is the thing that
reads as a mistake. Safe mode
stays on every tab; it is not an offer, it is the reason nothing is running. Three things that
are load-bearing rather than tidy:

- **The count is the manager's, not the panel's.** With the mod list owned by
  the panel and fetched once, the first time it is opened, the badge can never
  count a mod, and somebody who never opens the panel never learns one has moved
  on. State a badge reads cannot live in a window that is shut.
- **Hourly, not at boot only.** This is somebody's messaging app, left running
  for days; a check that answers once is a badge that is right for a minute.
  An hour is two requests -- `git fetch` and one registry read -- for a dot.
- **The notice names two versions, not a count of commits.** "Four commits
  behind" is true and means nothing to somebody who has never made one -- and a
  git checkout is what `install.sh` leaves behind, so it is not a developer's
  install by any means. Both kinds of install fill in `latest` (the checkout
  reads `package.json` out of the ref the fetch already brought down, at no
  extra cost), and the title is `BetterSlack 3.0.0 -> 3.1.0`, the same shape a
  mod's row uses. `latest` is set **only when it is genuinely newer**: a branch
  moves without a release on it all the time -- this one's master usually has --
  and there the count of changes is the only honest measure there is, so that is
  what the fallback says.
- **`findModUpdates` answers `null` when it could not ask**, and an empty list
  only when it did. They were the same value, which was harmless while the
  answer was only ever drawn as rows in an open panel: now one hourly sweep
  taken offline would clear the dot off a mod that is still out of date. Same
  rule the app's own check follows -- say nothing rather than say "current" on
  no evidence.

`tests/updates.test.mjs` covers the badge against a real `installLauncher`,
which is why `ui/launcher.ts` is one of the modules the build emits separately.

## A mod may not be installed into a BetterSlack that cannot run it

A mod updates on its own, out of `mods/registry.json` on the default branch,
into whatever version the reader happens to be running. So a plugin that starts
calling something added last month breaks on every older install -- at the first
click, with a `TypeError`, which reads to the person holding it as "this plugin
is broken" rather than "this plugin is newer than my app".

**The floor is computed, not remembered.** Every entry in `docs/api/` carries
the release it arrived in; `scripts/api-floor.mjs` reads which of them a mod's
source touches and takes the highest. That is the only version of this that
works: a hand-written compatibility field is the field nobody bumps, and the
release where they forget is the release that needed it. It is possible at all
because `build-api-page.mjs` already cross-checks that folder against the
TypeScript interfaces -- a new API member cannot exist without a file, so it
cannot exist without a version.

- **`build-registry.mjs` publishes it** as `needsBetterSlack`, because the
  registry is what an older install reads. A floor of nothing is omitted rather
  than written as `0.0.0`: every theme would carry it and say nothing.
- **`mod-updates.ts` refuses**, twice. The listing marks the update
  `blockedBy` so the panel can say which version is wanted, and `mods.update`
  asks again immediately before writing files, because the panel's list can be
  minutes old.
- **The panel reports it and offers no button.** Hiding the update would leave
  the reader believing they are current; offering one that cannot work hands
  them a mod that throws.
- **`unreleased` is a real answer**, not a missing one. A mod calling something
  that is on the branch and in no release genuinely cannot run on any published
  build, so it is refused everywhere until a release is cut -- `pnpm release`
  stamps every `unreleased` with the version it cuts and rebuilds the registry
  in the same commit. Miss that step and every mod using a new call stays
  uninstallable after the release that fixed it.
- **A manifest may raise the floor and may never lower it.** The scan reads
  source text, not a program: it finds `api.slack.openMessage`, the aliases mods
  really write (`const ui = api.ui.kit(document)`, `const { slack } = api`) and
  the imported `tools` group, and it does not find a member reached through a
  computed name or one whose behaviour changed without its name changing.
  Declaring `needsBetterSlack` covers that gap; `validate-mods` fails a
  declaration below the computed floor, naming the calls responsible.

**The registry a client reads can lag a release by a few minutes, and that is
GitHub rather than a bug.** `raw.githubusercontent.com` serves it with
`max-age=300` and `vary: Accept-Encoding`, so the gzip copy and the identity
copy are separate cache entries that expire independently -- and Node's `fetch`
always asks for compression while `curl` without `--compressed` does not.
Measured minutes after 3.0.0 was tagged: `curl` read `3.0.0` and every Node
fetch read `unreleased` from the same URL, until the compressed entry caught up
20 seconds later. It fails in the safe direction -- a mod is refused, never
wrongly allowed -- and it corrects itself, so it is not worth defeating the
cache for. Do not debug it as a fetch problem: compare `curl` and `curl
--compressed` before suspecting the code.

**And the two obvious ways round it have been tried, so do not try them again.**
A cache-busting query string and a `Cache-Control: no-cache` request header both
come back `x-cache: HIT` -- neither shifts it, and the only thing in that URL's
`vary` that would is `Authorization`, which means a token an ordinary user has
no reason to hold.

`api.github.com/repos/.../contents/<file>` **is** fresher: `max-age=60` rather
than 300, and with `Accept: application/vnd.github.raw` it hands back the file
itself. It was written, measured, and deliberately taken back out. Unauthenticated
it allows **60 requests an hour per IP**, and this is a workplace tool: an office
behind one address is every BetterSlack in the building sharing that allowance,
where the cost of running out is a check that reports no update at all. Five
minutes that fails safe beats one minute that fails for everybody at once.

**The catalogue itself is never at risk**, and that is worth knowing before
looking for bugs here: `mods/` ships inside the install, so a catalogue mod
always matches the app it came with. The mismatch exists only along the
mod-update path, which is the one thing that carries a newer mod into an older
app.

**`betterslackApi` is a different thing and stays.** It is one integer, checked
against `MOD_API_VERSION`, and it answers "is this manifest shaped like one this
build understands" -- not "does this build have the calls this mod makes".

**`slackVersion` is compared now too.** `slackVersion(slackPath)` in `slack.ts`
reads the number where it can be read honestly: macOS keeps it in the bundle's
`Info.plist`, which is XML text and needs no `PlistBuddy`; Windows installs each
version into its own `app-4.51.191` directory, so the executable's path carries
it; Linux packages it a dozen ways and none of them are on that path, so it
answers **null**. Null must stay null -- an unknown version compared against
anything invents a mismatch, and a warning that fires where nothing is wrong
teaches people to ignore the one that is real. Mods declare two parts (`4.51`)
and Slack ships three (`4.51.191`), so `slackVersionIsNewer` compares only the
parts the mod states; a full-length compare called every mod in the catalogue a
mismatch. It warns on the mod's page rather than blocking: BetterSlack cannot
update Slack, so refusing would leave nothing to do about it.

## The panel speaks both languages

`ui/strings.ts` is the panel's dictionary and `tests/i18n.test.mjs` holds it to
the rule mods are held to: en and fr must cover the same keys, everything the
panel asks for must exist, and a bare English sentence left in `panel.ts` fails
the test. The panel is held to it because mods are: an app that asks every mod
for two languages and ships one itself is not a rule, it is a preference.

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
directly and they follow every theme exactly. A shadow root reimplementing the
look from tokens lands close but never right. The trade-off is deliberate: a
theme that restyles `.c-dialog` restyles them too. Toasts stay in a shadow root, since Slack has no toast to borrow from and
an unreadable error message is worse than an off-brand one.

**Two shelves, and a sort.** Installed and Browse. There was an Enabled shelf
between them and it was a filter wearing a tab's clothes: everything on it was
on Installed as well, so the same mod sat in two places and switching one off
made it vanish from under the pointer. What it was for is one of the sort orders
now -- newest first, A-Z, Z-A, switched-on first -- and Browse is offered only
the two that mean anything for a mod nobody has yet.

- **`recent` needed no timestamp.** `settings.installed` lists ids in the order
  they were installed, because that is how `setModInstalled` appends them, so
  the record already existed and nothing had to be migrated for mods installed
  months before the sort did. A mod not on that list sorts to the *end*:
  `indexOf` answers -1, and Browse is entirely made of those.
- **The sort is a preference, so it is in `settings.json`** -- somebody who
  wants their list alphabetical wants it alphabetical tomorrow. The search box
  and the tag chips stay in the panel: you clear those. `readSettings` builds
  its object key by key rather than spreading what it parsed, so a new key has
  to be named there or it is written and gone by the next read.
- **Sorting lives in `ui/sort.ts`**, not in the panel, so it can be tested
  against the real function rather than through assertions on the source of the
  panel, which is well past a thousand lines. `localeCompare`, never `<`: a code-point compare files every
  accented name after Z, which reads as a list that is nearly sorted and
  therefore as one that is broken.

**Every mod has a page**, reached by clicking its name: its icon, its version
and author, its description in the reader's language, a screenshot with a
caption, its README rendered, and its settings. `renderMarkdown` in
`ui/markdown.ts` escapes first and drops a `javascript:` URL; a picture in a
README is fetched from the mod's folder through `manager.asset`, one at a time,
and nothing else is fetched at all. `panel.openMod(id)` -- what `api.app` and
the palette call -- opens that page, not the row's settings drawer.

Destructive actions belong behind the row overflow menu, not on the row: a
Remove button on every line shouted louder than anything else in the dialog.

The panel re-renders wholesale on every change, and one toggle triggers several
renders in a frame. Scroll position therefore comes from the user's own scroll
events, not from reading the DOM at render time — reading it captured a 0 left
by an earlier render in the same frame.

## Conventions

- Comments explain *why*, especially where the code looks odd because Slack
  forced it. Several of the strangest lines here are load-bearing.
- **Every change updates the documentation in the same commit.** A change that
  leaves `CLAUDE.md`, `docs/`, a mod's README or the site describing something
  else is an incomplete change, not a change plus a follow-up.
- **Documentation describes the current state, and only that.** No "it used to
  be", no "this was moved", no before-and-after. A reader wants to know how the
  thing works now; what it was last month is what `git log` is for, and every
  sentence spent on it is a sentence they have to decide is irrelevant.

  The line to hold: **a constraint keeps its evidence, a change does not keep
  its story.** "Never anchor next to `.c-coachmark-anchor` -- it freezes the
  renderer solid, bisected against a running client" is current, and the
  measurement is why it is believable. "The update notice used to be a stripe
  and is now a card" is a changelog entry in the wrong file. When a trap is only
  visible through the failure it causes, name the failure -- "a backtick here
  closes the string and the runtime throws at boot" -- not the times it
  happened.
- **Never put a backtick inside `PANEL_CSS`**, comments included. It is a
  template literal, so a backticked `.c-dialog` in a comment closes the string
  and the rest parses as JavaScript — `.c - dialog` — which builds cleanly and
  then throws `ReferenceError: dialog is not defined` at boot, taking the whole
  runtime down with no styling on the failure. The way it happens is always the
  same: a comment explaining a CSS property by naming it in backticks. Write the
  property in words instead -- "sets display flex", not the backticked
  declaration. `tests/requires.test.mjs` fails if a backtick appears in there,
  and typecheck usually gets there first with a baffling `',' expected` pointing
  at the middle of a sentence.
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
