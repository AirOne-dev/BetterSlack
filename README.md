<p align="center">
  <img src="assets/mark.svg" width="76" alt="">
</p>

<h1 align="center">BetterSlack</h1>

<p align="center">
  <strong>You know BetterDiscord. This is that, for Slack.</strong><br>
  Themes, plugins, a ⌘K palette and a theme builder — inside the Slack desktop
  app, without patching a single file of it.
</p>

<p align="center">
  <a href="https://airone-dev.github.io/BetterSlack/"><strong>airone-dev.github.io/BetterSlack</strong></a> ·
  <a href="docs/getting-started.md">Getting started</a> ·
  <a href="docs/api.md">API</a> ·
  <a href="docs/themes.md">Theming</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <img src="site/shots/panel.webp" width="880" alt="The BetterSlack panel open inside Slack, listing installed themes with switches">
</p>

<p align="center"><em>⌘⇧M, or the sliders button above your avatar.</em></p>

## Seven themes, fifteen plugins, one keystroke

<table>
  <tr>
    <td width="50%"><img src="site/shots/mods/aurora.webp" alt="Slack wearing the Aurora theme"></td>
    <td width="50%"><img src="site/shots/mods/terminal.webp" alt="Slack wearing the Terminal theme"></td>
  </tr>
  <tr>
    <td><strong>Aurora</strong> — frosted glass over a drifting gradient.</td>
    <td><strong>Terminal</strong> — monospace, square corners, phosphor.</td>
  </tr>
  <tr>
    <td><img src="site/shots/mods/cocoa.webp" alt="Slack wearing the Cocoa theme"></td>
    <td><img src="site/shots/mods/midnight.webp" alt="Slack wearing the Midnight theme"></td>
  </tr>
  <tr>
    <td><strong>Cocoa</strong> — cream paper, cocoa text, soft shadows.</td>
    <td><strong>Midnight</strong> — a deeper, cooler dark.</td>
  </tr>
</table>

A theme is CSS and nothing else, so several can run at once. When a look needs
behaviour CSS cannot do, the theme names a plugin in `requires` and the panel
offers to switch it on — **Discord Dark** does exactly that, and brings the
member column and the account strip with it:

<p align="center">
  <img src="site/shots/discord-combo.webp" width="880" alt="Slack rebuilt as Discord: the theme, a member column on the right and an account strip bottom-left">
</p>

### ⌘K, and everything is one keystroke away

<p align="center">
  <img src="site/shots/palette.webp" width="880" alt="The BetterSlack command palette open over Slack">
</p>

Slack's quick switcher with everything Slack has no idea about in the same list:
any conversation, anyone in the workspace (through Slack's own search, not just
your open DMs), every mod's commands, and a plugin's settings — `/` for actions,
`@` for people, `#` for channels.

### A theme builder whose preview is Slack

<p align="center">
  <img src="site/shots/mods/theme-builder.webp" width="720" alt="The theme builder window, showing a gallery of themes to start from">
</p>

Two colours become twelve roles across all four of Slack's token families,
hovering a colour outlines what it paints, and pointing at anything in the app
shows the tokens behind it. It writes ordinary CSS you can commit.

## Install

```bash
git clone https://github.com/AirOne-dev/BetterSlack.git
cd BetterSlack
./install.sh                 # macOS and Linux
```

On Windows, in PowerShell:

```powershell
git clone https://github.com/AirOne-dev/BetterSlack.git
cd BetterSlack
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

**No git? You do not need it.** `git clone` is one way to get the folder and
nothing here needs the other things git can do -- the installer never calls it,
and an install updates itself from GitHub's tarball rather than by pulling.
Download the ZIP from the green **Code** button, unpack it, and run the same
installer; or in a terminal:

```bash
curl -fsSL https://codeload.github.com/AirOne-dev/BetterSlack/tar.gz/refs/heads/master | tar xz
cd BetterSlack-master
./install.sh
```

```powershell
# Windows
Invoke-WebRequest https://codeload.github.com/AirOne-dev/BetterSlack/zip/refs/heads/master -OutFile bs.zip
Expand-Archive bs.zip -DestinationPath .
cd BetterSlack-master
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

That is the whole thing. Nothing has to be installed first -- not Node, not
pnpm, not git. The installer uses a Node already on the machine if there is one recent
enough and downloads one into `~/.betterslack/runtime` if there is not, verifies
it against the checksum nodejs.org publishes, builds, and puts the result in
`~/.betterslack/app`.

BetterSlack itself is about 6 MB. A Node it had to download is a further ~190 MB
and is kept to itself — nothing is added to your `PATH` and no other project
sees it. Nothing is written outside your home
directory, with one exception the installer announces before it happens: on
macOS the app is copied into `/Applications`, which needs a password only on a
Mac whose owner is not an administrator.

**Then delete the clone if you like.** The install does not refer back to it.
Keep it only to work on BetterSlack itself.

Afterwards BetterSlack is an ordinary application: Spotlight, the Dock, your
login items, the Start menu, your desktop's applications menu. Starting it
restarts Slack with your mods attached and keeps running for as long as Slack
does. Nothing is enabled on a fresh install -- open the panel and pick what you
want from **Browse**.

To update, or to move to a newer Node, run `./install.sh` again. To uninstall,
delete `~/.betterslack` and the launcher (`/Applications/BetterSlack.app`, or
`~/.local/bin/betterslack` and its `.desktop` file, or the Start menu shortcut).

Two notes for macOS. The first launch needs right-click -> **Open**, because the
app is unsigned. And a C compiler (`xcode-select --install`) is worth having
before you run the installer: without one the app still launches, but macOS
refuses it access to `~/Downloads`, which is where a mod saves a file.

