# Getting started

Three tracks. Pick the one you need:

- **[Just run it](#just-run-it)** — you want SlackMod on your Slack.
- **[Write a theme](#write-a-theme)** — you want Slack to look different.
- **[Write a plugin](#write-a-plugin)** — you want Slack to *do* something new.

Then: [test it](#test-your-mod) and [ship it](#ship-it).

---

## Just run it

Requires Node 18+ and the Slack desktop app.

```bash
git clone https://github.com/AirOne-dev/SlackMod.git
cd SlackMod
npm install
npm run build
npm start
```

`npm start` closes Slack, starts it again with SlackMod attached, and stays
running. Leave that terminal open — mods are only active while it runs.

You should see, in Slack:

- a **sliders button** just above your avatar, bottom-left;
- the same panel on **⌘⇧M** (Ctrl+Shift+M elsewhere).

Nothing is installed on a fresh setup. Open the panel → **Plugins** or
**Themes** → **Browse** → *Install*, then flip the switch to turn it on.

<details>
<summary>Slack isn't where SlackMod expects it</summary>

```bash
SLACKMOD_SLACK_PATH=/path/to/Slack npm start
```
</details>

<details>
<summary>Start it without a terminal (macOS)</summary>

```bash
npm run build-app       # produces dist/SlackMod.app
```

It is unsigned, so the first launch needs right-click → Open.
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
  "slackmodApi": 1
}
```

`id` must match the folder name.

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

### More than one file

A big theme reads better in pieces. `@import` a relative path and SlackMod
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
SlackMod resolves them for you:

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

Three rules, all of them enforced by `npm run validate-mods`:

- **Relative specifiers only** — `./x.js`, `../lib/x.js`. There is no npm and no
  CDN in the page; a bare `import 'lodash'` has nothing to resolve to.
- **Stay inside your folder.** `../../other-plugin/index.js` is rejected: mods
  are installed one at a time, and yours may be the only one there.
- **No cycles.** A file may not import, directly or transitively, something that
  imports it back.

Why the rules: the page has no `'unsafe-eval'`, so a plugin is loaded as a real
ES module through a `blob:` URL — and a blob URL has no directory for a relative
path to resolve against. SlackMod therefore reads your whole folder, builds a
blob per file leaves-first, and rewrites each relative specifier to the blob URL
of the file it names. The module you wrote is the module that runs; only the
specifiers change. `.css` files in the folder are shipped too, for
`api.css.inject(...)`.

### 5. Read a real one

[`channel-notes`](../mods/plugins/channel-notes/index.js) is the worked example
— a button, a modal, settings, a confirm, a toast, and no CSS at all.
[`focus-mode`](../mods/plugins/focus-mode/index.js) is almost entirely one
`toggle()` call. [`quote-reply`](../mods/plugins/quote-reply/index.js) is the
shortest useful one.

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
npm run test:mod -- my-plugin     # one mod
npm test                          # all of them
npm run check-structure -- my-plugin
```

---

## Ship it

Open a pull request adding your folder under `mods/`.

```bash
npm run registry        # regenerate the catalogue, then commit it
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
| [README.md](../README.md) | What SlackMod is and how it works |
| [CLAUDE.md](../CLAUDE.md) | Notes for AI agents working in this repo |

## When something does not work

| Symptom | Cause |
| --- | --- |
| Mods stop working | The `npm start` terminal was closed. Mods live as long as the loader. |
| Your mod is not in the panel | `id` must equal the folder name. Run `npm run check-structure -- <id>`. |
| Edits do not show up | Hot reload is off, or the mod is not enabled. Check the About tab. |
| A theme changes messages but not the sidebar | You only overrode the first token family — see [themes.md](themes.md). |
| `eval is not allowed` | Slack's CSP. There is no way around it; restructure. |
| `Failed to fetch` on a Slack CDN URL | No CORS headers. Use `api.files.save`. |
| Nothing in the console | Install the **DevTools** plugin, or press ⌘⌥I. |
