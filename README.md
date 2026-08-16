# BetterSlack

<img src="assets/mark.svg" width="72" alt="">


Themes, plugins and custom CSS for the Slack desktop app, with a Mods panel
inside Slack itself.

```
⌘⇧M  (Ctrl+Shift+M on Windows/Linux)   or the sliders button above your avatar
```

## Install

Requires Node 18+.

```bash
git clone https://github.com/AirOne-dev/BetterSlack.git
cd BetterSlack
pnpm install && pnpm build
pnpm start
```

`pnpm start` restarts Slack with BetterSlack attached and stays running — mods are
active as long as it does. Nothing is installed on a fresh setup: open the panel
and install what you want from **Browse**.

**→ [docs/getting-started.md](docs/getting-started.md)** covers running it,
writing a theme, writing a plugin, testing and shipping.

## What ships with it

**Themes** — Midnight, Aurora (frosted glass over a drifting gradient),
Terminal (monospace, square corners, phosphor), Cocoa (warm light), Focus Rings.

**Plugins** — Quote Reply (answer in-channel with an unfurl of the message),
Copy Message Link, Focus Mode (⌘⇧F), Composer Character Count, Channel Notes,
User Inspector, Avatar Downloader, DevTools.

Several themes can run at once. Terminal is the exception: it restyles through
`*` selectors, so run it on its own.

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
pnpm dev              # rebuild on change
pnpm test                 # every mod's tests
ppnpm test:mod -- <id> # one mod
pnpm check-structure  # is each mod loadable
pnpm typecheck
```

Mods in `~/.betterslack/mods/` shadow the repo copies, which is handy for iterating
on something already merged.

## License

MIT