**→ [docs/getting-started.md](docs/getting-started.md)** covers running it,
writing a theme, writing a plugin, testing and shipping.

## What is in the catalogue

**Themes** — Midnight (a deeper dark), Aurora (frosted glass over a drifting
gradient), Cocoa (warm light), Terminal (monospace phosphor), Discord Dark and
Discord Light (Slack rebuilt as Discord, colours sampled from the real client),
Focus Rings.

**Plugins** — Command Palette (⌘K, with `/` `@` `#` to narrow it), Theme Builder,
Motion (Slack with the frames in between), Code Highlight (twenty-one
languages, detected), Full Links (Slack stops shortening your URLs), Member
Sidebar, Sidebar Account Strip, Quote Reply, Copy Message Link,
Composer Character Count, Channel Notes, User Inspector, Avatar
Downloader, DevTools, Demo Mode (a Slack full of people who do not exist, for
when you are screenshotting or sharing your screen).

Each has a page in the panel — what it is for, in your language, with a picture
and its settings:

<p align="center">
  <img src="site/shots/panel-mod.webp" width="880" alt="A mod's page in the BetterSlack panel: icon, description, screenshot and settings">
</p>

Several themes can run at once. Terminal is the exception: it restyles through
`*` selectors, so run it on its own.

A mod carries its own version and updates on its own, so a fix to one theme does
not mean pulling the whole project. The panel also offers to update BetterSlack
itself — over git when there is a checkout, and by downloading the release from
GitHub when there is not.

## If something goes wrong

Nothing is applied after a run that never reported itself healthy — a mod that
wedges the renderer cannot lock you out. A mod that throws on start is named on
its own row, and is skipped after two failures until you switch it off and on
again.

To start with every mod off deliberately, run the launcher with `--safe`:

```bash
# Linux: the command the installer put on your PATH
betterslack --safe

# macOS: the app has no way to pass a flag, so run the loader directly, with
# the Node the installer recorded
"$(cat ~/.betterslack/app/node-path)" ~/.betterslack/app/bin/betterslack.mjs --safe
```

If it does not start at all, the log says why. It is at
`~/Library/Logs/BetterSlack.log` on macOS and `~/.betterslack/betterslack.log`
on Linux and Windows.

## How it works

BetterSlack attaches to Slack over the Chrome DevTools Protocol and injects a
runtime into the renderer. It never modifies `Slack.app`, so Slack updates
cannot break your install.

It talks to Slack over `--remote-debugging-pipe`, not `--remote-debugging-port`.
The port version opens an unauthenticated TCP listener that any local process
can use to drive your Slack session; the pipe uses two file descriptors handed
over at spawn time, and nothing listens on the network:

```console
$ lsof -nP -iTCP -sTCP:LISTEN -a -p $(pgrep -x Slack)
$                     # nothing
```

That does not protect against a program already running as your user — nothing
in user space can. Mods are active only while the loader runs, and Slack has to
be started by it.

## Writing a mod

Mods live in `mods/`, one folder each, picked up live with no rebuild:

```
mods/themes/<id>/mod.json    + theme.css
mods/plugins/<id>/mod.json   + index.js  + test.mjs
```

A theme is CSS. A plugin is an ES module exporting `start(api)` — and most of
what a mod needs is one call:

```js
export default {
  start(api) {
    api.slack.addToolbarButton('channelHeader', {
      id: 'hello', label: 'Say hello', icon: '<svg …>',
      onClick: () => api.ui.toast('Hello', { variant: 'success' }),
    });
  },
};
```

`entry` in `mod.json` is only where the app starts reading: a mod can be as many
files as it wants, imported relatively (`./lib/x.js`, or `@import './tokens.css'`
in a theme) from inside its own folder.

## Documentation

| | |
| --- | --- |
| **[Getting started](docs/getting-started.md)** | Run it · write a theme · write a plugin · test · ship |
| [API reference](docs/api.md) | Every entry, with an example |
| [Theming Slack](docs/themes.md) | The four colour token families, traps, recipes |
| [Contributing](CONTRIBUTING.md) | Review rules and the PR checklist |

## Development

Everything below is for working on BetterSlack itself, and it is the only place
in this project that asks anything of your machine. Using BetterSlack needs
`install.sh`; changing it needs a checkout, Node and pnpm.

```bash
git clone https://github.com/AirOne-dev/BetterSlack.git && cd BetterSlack
corepack enable && pnpm install && pnpm build
pnpm start                        # launch Slack with mods, from this checkout
```

`pnpm build` is not optional: the loader and the runtime are TypeScript and
`dist/` is not committed. Run it after cloning and after any change under
`src/` — never for a change under `mods/`, which hot-reloads into the running
client.

```bash
pnpm check                        # everything below that CI would run, in one go
pnpm dev                          # rebuild on change
pnpm new-mod plugin my-plugin "What a user gets"   # a mod that already passes
pnpm test                         # every mod's tests
pnpm test -- <id>                 # one mod
pnpm test:core                    # loader and runtime unit tests
pnpm test:live                    # boot the real Slack and grade what loaded
pnpm check-structure              # is each mod loadable
pnpm validate-mods                # manifests
pnpm registry                     # regenerate mods/registry.json, then commit it
pnpm typecheck
pnpm release patch                # bump, write CHANGELOG.md, tag

pnpm site:dev                     # the presentation site, live at localhost:4321
pnpm site                         # regenerate site/data.js from the catalogue
```

Mods in `~/.betterslack/mods/` shadow the repo copies, which is handy for iterating
on something already merged.

## License

MIT
