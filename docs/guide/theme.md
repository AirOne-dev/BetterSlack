---
name: Your first theme
title: Getting started
order: 3
---

A theme is CSS and nothing else. It runs no code, so several can be on at once,
and a look that needs behaviour names a plugin instead — see the last section.

## 1. Make the folder

```bash
pnpm new-mod theme my-theme "A quieter dark"
```

Two files: `mod.json` and `theme.css`.

## 2. `mods/themes/my-theme/mod.json`

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

## 3. `mods/themes/my-theme/theme.css`

Change Slack's **design tokens**, not its class names. Slack builds its whole
interface on custom properties, so redefining them re-skins the app without
naming a single element:

```css
:root,
.sk-client-theme--light,
.sk-client-theme--dark {
  --dt_color-base-pry: #101418;      /* the message surface */
  --dt_color-content-pry: #e6e9ef;   /* body text */
  --dt_color-content-hgl-1: #6cb6ff; /* links */
}
```

Save it, open the panel, install and enable. Every save after that re-applies
live.

## 4. All four token families, or the app chrome stays Slack's

This is the one that catches everybody. There are four, and a theme that only
writes the first leaves the rail, the sidebar and the headers untouched:

```css
:root,
.sk-client-theme--light,
.sk-client-theme--dark {
  /* Content: the conversation, dialogs, buttons. No !important needed. */
  --dt_color-base-pry: #101418;
  --dt_color-content-pry: #e6e9ef;

  /* Chrome: the rail, the sidebar, the headers. These need !important. */
  --dt_color-theme-base-inv-pry: #0b0e12 !important;
  --dt_color-theme-content-inv-pry: #e6e9ef !important;

  /* Legacy, and bare `r, g, b` triplets — a hex here parses as nothing. */
  --sk_primary_background: 16, 20, 24 !important;
  --sk_foreground_max: 230, 233, 239 !important;

  /* Raw palette, also triplets. */
  --dt_color-plt-blue-50: 108, 182, 255 !important;
}
```

`--sk_foreground_low` alone is referenced 31 times across BetterSlack's own
interface, and its fallback is Slack's *light* default — leave it out of a dark
theme and a dialog's hint text comes out near-black on near-black.

## 5. Clear the backdrop before painting one

`.p-theme_background` is a full-viewport opaque layer above `<body>`. Anything
you draw on `body` — a gradient, an image, translucency — is simply covered up
until you clear it:

```css
.p-theme_background { background: transparent !important; }
body { background: linear-gradient(160deg, #101418, #161c26); }
```

## 6. Use the builder rather than guessing

```bash
# In Slack: ⌘K, then "theme builder"
```

It opens a window of its own and paints the client live, so **the preview is
Slack**. Two colours become twelve roles across all four families, hovering a
colour outlines what it paints, and pointing at anything in the app shows the
tokens behind it. It writes ordinary CSS you can paste into `theme.css`.

## 7. Let somebody change your colours

A theme can have settings without running any code. It names the custom property
each one writes, and the panel writes it — the theme reads nothing.

```json
{
  "settings": [
    { "key": "accent", "type": "colour", "label": "Accent",
      "default": "#6cb6ff", "cssVar": "--my-accent" }
  ]
}
```

Two rules, or the colour repaints part of the client and not the rest. Derive
every tint from the property rather than writing the colour out again —
`color-mix(in srgb, var(--my-accent) 20%, transparent)`, not
`rgba(108, 182, 255, 0.2)`. And point Slack's legacy `--sk_*` tokens at
`--my-accent-rgb`, which the runtime writes alongside the colour: those take a
bare `r, g, b` triplet, and a `var()` holding a hex parses there and paints
nothing.

## 8. When the look needs behaviour

A theme cannot run code, and that is deliberate. When a look needs something CSS
cannot do — a member column, an account strip — the theme names a plugin:

```json
{ "requires": ["member-sidebar"] }
```

The panel offers to switch it on, and enables the theme either way if the user
declines: a plugin keeps running after the theme is off, so it is never turned
on silently. The plugin has to stand alone — it reads Slack's tokens and follows
any theme — and the theme must not style its markup.

## 9. Split it, and give it a page

A big theme reads better in pieces. `@import` a relative path inside your own
folder and BetterSlack inlines it, in order, before anything reaches the page:

```css
@import './tokens.css';
@import './sidebar.css';
```

The stylesheet is injected as one `<style>` element with no URL to resolve
against, so a browser `@import` of a file on a server would be a request Slack's
CSP refuses anyway. Import each file once; a cycle is an error, not a hang.

The manifest keys that turn a row into a page somebody reads -- the icon, the
translated descriptions, the screenshots and the READMEs -- are the same for a
theme as for a plugin, and are step 8 of **Your first plugin**.

## 10. Ship it

```bash
pnpm check
```

The same one command as a plugin. `pnpm shoot --mods -- --only=my-theme` takes
the screenshot the catalogue and the panel show, in a real Slack with every
name, face and message on screen replaced first.

## Two more traps, both measured

- **Slack has two "jump to unread" pills** in the sidebar, one above and one
  below, sharing every class except a hashed one that changes per build. Tell
  them apart by which half of the sidebar they sit in — a rule matching both
  sets `top` and `bottom` on the same element and stretches it between them.
- **Borrowing a Slack class borrows its layout.**
  `.p-r_member_profile__avatar__img` is `position: absolute` in Slack's
  stylesheet, which parks a borrowed avatar on top of its own title. Reset
  explicitly.
