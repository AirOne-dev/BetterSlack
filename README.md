# SlackMod

Themes, plugins and custom CSS for the Slack desktop app — with a Mods panel
inside Slack itself.

```
⌘⇧M  (Ctrl+Shift+M on Windows/Linux)   or the sliders button just above your avatar
```

- **Themes** — stylesheets layered over Slack, several at a time.
- **Plugins** — ES modules with a lifecycle, a DOM helper API and persisted settings.
- **Custom CSS** — your own, applied last so it always wins.
- **Browse** — install anything that has been merged into this repository.
- **Hot reload** — save a file, see it in Slack immediately.

## How it works, and why it works this way

SlackMod attaches to Slack over the **Chrome DevTools Protocol** and injects a
runtime into the renderer. It never touches `Slack.app`.

That is a deliberate choice, and the alternatives are worse than they look. The
obvious approach — patching `app.asar`, the way BetterDiscord does — is closed
on current Slack builds:

| Checked on Slack 4.51 (Electron 43) | |
| --- | --- |
| `EnableEmbeddedAsarIntegrityValidation` fuse | **enabled** |
| `OnlyLoadAppFromAsar` fuse | **enabled** |
| SHA-256 of `app.asar` in `Info.plist` | present, and `Info.plist` is inside the code signature |
| Code signature | hardened runtime + library validation |

Editing `app.asar` therefore means editing the signed `Info.plist` to match,
which invalidates the signature, which on Apple Silicon means re-signing the
whole bundle and stripping library validation — and then Slack's Keychain entry
no longer matches its signing identity, and every Slack auto-update undoes all
of it. CDP injection avoids that entire category of problem: Slack updates
cannot break your install.

### No debugging port

Most CDP-based mod loaders start the app with `--remote-debugging-port`. That
opens an **unauthenticated TCP listener on `127.0.0.1`**: any process running as
you can connect to it and drive your Slack session — read every message, lift
the token. It is the worst part of this design, and it is avoidable.

SlackMod uses `--remote-debugging-pipe` instead. Chromium then speaks CDP over
two file descriptors handed to it at spawn time (3 in, 4 out) and opens no
socket at all. Only the loader process holds those descriptors, and file
descriptors are not addressable from another process. Verified:

```console
$ lsof -nP -iTCP -sTCP:LISTEN -a -p $(pgrep -x Slack)
$                     # nothing — no port to connect to
```

There is no flag to turn the port back on, because a flag that reopens the hole
is the hole.

What this does **not** protect against: a program already running as your user
can read `~/.slackmod`, attach a debugger to processes you own, or read Slack's
own local storage. No user-space program can defend against that, and SlackMod
does not claim to.

The remaining trade-off is operational: mods are only active while the loader is
running, and Slack has to be **started by the loader**, since the pipe can only
be attached at spawn time.

Three more constraints the runtime is built around, all measured against a live
Slack rather than assumed:

- **`eval()` and `new Function()` do not work.** Slack's CSP has no
  `'unsafe-eval'`. Plugins are loaded as ES modules through a `blob:` URL and a
  dynamic `import()`, because `blob:` *is* in Slack's `script-src`.
- **`style-src` allows `'unsafe-inline'`**, so themes are plain `<style>` tags.
- **Slack's class names churn; its `data-qa` attributes and `--dt_color-*`
  design tokens do not.** Mods should target those.

## Install

Requires Node 18+.

```bash
git clone https://github.com/AirOne-dev/SlackMod.git
cd SlackMod
npm install
npm run build
npm start
```

`npm start` restarts Slack with a debugging port and injects the runtime. Open
the panel with **⌘⇧M**.

If Slack is not where SlackMod expects it:

```bash
SLACKMOD_SLACK_PATH=/path/to/Slack npm start
```

### macOS app wrapper

`npm run build-app` produces `dist/SlackMod.app`, which starts the loader
without a terminal window. It is unsigned, so the first launch needs
right-click → Open.

## Writing a mod

Mods live in `mods/`, one folder each, with a `mod.json` manifest:

```
mods/themes/midnight/mod.json      mods/plugins/composer-char-count/mod.json
mods/themes/midnight/theme.css     mods/plugins/composer-char-count/index.js
```

```json
{
  "id": "midnight",
  "name": "Midnight",
  "type": "theme",
  "version": "1.0.0",
  "author": "your-github-handle",
  "description": "One sentence on what it does.",
  "entry": "theme.css",
  "slackmodApi": 1
}
```

Anything you drop in `mods/` is picked up live — no rebuild, no restart. Your
own work-in-progress mods can also live in `~/.slackmod/mods/`, which shadows
the repo copies.

