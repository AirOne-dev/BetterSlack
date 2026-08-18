# BetterSlack

<img src="assets/mark.svg" width="72" alt="">


Themes, plugins and custom CSS for the Slack desktop app, with a Mods panel
inside Slack itself.

**→ [airone-dev.github.io/SlackMod](https://airone-dev.github.io/SlackMod/)** — screenshots, the catalogue, and what the API looks like.

```
⌘⇧M  (Ctrl+Shift+M on Windows/Linux)   or the sliders button above your avatar
```

## Install

Requires Node 18+ and pnpm — Node 22+ if you get pnpm through Corepack, since
pnpm 11 refuses to run on anything older when it is Node that runs it. Corepack
ships with Node, so `corepack enable` is enough; `npm i -g pnpm` and Homebrew's
standalone binary work too. It has to be pnpm: esbuild fetches its platform
binary in an install script, and only `pnpm-workspace.yaml` says which scripts
may run.

```bash
git clone https://github.com/AirOne-dev/SlackMod.git
cd SlackMod
pnpm install && pnpm build
pnpm start
```

`pnpm start` restarts Slack with BetterSlack attached and stays running — mods are
active as long as it does. Nothing is installed on a fresh setup: open the panel
and install what you want from **Browse**.

**→ [docs/getting-started.md](docs/getting-started.md)** covers running it,
writing a theme, writing a plugin, testing and shipping.

## What is in the catalogue

**Themes** — Midnight (a deeper dark), Aurora (frosted glass over a drifting
gradient), Cocoa (warm light), Terminal (monospace phosphor), Discord Dark and
Discord Light (Slack rebuilt as Discord, colours sampled from the real client),
Focus Rings.

**Plugins** — Command Palette (⌘K: any conversation, anyone in the workspace,
every mod command and every theme in one list, with `/` `@` `#` to narrow it), Theme Builder (a workbench in its own window with the real
Slack as the preview), Member Sidebar, Sidebar Account Strip, Quote Reply, Copy
Message Link, Focus Mode (⌘⇧F), Composer Character Count, Channel Notes, User
Inspector, Avatar Downloader, DevTools.

Several themes can run at once. Terminal is the exception: it restyles through
`*` selectors, so run it on its own.

A mod carries its own version and updates on its own, so a fix to one theme does
not mean pulling the whole project. The panel also offers to update BetterSlack
itself — over git when there is a checkout, and by downloading the release from
GitHub when there is not.

## If something goes wrong

`pnpm start --safe` applies nothing, and so does the next start after a run that
never reported itself healthy — a mod that wedges the renderer cannot lock you
out. A mod that throws on start is named on its own row, and is skipped after two
failures until you switch it off and on again.

```bash
pnpm test:live        # boots the real Slack and checks what actually loaded
```

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

```bash
pnpm dev                          # rebuild on change
pnpm new-mod plugin my-plugin "What a user gets"   # a mod that already passes
pnpm test                         # every mod's tests
pnpm test:mod -- <id>             # one mod
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
