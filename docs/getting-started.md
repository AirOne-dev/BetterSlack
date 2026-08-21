# Getting started

Three tracks. Pick the one you need:

- **[Just run it](#just-run-it)** — you want BetterSlack on your Slack.
- **[Write a theme](#write-a-theme)** — you want Slack to look different.
- **[Write a plugin](#write-a-plugin)** — you want Slack to *do* something new.

Then: [test it](#test-your-mod) and [ship it](#ship-it).

---

## Just run it

You need the Slack desktop app. You do not need anything else — not Node, not
pnpm. The installer sorts that out.

```bash
git clone https://github.com/AirOne-dev/BetterSlack.git
cd BetterSlack
./install.sh
```

On Windows, in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

It finds a Node recent enough to run the loader, downloads one into
`~/.betterslack/runtime` if the machine has none, builds, and puts the result in
`~/.betterslack/app` — about 6 MB, plus ~190 MB for a Node it had to fetch. Then
it makes something you can double-click:
`BetterSlack.app` in `/Applications`, a menu entry and a `betterslack` command on
Linux, a Start menu shortcut on Windows. **The clone is not part of the install
and can be deleted afterwards.**

Start it like any other application. It closes Slack, starts it again with
BetterSlack attached, and keeps running for as long as Slack does.

You should see, in Slack:

- a **sliders button** just above your avatar, bottom-left;
- the same panel on **⌘⇧M** (Ctrl+Shift+M elsewhere).

Nothing is installed on a fresh setup. Open the panel → **Plugins** or
**Themes** → **Browse** → *Install*, then flip the switch to turn it on.

If it does not start, the log says why: `~/Library/Logs/BetterSlack.log` on
macOS, `~/.betterslack/betterslack.log` on Linux and Windows.

<details>
<summary>Slack isn't where BetterSlack expects it</summary>

`BETTERSLACK_SLACK_PATH` names the executable, and the loader reads it at every
launch:

```bash
launchctl setenv BETTERSLACK_SLACK_PATH /path/to/Slack   # macOS, for the app
BETTERSLACK_SLACK_PATH=/path/to/Slack betterslack        # Linux, one run
```
</details>

<details>
<summary>What macOS asks, and why</summary>

The first launch needs right-click → **Open**, because the app is unsigned.

Beyond that, one thing is worth having before you run the installer: a C
compiler, which you have if `xcode-select --install` has ever been run. The
bundle's executable is a small binary stub that launches the shell script beside
it, and that indirection is the difference between an app macOS will let write
to `~/Downloads` — where `api.files.save` puts a file a mod saves — and one it
refuses outright. A bundle whose executable *is* a shell script is not an
application as far as that gate is concerned: the process it sees is
`/bin/bash`, so the write fails with no prompt and nothing to grant.

Without a compiler the script-only shape is still built and still launches;
only saving a file is refused. The installer says so when it falls back.

macOS remembers what you allow for as long as the app is not rebuilt: an ad-hoc
signature identifies a bundle by its contents, so running the installer again
means being asked again.
</details>

---

## Write a theme

A theme is a folder with a manifest and CSS. Two files and it shows up in the
panel; split the CSS across as many files as you like once it grows.

### 1. Make the folder

```bash
mkdir -p mods/themes/my-theme
```

### 2. `mods/themes/my-theme/mod.json`

```json
{
  "id": "my-theme",
  "name": "My Theme",
  "type": "theme",
  "version": "1.0.0",
  "author": "your-github-handle",
  "description": "One sentence about what a user gets, not how it works.",
  "entry": "theme.css",
  "betterslackApi": 1
}
```

`id` must match the folder name.

### The mod's page in the panel

Everything above is the minimum. What turns a row in a list into a page
somebody reads is optional, and every mod in this repository has all of it:

```json
{
  "icon": "icon.svg",
  "descriptions": { "fr": "Une phrase, dans la langue du lecteur." },
  "screenshots": [{
    "file": "screenshot.webp",
    "captions": { "en": "What the picture shows.", "fr": "Ce que montre l'image." }
  }],
  "readme": "README.md",
  "readmes": { "fr": "README.fr.md" }
}
```

- `icon` is an SVG in the mod's folder. It is inlined into the catalogue, so it
  costs no request and cannot be missing when the panel draws.
- `descriptions` and `readmes` are keyed by language. English is what a reader
  falls back to, so `description` and `readme` stay required.
- `screenshots` are read one at a time, only when the page is opened.
- The README is also a file people read in the repository, so it opens with the
  mod's name and its description; the panel drops both, since they are already
  the heading and the paragraph above it.
- `pnpm shoot --mods` takes the picture for you and files it as
  `screenshot.webp` in the folder — WebP, straight out of Chromium, at twice
  the published size and roughly half the weight of the JPEG it replaced.

Every path must stay inside the mod's folder -- the loader refuses anything
that climbs out of it -- and `pnpm validate-mods` checks that each file exists.

### 3. `mods/themes/my-theme/theme.css`

Change Slack's **design tokens**, not its class names — class names churn with
every Slack release, tokens do not:

```css
:root,
.sk-client-theme--light,
.sk-client-theme--dark {
  --dt_color-base-pry: #101418;      /* the message surface */
  --dt_color-content-pry: #e6e9ef;   /* body text */
  --dt_color-content-hgl-1: #6cb6ff; /* links */
}
```

### 4. See it

The loader watches `mods/`. Save the file, open the panel, install and enable
your theme — after that, every save re-applies it live. No rebuild, no restart.

### Settings your mod can be given

Declare them in `mod.json` and the Mods panel draws them; your mod reads the
same keys with `api.settings`, and the `default` is the answer before anyone has
chosen:

```json
"settings": [
  { "key": "limit", "type": "number", "label": "Members to list",
    "hint": "Higher costs one request per extra person.", "default": 100, "min": 10, "max": 500 },
  { "key": "quiet", "type": "boolean", "label": "Stay out of the way", "default": true }
]
```

```js
const limit = api.settings.get('limit', 100);   // the manifest default wins if there is one
```

Types: `boolean`, `number`, `text`, `colour`, `choice` (with `options`). Changing
one reloads your plugin so `start` runs again with the new value — unless you
registered `api.settings.onChange`, in which case you are told and left running.

### More than one file

A big theme reads better in pieces. `@import` a relative path and BetterSlack
inlines it, in order, before anything reaches the page:

```
mods/themes/my-theme/
  mod.json
  theme.css        @import './tokens.css'; @import './sidebar.css';
  tokens.css
  sidebar.css
```

Relative paths only, and only inside your own folder — the CSS is injected as
one `<style>` element with no URL to resolve against, so a browser `@import` of
a stylesheet on a server would be a network request Slack's CSP refuses anyway.
Import each file once; a cycle is an error, not an infinite loop.

### The one thing that will catch you out

Slack paints from **four** families of custom properties. Overriding only the
first leaves the whole app chrome untouched — invisible on a dark theme, glaring
on a light one:

| Family | Drives | Format |
| --- | --- | --- |
| `--dt_color-<role>` | messages, controls, text | CSS colour |
| `--dt_color-theme-*` | rail, sidebar, headers | CSS colour, needs `!important` |
| `--sk_*` | older components | bare `r, g, b`, needs `!important` |
| `--dt_color-plt-*` | the raw palette | bare `r, g, b` |

**→ [docs/themes.md](themes.md) has the full list, the traps, and copy-paste
starting points.**

Working examples to read: [`midnight`](../mods/themes/midnight/theme.css) (plain
and well commented), [`discord-dark`](../mods/themes/discord-dark/theme.css)
(a complete reskin), [`aurora`](../mods/themes/aurora/theme.css) (gradients and
glass), [`focus-rings`](../mods/themes/focus-rings/theme.css) (no tokens at all,
just semantics).

### If your look needs more than CSS

CSS cannot move a node to a different parent, read who is signed in, or press a
button. A theme that needs one of those puts that part in a **plugin** and names
it in `mod.json`:

```json
"entry": "theme.css",
"requires": ["member-sidebar"]
```

The panel offers to switch those on with the theme. Write the plugin so it is
worth installing on its own — see
**[docs/themes.md](themes.md#when-css-is-not-enough)**.

---

## Write a plugin

A plugin is an **ES module** that exports `start(api)`. Everything it registers
through `api` is undone when it is switched off, so `stop()` is usually empty.

### 1. The folder

```
mods/plugins/my-plugin/
  mod.json      same as a theme, but "type": "plugin" and "entry": "index.js"
  index.js      the entry: it exports default { start }
  test.mjs      required — see Test your mod
```

`entry` is where the app starts reading; the rest of the folder is yours to
organise (see [More than one file](#more-than-one-file-1)).

### 2. `index.js`

```js
export default {
  start(api) {
    api.slack.addToolbarButton('channelHeader', {
      id: 'hello',
      label: 'Say hello',
      icon: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7" fill="currentColor"/></svg>',
      onClick: () => api.ui.toast('Hello', { variant: 'success' }),
    });
  },
  stop() {},
};
```

That is a complete, working plugin: a button in the channel header, wearing
Slack's own classes so it matches its neighbours, with a Slack-styled tooltip.

### 3. The 60-second tour

Reach for **`api.helpers`** first — it covers most of what mods do in one call:

```js
// A mode: a persisted flag plus a class on <html>, so behaviour is pure CSS.
const zen = api.helpers.toggle({
  key: 'on',
  className: 'my-zen',
  whenOn: `& .p-channel_sidebar { display: none !important; }`,
});

api.helpers.hotkey('mod+shift+z', () => zen.toggle());
api.helpers.copy('text', 'Copied');            // clipboard + confirmation
api.helpers.mount(container, id, factory);      // survives Slack's re-renders
```

Then **`api.slack`** for Slack's own surfaces (toolbars, message actions,
profile panes, the composer, Slack's web API), **`api.ui`** for toasts, modals
and confirms that need no CSS, and `api.settings`, `api.files`, `api.css`.

Anything your plugin says out loud goes through `api.i18n.strings()`, with at
least English and French — see [api.md](api.md#apii18n).

**→ [docs/api.md](api.md) is the full reference, with an example for every
entry.**

### 4. More than one file

Once a plugin is more than a screenful, split it. Import relative paths and
BetterSlack resolves them for you:

```
mods/plugins/my-plugin/
  mod.json        "entry": "index.js"
  index.js        import { render } from './ui/panel.js';
  ui/panel.js     import { format } from '../lib/format.js';
  lib/format.js
  test.mjs
```

```js
// index.js
import { render } from './ui/panel.js';

export default {
  start(api) { render(api); },
};
```

Three rules, all of them enforced by `pnpm validate-mods`:

- **Relative specifiers only** — `./x.js`, `../lib/x.js`. There is no npm and no
  CDN in the page; a bare `import 'lodash'` has nothing to resolve to.
- **Stay inside your folder.** `../../other-plugin/index.js` is rejected: mods
  are installed one at a time, and yours may be the only one there.
- **No cycles.** A file may not import, directly or transitively, something that
  imports it back.

Why the rules: the page has no `'unsafe-eval'`, so a plugin is loaded as a real
ES module through a `blob:` URL — and a blob URL has no directory for a relative
path to resolve against. BetterSlack therefore reads your whole folder, builds a
blob per file leaves-first, and rewrites each relative specifier to the blob URL
of the file it names. The module you wrote is the module that runs; only the
specifiers change. `.css` files in the folder are shipped too, so a plugin can
keep its stylesheet in a real `.css` file: `api.css(api.assets.text('ui/panel.css'))`.

### 5. Read a real one

[`channel-notes`](../mods/plugins/channel-notes/index.js) is the worked example
— a button, a modal, settings, a confirm, a toast, and no CSS at all.
[`motion`](../mods/plugins/motion/index.js) is the one to read for
`helpers.toggle` and a stylesheet built in one `api.css` call.
[`quote-reply`](../mods/plugins/quote-reply/index.js) is the shortest useful
one.

### Rules that save an afternoon

- **`eval()` and `new Function()` throw.** Slack's CSP has no `'unsafe-eval'`.
  (They *work* in a DevTools console, which misleads.)
- **Never a raw `MutationObserver`** to insert a node — Slack re-renders
  constantly and you will get duplicates. Use `api.helpers.mount`.
- **Anchor on `data-qa`**, then tokens. `circleButton__cMiUK` is CSS-module
  output that changes every build; `p-channel_sidebar__channel` is stable.
- **Don't fetch from the page** — Slack's CDN has no CORS headers. Use
  `api.files.save`.
- **Don't touch the session token.** Use `api.slack.web`.

---

## Test your mod

Every mod ships a `test.mjs`. There is no opt-out: a mod without one fails the
structure check.

`tests/harness.mjs` gives you a Slack-shaped DOM and a recording stand-in for
`api`, so a test needs no Slack, no Electron and no network:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestApi, installDom } from '../../../tests/harness.mjs';
import plugin from './index.js';

test('greets on click', async () => {
  const dom = installDom();
  try {
    const { api, recorded } = createTestApi();
    await plugin.start(api);

    recorded.toolbarButtons[0].button.onClick();
    assert.ok(recorded.toasts.some((t) => t.variant === 'success'));
  } finally {
    dom.cleanup();
  }
});
```

A theme's test is three lines — the shared checks come for free:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { themeChecks } from '../../../tests/theme.mjs';

themeChecks(test, assert, import.meta.url);
```

Run it:

```bash
pnpm test -- my-plugin     # one mod
pnpm test                      # all of them
pnpm check-structure -- my-plugin
```

jsdom cannot see the failures that matter most — a mod that wedges the renderer,
a mod that throws on start. `pnpm test:live` boots the real Slack, asks the
runtime what actually loaded, and turns the answer into an exit code. It closes
Slack afterwards, so it is not part of `pnpm test`.

---

## Ship it

Open a pull request adding your folder under `mods/`.

```bash
pnpm registry        # regenerate the catalogue, then commit it
node scripts/changed-mods.mjs   # what CI will run for you
```

CI gives **your mod its own jobs** — structure and tests — so somebody else's
broken mod cannot block your merge, and yours cannot block theirs.

Every mod is read by a human before it merges. A plugin runs unsandboxed in an
authenticated Slack tab, so that review is the security model.

**→ [CONTRIBUTING.md](../CONTRIBUTING.md) lists what gets a pull request
rejected.** Read it before you write, not after.

---

## Where things are

| | |
| --- | --- |
| [docs/api.md](api.md) | The plugin API, with an example per entry |
| [docs/themes.md](themes.md) | Slack's colour tokens, CSS traps, recipes |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Review rules and the PR checklist |
| [README.md](../README.md) | What BetterSlack is and how it works |
| [CLAUDE.md](../CLAUDE.md) | Notes for AI agents working in this repo |

## When something does not work

| Symptom | Cause |
| --- | --- |
| Mods stop working | BetterSlack stopped. Mods live exactly as long as the loader does, so quitting it (or closing the `pnpm start` terminal) takes them with it. |
| Your mod is not in the panel | `id` must equal the folder name. Run `pnpm check-structure -- <id>`. |
| Edits do not show up | Hot reload is off, or the mod is not enabled. Check the About tab. |
| A theme changes messages but not the sidebar | You only overrode the first token family — see [themes.md](themes.md). |
| `eval is not allowed` | Slack's CSP. There is no way around it; restructure. |
| `Failed to fetch` on a Slack CDN URL | No CORS headers. Use `api.files.save`. |
| Nothing in the console | Install the **DevTools** plugin, or press ⌘⌥I. |
| Slack comes up grey, or the panel never appears | A mod wedged the renderer. The next start applies nothing on its own; `--safe` forces it. Switch the suspect off, then start again. |
| A mod's row says it is not running | It threw during `start()`. Two failures and it is skipped at boot — switching it off and on again clears the count. |
| ⌘K opens Slack's switcher, not BetterSlack's | The **Command Palette** plugin is not installed or not enabled. Its own settings can move it to ⌘⇧K instead. |

