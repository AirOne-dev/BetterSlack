# SlackMod

Themes, plugins and custom CSS for the Slack desktop app, with a Mods panel
inside Slack itself.

```
⌘⇧M  (Ctrl+Shift+M on Windows/Linux)   or the sliders button above your avatar
```

## Install

Requires Node 18+.

```bash
git clone https://github.com/AirOne-dev/SlackMod.git
cd SlackMod
npm install && npm run build
npm start
```

`npm start` restarts Slack and injects the runtime. If Slack lives somewhere
unusual, set `SLACKMOD_SLACK_PATH=/path/to/Slack`.

On macOS, `npm run build-app` produces `dist/SlackMod.app`, which starts the
loader without a terminal. It is unsigned, so the first launch needs
right-click → Open.

## What ships with it

**Themes** — Midnight, Aurora (frosted glass over a drifting gradient),
Terminal (monospace, square corners, phosphor), Cocoa (warm light), Focus Rings.

**Plugins** — Quote Reply (answer in-channel with an unfurl of the message),
Copy Message Link, Focus Mode (⌘⇧F), Composer Character Count, Channel Notes,
User Inspector, Avatar Downloader, DevTools.

Several themes can run at once. Terminal is the exception: it restyles through
`*` selectors, so run it on its own.

## How it works

SlackMod attaches to Slack over the Chrome DevTools Protocol and injects a
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

A theme is one CSS file, best written by redefining Slack's design tokens. A
plugin is an ES module exporting `start(api)`:

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

`api.slack` covers toolbars, message actions, profile panes, permalinks, the
composer and Slack's web API. `api.ui` gives you toasts, modals, confirms and
tooltips with no CSS. Everything registered through `api` is undone when the
plugin is disabled.

`mods/plugins/channel-notes` is the worked example — one of everything.

**[CONTRIBUTING.md](CONTRIBUTING.md) has the full API reference**, the four
families of Slack colour tokens, the CSP constraints, and what gets a pull
request rejected. Read it before writing a mod; it will save you an afternoon.

## Development

```bash
npm run dev              # rebuild on change
npm test                 # every mod's tests
npm run test:mod -- <id> # one mod
npm run check-structure  # is each mod loadable
npm run typecheck
```

Mods in `~/.slackmod/mods/` shadow the repo copies, which is handy for iterating
on something already merged.

## License

MIT
