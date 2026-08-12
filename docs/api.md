# The plugin API

Everything `start(api)` gives you, with an example for each. New here? Start
with **[getting-started.md](getting-started.md)**.

```js
export default {
  start(api) { /* … */ },
  stop() {},          // usually empty: the API cleans up after itself
};
```

Anything registered through `api` is undone when the plugin is switched off.
`stop()` is only for state the API cannot know about.

**Jump to:** [helpers](#apihelpers) · [slack](#apislack) · [ui](#apiui) ·
[dom](#apidom) · [settings](#apisettings) · [files](#apifiles) ·
[css](#apicss) · [log](#apilog) · [recipes](#recipes)

---

## `api.helpers`

The first thing to reach for. Most mods are one or two of these.

### `toggle(options)`

A persisted on/off flag that also puts a class on `<html>`, so the behaviour can
be pure CSS. `whenOn` is CSS where `&` stands for the flag class.

```js
const zen = api.helpers.toggle({
  key: 'on',                       // settings key it persists under
  className: 'my-zen',             // optional; defaults to slackmod-<plugin>-<key>
  defaultOn: false,
  whenOn: `
    & .p-channel_sidebar { display: none !important; }
    & .p-tab_rail        { display: none !important; }
  `,
  onChange: (on) => api.log.info(on ? 'on' : 'off'),
});

zen.on;              // boolean
await zen.set(true);
await zen.toggle();  // returns the new state
```

### `hotkey(combo, handler, { when })`

`mod` is ⌘ on macOS and Ctrl elsewhere. **`when` gates the match, not the
handler** — a shortcut that does not apply must not swallow the key.

```js
api.helpers.hotkey('mod+shift+k', () => api.ui.toast('Hi'));

// Escape, but only when we are the ones who should handle it
api.helpers.hotkey('escape', () => zen.set(false), {
  when: () => zen.on && !document.querySelector('.ReactModal__Content'),
});
```

### `describeHotkey(combo)`

```js
api.helpers.describeHotkey('mod+shift+k');  // '⌘⇧K' or 'Ctrl+Shift+K'
```

### `mount(container, id, factory, { before })`

Keep an element somewhere across Slack's re-renders, without duplicates. Use
this instead of a `MutationObserver`.

```js
api.helpers.mount('[data-qa="message_input"]', 'my-counter', () =>
  api.dom.h('div', { class: 'my-counter' }, ['0']));

// sit above an existing button rather than after it
api.helpers.mount('.p-control_strip', 'my-button', makeButton, {
  before: '#slackmod-control-button',
});
```

### `each(selector, handler)`

Runs for every match now, and for every one that appears later.

```js
api.helpers.each('[data-qa="message_container"]', (message) => {
  message.dataset.seen = 'true';
});
```

### `badge(selector, id, value)`

A count badge pinned to an element, kept in sync. `null` or `0` hides it.

```js
let unread = 0;
api.helpers.badge('[data-qa="slackmod_button"]', 'unread', () => unread);
```

### `tooltip(element, title, subtitle?)`

Slack's tooltip on anything you built yourself.

```js
api.helpers.tooltip(myButton, 'Archive', 'Moves it out of your sidebar');
```

### `copy(text, message?)`

Clipboard write, confirmation toast, and the failure toast if it goes wrong.

```js
await api.helpers.copy(message.permalink, 'Link copied');
```

### `iconButton(options)`

A button wearing Slack's classes for a given surface, with its tooltip.

```js
const button = api.helpers.iconButton({
  icon: '<svg viewBox="0 0 20 20">…</svg>',
  label: 'Pin',
  description: 'Keep this at the top',
  surface: 'header',        // 'composer' | 'header' | 'strip' | 'message'
  onClick: () => pin(),
});
```

### `field(label, value)` and `section(title, children)`

Slack's own profile row and pane section, so injected content looks native.

```js
const { field, section } = api.helpers;
pane.append(section('More details', [
  field('User ID', user.id),
  field('Time zone', user.tz_label),
]));
```

### `debounce(fn, ms)`

```js
const search = api.helpers.debounce((q) => run(q), 200);
```

---

## `api.slack`

Slack's own surfaces. Everything here uses Slack's classes, so buttons match
their neighbours in size, colour, hover and transition.

### `addToolbarButton(toolbar, button)`

`toolbar` is `'controlStrip'` (beside your avatar), `'composer'` (the formatting
row) or `'channelHeader'`.

```js
api.slack.addToolbarButton('controlStrip', {
  id: 'notes',
  label: 'Notes',
  description: 'A scratchpad for this channel',   // second tooltip line
  icon: '<svg viewBox="0 0 20 20">…</svg>',
  before: '#slackmod-control-button',             // optional: sit above it
  onClick: () => open(),
});
```

### `addMessageAction(action)`

A button in the hover row on every message, next to Reply and Forward.

```js
api.slack.addMessageAction({
  id: 'copy-link',
  label: 'Copy link to message',
  icon: '<svg viewBox="0 0 20 20">…</svg>',
  onClick: (message) => api.helpers.copy(message.permalink),
});
```

`message` is a `MessageRef`:

```js
{ element, channelId, ts, permalink, text }
```

### `addProfileButton(button)` and `onProfilePane(handler)`

```js
api.slack.addProfileButton({
  id: 'details',
  label: 'Details',
  onClick: (pane) => show(pane.userId),
});

api.slack.onProfilePane(({ element, userId }) => {
  element.append(api.helpers.section('Extra', [api.helpers.field('ID', userId)]));
});
```

### `describeMessage(element)`, `userIdFromMessage(message)`, `currentChannelId()`

```js
const message = api.slack.describeMessage(el);
const author  = api.slack.userIdFromMessage(message);   // 'U0123…'
const channel = api.slack.currentChannelId();           // 'C0123…'
```

### `composer`

```js
const c = api.slack.composer;
c.element();                       // the contenteditable, or null
c.isEmpty();
c.focus();
c.caretToEnd();
c.insertText(' hello');
c.insertLink('https://…', '.');    // a real hyperlink, http(s) only
```

### `web` — Slack's web API as you

```js
if (api.slack.web.available) {
  const user = await api.slack.web.userInfo('U0123');
  const { presence } = await api.slack.web.presence('U0123');
  const team = await api.slack.web.teamInfo();
  const dnd  = await api.slack.web.dndInfo('U0123');
  const any  = await api.slack.web.call('conversations.info', { channel: 'C0123' });
}
```

Slack refuses cookie-only requests, so this reads the session token — in **one**
audited place ([`src/runtime/web-api.ts`](../src/runtime/web-api.ts)), which can
only reach Slack's own origin and never hands the token back. **A mod must never
read that token itself.**

### `selectors`

The stable selectors behind all of the above, for going off-road:
`message`, `messageActions`, `composer`, `composerEditor`, `channelSidebar`,
`tabRail`, `topNav`, `messageText`, `profilePane`, `profileAvatar`.

---

## `api.ui`

Widgets that need no CSS. They live in shadow roots — a broken theme cannot make
them unusable — and read Slack's design tokens, so they follow the active theme.

### `toast(message, options)`

```js
api.ui.toast('Saved', { variant: 'success' });   // info | success | warning | error
const t = api.ui.toast('Working…', { duration: 0 });
t.dismiss();

api.ui.toast('Deleted', { action: { label: 'Undo', onClick: () => restore() } });
```

### `modal(options)`

```js
const dialog = api.ui.modal({
  title: 'Channel notes',
  subtitle: 'Stored on this machine only.',
  content: textarea,          // a string or any Node
  width: 560,
  actions: [
    { label: 'Clear', onClick: async () => {
        const sure = await api.ui.confirm({ title: 'Clear?', message: '…', danger: true });
        return sure;          // returning false keeps the modal open
      } },
    { label: 'Save', variant: 'primary', onClick: () => save() },
  ],
});

dialog.body;     // the element holding `content`, for live updates
dialog.close();
```

### `confirm(options)`

```js
const sure = await api.ui.confirm({
  title: 'Delete these notes?',
  message: 'This cannot be undone.',
  confirmLabel: 'Delete',
  danger: true,
});
```

### `tooltip(element, options)`

The lower-level form of `helpers.tooltip`, when you need placement:

```js
api.ui.tooltip(el, { title: 'SlackMod', subtitle: '⌘⇧M', placement: 'right' });
```

---

## `api.dom`

```js
api.dom.h('div', { class: 'x' }, ['text', childNode]);
await api.dom.waitFor('[data-qa="message_input"]', 5000);   // element or null
api.dom.keepMounted(container, id, factory, { before });     // helpers.mount wraps this
api.dom.onEach(selector, handler);                           // helpers.each wraps this
api.dom.onShortcut((e) => e.key === 'F1', handler);          // prefer helpers.hotkey
```

---

## `api.settings`

Persisted per plugin, in `~/.slackmod/settings.json`.

```js
const limit = api.settings.get('limit', 4000);   // with a fallback
await api.settings.set('limit', 3000);
api.settings.all();                              // the whole bag
```

## `api.files`

```js
const { path, bytes } = await api.files.save(url, 'avatar.png');
```

The loader does the fetching, because Slack's CDN serves without CORS headers
and a `fetch` from the page always fails. https only, the file name is
sanitised, 25 MB cap, fixed download directory.

## `api.css`

One stylesheet per plugin, replaced wholesale on each call, removed when the
plugin stops.

```js
api.css(`.my-thing { color: var(--dt_color-content-pry, #1d1c1d); }`);
```

## `api.log`

```js
api.log.info('ready');
api.log.warn('no permalink on this message');
api.log.error(err);
```

Prefixed with your plugin id and visible in DevTools.

---

## Plugins a theme brings in

Themes are CSS. When a look needs behaviour, the theme lists a plugin in
`requires` and the panel offers to switch it on. Nothing about this API changes:
such a plugin is an ordinary plugin, gets this same object, and should be worth
installing on its own.

**→ [themes.md](themes.md#when-css-is-not-enough)**

## Recipes

**A button that toggles a mode, with a shortcut**

```js
const zen = api.helpers.toggle({ key: 'on', whenOn: `& .p-channel_sidebar { display: none !important }` });
api.helpers.hotkey('mod+shift+z', () => zen.toggle());
api.slack.addToolbarButton('controlStrip', {
  id: 'zen', label: 'Zen mode',
  description: `Hide the sidebar · ${api.helpers.describeHotkey('mod+shift+z')}`,
  icon: ICON, onClick: () => zen.toggle(),
});
```

**React to every new message**

```js
api.helpers.each('[data-qa="message_container"]', (el) => {
  const { text, permalink } = api.slack.describeMessage(el);
  if (text.includes('deploy')) el.style.outline = '2px solid orange';
});
```

**Answer a message in-channel with an unfurl**

```js
api.slack.addMessageAction({
  id: 'reply', label: 'Reply', icon: ICON,
  onClick: (message) => {
    if (!message.permalink) return;
    api.slack.composer.insertLink(message.permalink, '.');
    api.slack.composer.insertText(' ');
    api.slack.composer.focus();
  },
});
```

**Show more about a person inside their profile**

```js
api.helpers.mount('[data-qa="member_profile_pane"]', 'my-extra', () => {
  const host = api.dom.h('div');
  const avatar = document.querySelector('.p-r_member_profile__avatar__img');
  const id = avatar?.src.match(/\/T[A-Z0-9]+-(U[A-Z0-9]+)-/i)?.[1];
  if (id) {
    void api.slack.web.userInfo(id).then((user) => {
      host.append(api.helpers.section('More', [
        api.helpers.field('Time zone', user.tz_label ?? '—'),
      ]));
    });
  }
  return host;
});
```

**Save a file**

```js
const user = await api.slack.web.userInfo(userId);
await api.files.save(user.profile.image_original, `${user.name}.png`);
```

---

## Testing what you built

`tests/harness.mjs` records everything a mod registers, and is wired to the
**real** helpers — so your test covers the helper code your mod depends on.

| Recorded | Holds |
| --- | --- |
| `recorded.toolbarButtons` | `{ toolbar, button }` per `addToolbarButton` |
| `recorded.messageActions` | each `addMessageAction` |
| `recorded.profileButtons` | each `addProfileButton` |
| `recorded.toasts` / `modals` / `confirms` | what `api.ui` was asked to show |
| `recorded.composerLink` / `composerText` | what was inserted |
| `recorded.saved` | `api.files.save` calls |
| `recorded.css`, `recorded.disposers`, `recorded.logs` | the rest |
| `dom.recorded.clipboard`, `dom.recorded.downloads` | browser side effects |

See [getting-started.md](getting-started.md#test-your-mod) for a full example.
