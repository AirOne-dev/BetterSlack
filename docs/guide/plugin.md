---
name: Your first plugin
title: Getting started
order: 2
---

A plugin is one folder and one file. This builds a working one from nothing —
a button in Slack's channel header that says hello — and then shows where each
piece comes from.

Everything here is live in the client as you save it. Mods hot-reload: the
loader watches `mods/`, so there is no build step and no restart for anything
under it.

## 1. Make the folder

There is a generator, and it writes a mod that already passes the checks:

```bash
pnpm new-mod plugin hello "Says hello from the channel header"
```

If you would rather see every file, the rest of this page is what it wrote.

## 2. `mods/plugins/hello/mod.json`

```json
{
  "id": "hello",
  "name": "Hello",
  "type": "plugin",
  "version": "1.0.0",
  "author": "your-github-handle",
  "description": "One sentence about what a user gets, not how it works.",
  "entry": "index.js",
  "betterslackApi": 1
}
```

`id` has to match the folder name. `pnpm validate-mods` says so if it does not.

## 3. `mods/plugins/hello/index.js`

A plugin is an ES module with one export. `start` is handed the API and may be
async; anything it registers is undone when the mod is switched off.

```js
const ICON = `<svg viewBox="0 0 20 20" aria-hidden="true">
  <circle cx="10" cy="10" r="7" fill="none"
          stroke="currentColor" stroke-width="1.6"/>
</svg>`;

export default {
  start(api) {
    api.slack.addToolbarButton('channelHeader', {
      id: 'hello',
      label: 'Say hello',
      icon: ICON,
      onClick: () => api.ui.toast('Hello', { variant: 'success' }),
    });
  },
};
```

That is the whole mod. Open the panel with `⌘⇧M`, install it from **Browse**,
switch it on, and the button is in the channel header.

## 4. Give it a setting

Settings are declared in the manifest and drawn by the panel — you do not build
a form. Add this to `mod.json`:

```json
{
  "settings": [
    { "key": "greeting", "type": "text", "label": "What to say", "default": "Hello" }
  ]
}
```

and read it where you need it:

```js
const greeting = api.settings.get('greeting', 'Hello');
api.ui.toast(greeting, { variant: 'success' });
```

`api.settings.onChange` fires when the user edits it, so a mod can redraw
without being switched off and on.

## 5. Speak the reader's language

Every shipped plugin has English and French, and a test fails a mod whose
tables do not cover the same keys. English is required, and is what an unknown
language falls back to.

```js
const t = api.i18n.strings({
  en: { hello: 'Hello' },
  fr: { hello: 'Bonjour' },
});
api.ui.toast(t('hello'));
```

## 6. Reach for the helpers before the DOM

`api.helpers` is where most of a mod's work already exists. The four that come
up most:

```js
// A persisted flag plus a class on <html>, so the behaviour can be pure CSS.
await api.helpers.toggle({
  key: 'quiet',
  className: 'hello-quiet',
  whenOn: 'html.hello-quiet .p-channel_sidebar { display: none }',
});

// Keep a node in a container Slack keeps re-rendering away.
api.helpers.mount('.p-view_header__actions', 'hello-mark',
  () => api.dom.h('span', {}, ['·']));

// A shortcut, with a guard that gates the match rather than the handler.
api.helpers.hotkey('mod+shift+h', () => api.ui.toast('Hello'), { when: () => true });

// Run for every match now and for every one that arrives later.
api.helpers.each('[data-qa="message_container"]', (message) => { /* … */ });
```

Never write a raw `MutationObserver` to insert something. Slack re-renders
constantly and you will get duplicates; `mount` and `each` handle it, and give
up loudly rather than looping if a container fights back.

## 7. Test it

A mod's test runs against a recording fake API — no Slack, no browser:

```bash
pnpm test -- hello
```

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, fakeApi } from '../../../tests/harness.mjs';

test('adds a button to the channel header', async () => {
  const api = fakeApi();
  await (await load(import.meta.url)).start(api);
  assert.equal(api.slack.toolbarButtons[0].toolbar, 'channelHeader');
});
```

Assert on what a user would notice, not on how you got there.

## 8. Ship it

```bash
pnpm check
```

One command: types, build, manifests, the registry, the site, and every test.
It regenerates `mods/registry.json`, which is committed — a dirty tree after it
means the catalogue had drifted, and the fix is to commit it.

Then open a pull request. A human reads it, and that review is the security
model: a plugin runs unsandboxed in an authenticated Slack tab.
`CONTRIBUTING.md` lists what gets rejected.

## Three things that will catch you out

- **`eval()` and `new Function()` throw.** Slack's Content Security Policy has
  no `'unsafe-eval'`. They *work* in a DevTools console, which misleads.
- **Anchor on `data-qa` attributes**, then on design tokens. A class like
  `circleButton__cMiUK` is CSS-module output and changes every Slack build;
  `p-channel_sidebar__channel` is stable.
- **Switching workspace does not reload the client.** Same page, same mods, new
  team id in the URL. Anything cached at boot then belongs to the workspace the
  user has left, so watch the team in the URL and drop per-workspace state.
