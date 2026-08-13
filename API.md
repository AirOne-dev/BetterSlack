# The SlackMod plugin API

A plugin is an ES module with a default export. `start(api)` receives everything
below; everything registered through `api` is undone when the plugin is
disabled, so `stop()` only needs to handle state the API does not know about.

```js
export default {
  start(api) { /* … */ },
  stop() {},
};
```

The shortest useful mod:

```js
export default {
  start(api) {
    api.slack.addToolbarButton('channelHeader', {
      id: 'hello', label: 'Say hello', icon: '<svg viewBox="0 0 20 20">…</svg>',
      onClick: () => api.ui.toast('Hello', { variant: 'success' }),
    });
  },
};
```

**Reach for `api.helpers` first.** It covers the shapes most mods need in one
call. Drop to `api.slack` / `api.dom` when you need something it does not.

---

## `api.helpers`

| | |
| --- | --- |
| `toggle({ key, className, defaultOn, whenOn, onChange })` | A persisted on/off flag that also puts a class on `<html>`, so the behaviour can be pure CSS. `whenOn` is CSS where `&` stands for the flag class. Returns `{ on, set(on), toggle() }`. |
| `hotkey(combo, handler, { when })` | `'mod+shift+f'`, where `mod` is ⌘ or Ctrl. `when` gates the **match**, not the handler — a shortcut that does not apply must not swallow the key. |
| `describeHotkey(combo)` | `⌘⇧F` or `Ctrl+Shift+F`, for labels and tooltips. |
| `mount(container, id, factory, { before })` | Keep an element in place across Slack's re-renders, without duplicates. |
| `each(selector, handler)` | Run a handler for every match, now and in future. |
| `badge(selector, id, () => value)` | A count badge pinned to an element, kept in sync. `null`/`0` hides it. |
| `tooltip(element, title, subtitle)` | Slack-styled tooltip on anything you built. |
| `copy(text, message)` | Clipboard write plus the confirmation and failure toasts. |
| `iconButton({ icon, label, description, surface, onClick })` | A button wearing Slack's classes for `composer`, `header`, `strip` or `message`. |
| `field(label, value)` | A labelled row in Slack's profile style. |
| `section(title, children)` | A pane section with Slack's own header styling. |
| `debounce(fn, ms)` | What you were about to write anyway. |

```js
const focus = api.helpers.toggle({
  key: 'on',
  className: 'my-focus',
  whenOn: `& .p-channel_sidebar { display: none !important; }`,
});
api.helpers.hotkey('mod+shift+f', () => focus.toggle());
```

## `api.slack`

Anchored to Slack's own chrome. Everything here uses Slack's classes, so buttons
match their neighbours in size, colour, hover and transition.

| | |
| --- | --- |
| `addToolbarButton(toolbar, { id, label, icon, description, before, onClick })` | `toolbar` is `'controlStrip'` (beside your avatar), `'composer'` (the formatting row) or `'channelHeader'`. `before` is a selector to sit above. |
| `addMessageAction({ id, label, icon, description, onClick })` | A button in the hover row on messages. `onClick` gets a `MessageRef`. |
| `addProfileButton({ id, label, icon, onClick })` | A button in the member profile pane. |
| `onProfilePane(handler)` | Runs each time a profile pane opens, with `{ element, userId }`. |
| `describeMessage(element)` | `{ element, channelId, ts, permalink, text }`. |
| `userIdFromMessage(message)` | The author, read from their avatar URL. |
| `currentChannelId()` | The open channel, from the client URL. |
| `composer` | `insertText`, `insertLink`, `focus`, `caretToEnd`, `isEmpty`, `element`. |
| `web` | Slack's own web API as the signed-in user. |
| `selectors` | The stable selectors behind all of the above. |

### `api.slack.web`

`available`, `teamDomain`, `selfId`, `call(method, params)`, `userInfo(id)`,
`presence(id)`, `teamInfo()`, `dndInfo(id)`.

Slack's API refuses cookie-only requests, so this reads the session token — in
**one** audited place (`src/runtime/web-api.ts`), which can only reach Slack's
own origin and never hands the token back. **A mod must not read the token
itself**; see CONTRIBUTING.md.

## `api.ui`

Widgets that need no CSS. They live in shadow roots, so a broken theme cannot
make them unusable, and they read Slack's design tokens, so they follow the
active theme.

| | |
| --- | --- |
| `toast(message, { variant, duration, action })` | `info`, `success`, `warning`, `error`. |
| `modal({ title, subtitle, content, actions, width, dismissible })` | Returns `{ body, close() }`. An action returning `false` keeps it open. |
| `confirm({ title, message, confirmLabel, danger })` | Resolves a boolean. |
| `tooltip(element, { title, subtitle, placement })` | The lower-level form of `helpers.tooltip`. |

## `api.dom`

| | |
| --- | --- |
| `h(tag, attrs, children)` | Element building. |
| `keepMounted(container, id, factory, options)` | What `helpers.mount` wraps. |
| `onEach(selector, handler)` | What `helpers.each` wraps. |
| `onShortcut(match, handler)` | Raw key binding; prefer `helpers.hotkey`. |
| `waitFor(selector, timeout)` | Resolves when an element appears, or `null`. |

## `api.files`, `api.settings`, `api.css`, `api.log`

```js
await api.files.save(url, filename);   // the loader fetches and saves it
api.settings.get(key, fallback);       // persisted per plugin in ~/.slackmod
await api.settings.set(key, value);
api.css('…');                          // one stylesheet, owned by your plugin
api.onDispose(fn);
api.log.info / warn / error
```

`api.files.save` exists because Slack's CDN serves without CORS headers, so a
`fetch` from the page always fails. The loader does it: https only, sanitised
file name, 25 MB cap, fixed directory.

---

## Rules that will save you an afternoon

- **`eval()` and `new Function()` throw.** Slack's CSP has no `'unsafe-eval'`.
  Note that code run from a DevTools console *is* exempt, so testing `eval`
  there misleads.
- **Never a raw `MutationObserver` to insert a node.** Slack re-renders
  constantly; use `helpers.mount`.
- **Anchor on `data-qa`, then design tokens.** Class names like
  `circleButton__cMiUK` are CSS-module output and change every build;
  `p-channel_sidebar__channel` is hand-written and stable.
- **Slack has four colour token families**, not one — see CONTRIBUTING.md. A
  theme that only overrides the first leaves the app chrome untouched.
- **Reuse Slack's classes rather than styling your own.** `helpers.iconButton`
  and `api.slack.addToolbarButton` already do.

## Testing

`tests/harness.mjs` gives a Slack-shaped jsdom and a recording stand-in for
`api`, wired to the **real** helpers — so a mod's test covers the helper code it
depends on:

```js
import { createTestApi, installDom } from '../../../tests/harness.mjs';
import plugin from './index.js';

const dom = installDom();
const { api, recorded } = createTestApi();
await plugin.start(api);
recorded.messageActions[0].onClick({ permalink: 'https://…' });
// assert on recorded.toasts, recorded.composerLink, recorded.saved, the DOM…
dom.cleanup();
```
