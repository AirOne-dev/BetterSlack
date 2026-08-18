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
[dom](#apidom) · [files](#apifiles) · [slack.web](#apislackweb--users-and-availability) ·
[ui.menu](#apiuimenu) · [ui.kit](#apiuikit) · [app](#apiapp) ·
[ui.palette](#apiuipalette) · [commands](#apicommands) · [settings](#apisettings) ·
[themes](#apithemes) · [assets](#apiassets) · [css](#apicss) · [log](#apilog) ·
[i18n](#apii18n) · [recipes](#recipes)

---

## Your mod is a folder

`entry` in `mod.json` is where the app starts reading, not the whole mod. Split
the rest however the code wants to be split:

```
mods/plugins/my-plugin/
  mod.json        "entry": "index.js"
  index.js        import { render } from './ui/panel.js';
  ui/panel.js     import { format } from '../lib/format.js';
  ui/panel.css    api.css(api.assets.text('ui/panel.css'));
  lib/format.js
  test.mjs
```

Relative specifiers only, inside your own folder, no cycles — all three are
enforced by `pnpm validate-mods`, so a mistake fails the pull request rather
than the app.

The reason: Slack's CSP has no `'unsafe-eval'`, so a plugin is loaded as a real
ES module through a `blob:` URL — and a blob URL has no directory for `./x.js`
to resolve against. BetterSlack reads the whole folder, makes a blob per file
leaves-first, and rewrites each relative specifier to the blob URL of the file
it names. Nothing else in your source is touched: comments, formatting and line
numbers survive, so stack traces still point where you think they do. A JSDoc
`{import('…/api.js')}` is a comment, and is left alone.

Themes work the same way with `@import './tokens.css'` — see
[themes.md](themes.md#splitting-a-theme-across-files).

---

## `api.helpers`

The first thing to reach for. Most mods are one or two of these.

### `toggle(options)`

A persisted on/off flag that also puts a class on `<html>`, so the behaviour can
be pure CSS. `whenOn` is CSS where `&` stands for the flag class.

```js
const zen = api.helpers.toggle({
  key: 'on',                       // settings key it persists under
  className: 'my-zen',             // optional; defaults to betterslack-<plugin>-<key>
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

### `poll(handler, everyMs)`

Run something on an interval that **stops while the window is hidden**.

```js
api.helpers.poll(() => refreshPresence(), 60_000);
```

Slack does not render while its window is hidden, so a poll that keeps going in
the background is requests nobody will see the result of — and, for anything
hitting Slack's API, requests against a rate limit shared with the client
itself. Runs once immediately, catches up when the window comes back, never
overlaps itself, and stops with the plugin.

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
  before: '#betterslack-control-button',
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
api.helpers.badge('[data-qa="betterslack_button"]', 'unread', () => unread);
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
  before: '#betterslack-control-button',             // optional: sit above it
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

### `desktop` — Slack's own preferences, and `restart()`

Slack keeps its desktop preferences in a plain JSON file — `root-state.json`,
in Application Support — well outside the signed `app.asar`. The loader can read
and write it; a mod asks through here.

```js
const { desktop } = api.slack;
if (desktop.supported) {                       // false where there is no such file
  desktop.get('windowVibrancy');               // what the file says now
  desktop.launched('windowVibrancy');          // what this Slack was started with
  desktop.needsRestart('windowVibrancy');      // true: read when a window opens

  await desktop.set('windowVibrancy', true);   // and keep it there
  await desktop.clear('windowVibrancy');       // stop keeping it
  desktop.managed();                           // only what BetterSlack is keeping set
}

desktop.keys();  // every preference this API will touch, with a note on each
```

| | |
| --- | --- |
| `supported` | there is a Slack settings file to read — macOS and Windows |
| `keys()` | `[{ key, type, restart, note }]`, the whole allow-list |
| `get(key)` | the current value |
| `launched(key)` | what the running Slack was started with |
| `needsRestart(key)` | whether the value is only read when a window opens |
| `set(key, value)` | write it, and keep writing it before every launch |
| `clear(key)` | stop managing it and leave whatever is there |
| `managed()` | the keys BetterSlack is keeping set |
| `materials` | the window materials that can be worn, clearest first |
| `setMaterial(name)` | put one on, now — no restart |

**The material is live, and it is the one thing here that is.** Slack's main
process runs an allow-listed set of `BrowserWindow` methods on behalf of the
page, and its preload passes that through; `setVibrancy` is on the list. So a
mod can change how frosted the window is without touching a preference or
restarting anything:

```js
api.slack.desktop.materials;              // ['hud', 'fullscreen-ui', 'under-window', 'titlebar', 'none']
await api.slack.desktop.setMaterial('hud');   // false where the bridge is absent
```

Measured against one wallpaper, with the page's own backgrounds cleared — the
number is the first decile of the frame, which is the backdrop coming through,
and the wallpaper alone reads 3:

| | | |
| --- | --- | --- |
| `hud` | 22 | the clearest |
| `fullscreen-ui` | 24 | |
| `under-window` | 33 | |
| `titlebar` | 43 | what Slack asks for, and the frostiest |
| `none` | 29 | the material removed — still not clear |

**It only shows on a window created translucent.** On an ordinary opaque window
`setMaterial` succeeds and changes nothing: measured, 27.3 before and after. So
`windowVibrancy` and its restart are still what makes any of this visible; the
material only decides how much veil is left.

**A named list, not the settings object.** That file also holds the workspaces
you are signed in to and how to reach them, and a plugin runs unsandboxed in an
authenticated Slack. The loader refuses any key outside
[`SLACK_PREFS`](../src/shared/protocol.ts) by name, and refuses a value of the
wrong type. The list is shared between the loader and this API, so a key cannot
be offered here and rejected there.

**`set` means "keep it this way".** The loader writes it through at once and
again before every launch, because Slack owns that file too. `clear` hands the
key back.

**Some of them need a restart.** `windowVibrancy` is the reason this exists —
Slack can draw a translucent window and ships with it off — and a window's
material is fixed when the window opens. Compare `get` with `launched` to know
whether a restart would actually change anything, then offer one:

```js
if (desktop.get(key) !== desktop.launched(key)) {
  const yes = await api.ui.confirm({
    title: 'Restart Slack?',
    message: 'Slack needs to restart for this to take effect.',
    confirm: 'Restart Slack',
  });
  if (yes) await api.slack.restart();
}
```

### `restart()`

Stops Slack and starts it again with the loader still driving, applying
whatever `desktop.set` has been asked for. **It tears down the page that called
it**, so do nothing afterwards, and never call it without asking first — the
user is in the middle of a conversation.

These were built for a translucency mod that has since been dropped; they are
kept because they are the only way a mod can reach a Slack preference or ask for
a restart, and because what they cost to find is written down beside them.

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
api.ui.tooltip(el, { title: 'BetterSlack', subtitle: '⌘⇧M', placement: 'right' });
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

## `api.files`

```js
const { path, bytes } = await api.files.save(url, 'avatar.png');
```

The loader does the fetching, because Slack's CDN serves without CORS headers
and a `fetch` from the page always fails. https only, the file name is
sanitised, 25 MB cap, fixed download directory.

## `api.slack.web` — users and availability

```js
// One request for the lot, cached for the session, dropped when the workspace
// changes. `users.info` takes a comma-separated list; this is that, with the
// per-user fallback if Slack ever stops accepting it.
const users = await api.slack.web.users(['U1', 'U2', 'U3']);   // Map<id, SlackUser>

// Presence and do-not-disturb folded into the one answer a dot needs. Never
// rejects: a status that cannot be read is `unknown`, not an error.
const { state, presence, dnd } = await api.slack.web.availability('U1');
//     ^ 'active' | 'away' | 'dnd' | 'unknown'
```

`dnd_enabled` on its own is a *schedule*, not a state — someone with quiet hours
every night is not away all day — so `dnd` means snoozed now, or inside the
window `dnd.info` describes.

```js
// The same avatar at another size: Slack serves them as `<base>-<size>`.
api.slack.avatarUrl(url, 72);     // null for anything that is not one of Slack's
```

## `api.ui.menu`

Slack's overflow menu, against an anchor you give it.

```js
const close = api.ui.menu(button, [
  { label: 'Copy link', onSelect: () => api.helpers.copy(url, 'Copied') },
  { label: 'Open in Slack', onSelect: () => api.slack.openUserProfile(userId) },
  { label: 'Hide', danger: true, onSelect: hide },
], { align: 'left' });
```

Borrowed rather than drawn: it wears `c-menu`, so it follows every theme,
including one being edited. One menu is open at a time, Escape and a click
outside close it, and it flips above the anchor when there is no room below —
which is always, for a button in the control strip.

## `api.ui.kit`

Slack's design system, as components, bound to a document.

Inside the client, Slack's own classes are the right answer — the Mods panel
wears `.c-dialog` and `.c-button` and follows every theme for free. They are not
available anywhere else: a mod that opens a window of its own gets a blank
document with no stylesheet in it, which is how the theme builder ended up
rebuilding a button, an input, a card, a popover and a dialog by hand.

```js
const child = window.open('', 'my-tool', 'width=720,height=640');
child.document.head.append(Object.assign(
  child.document.createElement('style'),
  { textContent: api.ui.kitCss },
));

const kit = api.ui.kit(child.document);
child.document.body.append(kit.card('Colours', [
  kit.field('Name', kit.input({ value: 'Midnight' }), 'Shown in the Themes list.'),
  kit.button('Save', { variant: 'primary', onClick: save }),
]));
```

| | |
| --- | --- |
| `el(tag, props?, children?)` | element builder; `class`, `html`, and anything hyphenated becomes an attribute |
| `button(label, { variant, icon, title, wide, onClick, onHover })` | `default` · `primary` (Slack's confirm green) · `ghost` · `danger` |
| `iconButton(svg, { onClick, title, danger })` | a quiet square button |
| `field(label, control, hint?)` | label, control, and the sentence under it |
| `input(props?)` / `select(options, { onChange })` | a class you pass is **added**, not substituted |
| `segmented(options, { onChange })` | a row of tabs that behaves like a select; `{ node, set, value }` |
| `card(title, children, { subtitle, actions })` | the titled block everything else sits in |
| `emptyState(title, body, action?)` | what a view shows before it has anything |
| `swatch(css, { size })` | a colour over a checkerboard, so transparency reads |
| `popover(content, anchor, { onClose })` | anchored to what was clicked, flipped to stay in view |
| `confirm({ title, body, action, cancel, danger })` | resolves `false` when dismissed |
| `copyText(text)` | clipboard, falling back to `execCommand` when the document is not focused |
| `hoverable(node, { enter, leave })` | also bound to focus, so a keyboard gets the same information |
| `code(options)` | a CSS editor that colours what you type — see below |
| `api.ui.kitCss` | the stylesheet. Put it in the document the kit is building in |

Everything is prefixed `sm-`, so the stylesheet is safe to inject into the
client itself. Its palette is Slack's own dark one, fixed rather than read from
the app's tokens — a tool that repaints itself with the theme being edited
becomes unreadable exactly when the theme is wrong. Override the `--sm-*`
variables if you want it to follow the theme instead.

**The kit moves, and how much is yours to set.** Controls ease under the
pointer, dip when pressed, and dialogs and popovers arrive on a spring. All of
it is expressed as six tokens rather than as forty declarations, so a document
can retune the whole system by redefining them — or stop it entirely by zeroing
the last two, which are the only source of travel in there:

```js
// In a window your mod opened, next to api.ui.kitCss.
child.document.documentElement.style.setProperty('--sm-motion-base', '90ms');
child.document.documentElement.style.setProperty('--sm-motion-shift', '0px');
```

| | default | |
| --- | --- | --- |
| `--sm-motion-quick` | `120ms` | hover, focus, press |
| `--sm-motion-base` | `200ms` | anything that arrives |
| `--sm-motion-ease` | `cubic-bezier(.2,.9,.25,1)` | decelerating; almost everything |
| `--sm-motion-spring` | `cubic-bezier(.22,1.4,.36,1)` | overshoots; only for arrivals |
| `--sm-motion-shift` | `8px` | how far things travel |
| `--sm-motion-pop` | `.06` | how much they scale |

`prefers-reduced-motion` zeroes the last two on its own — fades stay, travel
goes — because a window a mod opened has no other stylesheet to honour it. The
[`motion`](../mods/plugins/motion) mod sets all six from its own dials, so kit
components inside the client keep the same tempo as the rest of Slack.

### `kit.code(options)`

A CSS editor with syntax highlighting, used by the theme builder and by the
custom stylesheet in the Mods panel.

```js
const editor = kit.code({
  value: current,
  rows: 12,
  placeholder: ':root { --dt_color-content-pry: #e8e8ea; }',
  onChange: (css) => apply(css),
});
container.append(editor.node);
editor.value();          // what is in it
editor.set(text);        // replace it
```

Tab indents instead of moving focus. `readOnly: true` gives a highlighted,
non-editable view — a generated stylesheet, for instance.

## Installing a mod from outside this repository

The Browse shelf takes a GitHub URL — a repository, or a folder inside one. It
is read and described first, and installed only after a dialog that says what it
means: a plugin runs unsandboxed in a signed-in Slack and can read every message
and the session token, and nobody in this project has reviewed it. The mod then
carries an **unreviewed** badge for as long as it exists, recorded in its
manifest so a restart cannot lose it.

The catalogue's security model is human review. This is the explicit exception,
and it is labelled as one.

## `api.app`

BetterSlack itself, for the mods that extend it rather than Slack.

```js
api.app.mods();     // [{ id, name, description, type, installed, enabled, settings }]
await api.app.setEnabled('midnight', true);
await api.app.setInstalled('aurora', true);
api.app.openPanel('themes');       // or no argument for wherever it was
api.app.openMod('channel-notes');  // the panel, on that mod, settings unfolded
api.app.commands();                // what every other mod has registered
```

`settings` is how many controls the mod declared in its manifest — 0 for one
there is nothing to configure. Offer "Configure" only above 0, and only while
the mod is on: the panel hides a switched-off mod's controls, so the row would
lead to an empty box. `openMod` points at the panel rather than reimplementing
it, because the panel is where a manifest's settings are drawn, checked and
saved.

Small on purpose, and here rather than on `window`: a mod that wants to list the
catalogue or open the panel should not be reaching into the page for it. The
Command Palette plugin is what it exists for — it is an ordinary mod, and it can
be switched off.

## `api.ui.palette`

The command palette, as a component. You supply the list; it draws it, ranks it
as you type, walks it with the arrow keys (or `ctrl+n` / `ctrl+p`) and closes on
Escape.

```js
const palette = api.ui.palette(source, {
  placeholder: 'Type a command…',
  empty: 'Nothing matches.',
  openHint: 'open',                 // the footer: "↵ open · esc close"
  closeHint: 'close',
  searching: 'searching…',          // while a source is still answering
  modes: [                          // prefixes that narrow the list
    { id: 'actions', prefix: '/', label: 'Actions', placeholder: 'Run an action…' },
    { id: 'people', prefix: '@', label: 'People' },
  ],
});

palette.refresh();                  // paint again — an answer arrived late
palette();                          // the cleanup: close it
```

**The source is a list or a function.** A function is called on every keystroke
with `(query, mode)` — `mode` being the id of the prefix in use, or `null` — and
may return a promise, in which case only the answer to the newest query is
painted:

```js
const source = (query, mode) => {
  if (mode === 'people') return people(query);      // instant, from memory
  void searchSlack(query);                          // and repaint when it lands
  return [...conversations(query), ...actions(query)];
};
```

Answering synchronously is what makes a palette feel instant, so hand back what
is already in memory and call `refresh()` when the network answers. Typing a
prefix turns it into a chip in front of the field — the mode is visible rather
than remembered — and Backspace or Escape takes it off again.

An entry:

| | |
| --- | --- |
| `id` | unique within your mod |
| `title` | what is read first, so put the distinguishing word early |
| `section` | the heading it is grouped under; entries with none come first |
| `source` | where it came from, shown greyed on the right |
| `subtitle` | one line under the title |
| `icon` | an image URL (an avatar), an emoji, or one or two characters like `#` |
| `always` | keep it whatever the query is — for rows a server already matched |
| `run()` | may return a promise; the palette closes first |

`always` exists because the palette ranks what it is given against what is on
screen: someone found by their email, or by a real name behind a nickname, would
otherwise be filtered straight back out.

Rows carry a picture of what they are, because a list of identical rows takes as
long to scan as it does to read — a flat one was the first version, and searching
it for a person meant reading every line. Nothing about *what* belongs in the
list is decided here, which is what lets one plugin put Slack's own conversations
and BetterSlack's actions in the same one.

## `api.commands`

Things your mod can do, findable by typing. The **Command Palette** plugin is
what shows them — ⌘K by default, and it is a mod like any other, so a user who
would rather keep Slack's own switcher on that key can switch it off or move it
to ⌘⇧K in its settings.

```js
api.commands.add({
  id: 'open',                       // unique within your mod
  title: 'Theme builder',
  subtitle: 'Design a theme with the app as the preview',
  icon: '🎨',                       // optional; the palette falls back to ⌘
  run: () => open(),
});
```

Every idea so far has meant another button in Slack's rail, which is Slack's and
has room for about three. A command costs no chrome: it is attributed to your
mod automatically, and it goes when your mod is switched off.

## `api.settings`

```js
api.settings.get('limit', 100);   // stored → the manifest default → your fallback
await api.settings.set('limit', 40);
api.settings.all();

// Optional: hear about a change instead of being reloaded for it.
api.settings.onChange((values) => resize(values.limit));
```

Keys declared in `mod.json` under `settings` are drawn by the Mods panel — see
[getting-started](getting-started.md#settings-your-mod-can-be-given). A plugin
that registers `onChange` keeps running when one changes; every other plugin is
reloaded, so respecting a setting costs nothing.

## `api.themes`

The themes the user has, for tools that build on top of them. Read-only, and
themes only.

```js
api.themes.list();          // [{ id, name, description, enabled }]
await api.themes.source('midnight');   // the stylesheet, @imports already inlined

// Show the app without the user's themes for a while. Nothing is enabled or
// disabled: the settings are untouched, the stylesheets come straight back, and
// they come back on their own when the plugin stops.
api.themes.suspend(true);
```

`suspend` is for a tool that has to show what *it* is painting rather than what
it paints plus whatever is switched on — the theme builder, editing on top of a
chosen base, is the reason it exists.

## `api.assets`

Your mod's own files, as shipped in its folder — the modules it loaded, plus any
`.css` next to them. This is what lets a plugin keep its stylesheet in a real
`.css` file, with an editor that highlights it, instead of a template literal:

```js
api.css(api.assets.text('ui/panel.css'));
api.assets.list();            // ['index.js', 'ui/panel.js', 'ui/panel.css']
```

Paths are folder-relative and forward-slashed — the same strings you would
import. A leading `./` is accepted. Asking for a file that is not in the folder
throws, naming it.

## `api.css`

One stylesheet per plugin, replaced wholesale on each call, removed when the
plugin stops.

```js
api.css(`.my-thing { color: var(--dt_color-content-pry, #1d1c1d); }`);
api.css(api.assets.text('panel.css'));   // or keep it in its own file
```

## `api.log`

```js
api.log.info('ready');
api.log.warn('no permalink on this message');
api.log.error(err);
```

Prefixed with your plugin id and visible in DevTools.

---

## `api.i18n`

Slack ships in many languages, and an English-only mod stands out inside a
French client. Hand over one object of dictionaries and get back a lookup:

```js
const t = api.i18n.strings({
  en: { members: 'Members', online: '{count} online', copied: 'Link copied' },
  fr: { members: 'Membres', online: '{count} en ligne', copied: 'Lien copié' },
});

t('members');                 // "Membres" on a French client
t('online', { count: 3 });    // "3 en ligne"
```

| | |
| --- | --- |
| `api.i18n.locale` | the app's language tag, e.g. `"fr-FR"` — pass it to `toLocaleString` |
| `api.i18n.language` | its primary subtag, `"fr"` — what dictionaries are keyed by |
| `api.i18n.strings(tables)` | returns `t(key, vars?)` |

- **English is required** and is what everything falls back to: an unknown
  language, and any key a translation is missing.
- Lookup order is exact tag (`fr-CA`), then language (`fr`), then `en`.
- `{name}` placeholders are filled from `vars`; unknown ones are left as they
  are rather than blanked.
- A key missing everywhere renders as the key itself. A blank label reads as a
  rendering bug and gets reported as one; the key names what is missing.

The language comes from Slack's `<html lang>`, so it follows the user's
interface setting rather than their operating system.

**Every plugin in this repository ships English and French**, and a test fails a
mod whose two tables do not cover the same keys — half a translation is how
French users end up with English holes nobody notices.

## Doing things to Slack, directly

These are calls, not clicks staged on Slack's UI. Everything here was found by
probing Slack's API surface — it answers `unknown_method` for what does not
exist — and verified against a running client.

```js
api.slack.openConversation(channelId);      // move the client, no page load
await api.slack.openDirectMessage(userId);  // opens the DM, creating it if needed
api.slack.openUserProfile(userId);          // Slack's own profile pane
await api.slack.hideConversation(channelId);
await api.slack.filesFrom(userId, 20);
await api.slack.vipUsers();                 // ["U123", …]
await api.slack.setVip(userId, true);
```

Navigation goes through Slack's own deep-link scheme (`slack://channel`,
`slack://user`), which the desktop app routes in place — same document, no
reload. There is no other way in: Slack's router is a private closure, a
synthetic `popstate` moves the URL and nothing else, and an `<a>` to
`/archives/…` leaves the client entirely.

**What is not here, and will not be:** starting a huddle. `rooms.join` returns a
room but never rings anyone — the call itself is a WebRTC session only Slack's
client can open. Send people to `openUserProfile` instead of offering a button
that cannot do what it says.

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