### Themes

A theme is one CSS file. Prefer redefining Slack's design tokens over targeting
its components. **Slack paints from three separate families** — miss one and
part of the app keeps its old colours:

```css
:root, .sk-client-theme--light, .sk-client-theme--dark {
  /* 1. content and controls — real CSS colours */
  --dt_color-base-pry: #0f1219;
  --dt_color-content-pry: #e7e9ee;

  /* 2. the app chrome: rail, sidebar, headers. Needs !important —
   *    something more specific than :root defines these. */
  --dt_color-theme-base-inv-pry: #0b0e14 !important;
  --dt_color-theme-surf-inv-sec: rgba(11, 14, 20, 0.72) !important;

  /* 3. the legacy family, still driving plenty of components.
   *    These hold bare "r, g, b" triplets, not colours. */
  --sk_primary_background: 15, 18, 25 !important;
  --sk_primary_foreground: 231, 233, 238 !important;
}

/* Slack also paints a full-viewport opaque layer above <body>. */
.p-theme_background { background: #0f1219 !important; }
```

`--dt_color-plt-*` is a fourth set, the raw palette; like `--sk_*` it holds
`r,g,b` triplets that only work inside `rgb()`.

Several themes can be on at once and stack in the order you enabled them.
**Terminal is an exception**: it restyles through `*` selectors, so it overrides
anything stacked with it. Run it on its own.

### Plugins

A plugin is an ES module with a default export. Everything registered through
`api` is torn down when the plugin is disabled, so `stop()` only needs to handle
state the API does not know about.

```js
export default {
  start(api) {
    api.slack.addToolbarButton('channelHeader', {
      id: 'hello', label: 'Say hello', icon: '<svg …>',
      onClick: () => api.ui.toast('Hello', { variant: 'success' }),
    });
  },
  stop() {},
};
```

`mods/plugins/channel-notes` is the worked example: one of everything, and not a
line of CSS.

#### `api.slack` — Slack's own chrome

| | |
| --- | --- |
| `addToolbarButton(toolbar, button)` | A button in `controlStrip` (beside your avatar), `composer` (the formatting row) or `channelHeader`. It wears Slack's classes for that spot, so size, colour, hover and transition come from Slack. |
| `addMessageAction(action)` | A button in the hover row on every message. |
| `describeMessage(el)` | `{ channelId, ts, permalink, text }` for a message element. |
| `composer` | `insertText`, `insertLink`, `focus`, `caretToEnd`, `isEmpty`. |
| `selectors` | The stable selectors behind all of the above, for going off-road. |

#### `api.ui` — widgets, no CSS required

| | |
| --- | --- |
| `toast(message, { variant, duration, action })` | Transient message. Variants: info, success, warning, error. |
| `modal({ title, subtitle, content, actions, width })` | A dialog. `content` takes a string or your own node; an action returning `false` keeps it open. |
| `confirm({ title, message, danger })` | Yes/no, resolves a boolean. |
| `tooltip(element, { title, subtitle, placement })` | Slack-style tooltip on anything you built. |

Widgets live in shadow roots, so a broken theme cannot make them unusable, and
they read Slack's design tokens, so they follow the active theme.

#### `api.dom`, `api.settings`, `api.log`

```js
api.dom.keepMounted(container, id, factory, { before })  // survives re-renders
api.dom.onEach(selector, handler)                        // now and in future
api.dom.onShortcut(match, handler)
api.dom.waitFor(selector)
api.dom.h(tag, attrs, children)

api.settings.get(key, fallback)      // persisted per plugin in ~/.slackmod
await api.settings.set(key, value)

api.css('…')                          // a stylesheet owned by your plugin
api.onDispose(fn)
api.log.info / warn / error
```

`api.dom.keepMounted` re-creates your node only when it is genuinely missing —
use it instead of a raw `MutationObserver`, which will insert duplicates every
time Slack re-renders.

## Contributing a mod

Open a pull request adding your folder under `mods/`. See
[CONTRIBUTING.md](CONTRIBUTING.md).

**There is no sandbox around a plugin.** It runs in an authenticated Slack tab
and can read every message you can. Review is the only boundary, so every mod is
read by a human before it merges, and you should apply the same standard before
installing one.

## Development

```bash
npm run dev            # rebuild loader + runtime on change
npm run typecheck
npm run validate-mods  # the automated half of PR review
npm run registry       # regenerate mods/registry.json
```

`npm start -- --verbose` logs every message crossing the bridge.

## License

MIT
