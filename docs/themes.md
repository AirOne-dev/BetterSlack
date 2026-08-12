# Theming Slack

Everything below was measured against a live Slack, not assumed. New here?
Start with **[getting-started.md](getting-started.md#write-a-theme)**.

## Four families, not one

Slack's colours come from four separate sets of custom properties. Override only
the first and the app chrome keeps its old colours — invisible on a dark theme,
glaring on a light one.

| Family | Drives | Format | Needs `!important` |
| --- | --- | --- | --- |
| `--dt_color-<role>` | messages, controls, text | `#rrggbb` | no |
| `--dt_color-theme-*` | rail, sidebar, headers — the workspace "theme" | `#rrggbb` | **yes** |
| `--sk_*` | older components, still widespread | bare `r, g, b` | **yes** |
| `--dt_color-plt-*` | the raw palette the others build on | bare `r, g, b` | — |

The middle two are defined by something more specific than `:root`, so a plain
declaration silently loses. The two `r, g, b` families only work inside `rgb()`:

```css
color: rgb(var(--dt_color-plt-jade-40));   /* right */
color: var(--dt_color-plt-jade-40);        /* wrong: not a colour */
```

## The starting point

Paste this and change the values. It covers all three families that matter.

```css
:root,
.sk-client-theme--light,
.sk-client-theme--dark {
  /* 1. content */
  --dt_color-base-pry: #0f1219;         /* message surface */
  --dt_color-base-sec: #151924;         /* raised surfaces */
  --dt_color-base-ter: #1c2130;
  --dt_color-base-pry-hover: rgba(255, 255, 255, 0.055);
  --dt_color-content-pry: #e7e9ee;      /* body text */
  --dt_color-content-sec: #a4abb8;      /* metadata */
  --dt_color-content-ter: #7f8695;      /* quietest */
  --dt_color-otl-pry: rgba(228, 233, 242, 0.28);   /* borders */
  --dt_color-otl-sec: rgba(228, 233, 242, 0.14);
  --dt_color-content-hgl-1: #7cc4ff;    /* links */
  --dt_color-content-hgl-2: #4cc894;    /* success */
  --dt_color-content-hgl-3: #ffd738;    /* warning */
  --dt_color-content-imp: #ff8fae;      /* danger */
}

:root,
.sk-client-theme--light,
.sk-client-theme--dark {
  /* 2. chrome */
  --dt_color-theme-base-inv-pry: #0b0e14 !important;   /* sidebar */
  --dt_color-theme-base-inv-sec: #131824 !important;
  --dt_color-theme-content-inv-pry: #e7e9ee !important;
  --dt_color-theme-content-inv-sec: rgba(231, 233, 238, 0.78) !important;
  --dt_color-theme-surf-inv-sec: rgba(11, 14, 20, 0.72) !important;  /* rail */
  --dt_color-theme-surf-inv-ter: rgba(231, 233, 238, 0.07) !important;
  --dt_color-theme-base-pry: #0f1219 !important;
  --dt_color-theme-content-pry: #e7e9ee !important;

  /* 3. legacy — "r, g, b" triplets */
  --sk_primary_background: 15, 18, 25 !important;
  --sk_primary_foreground: 231, 233, 238 !important;
  --sk_foreground_max: 231, 233, 238 !important;
  --sk_foreground_high: 200, 205, 214 !important;
  --sk_foreground_mid: 164, 171, 184 !important;
  --sk_foreground_low: 127, 134, 149 !important;
  --sk_highlight: 124, 196, 255 !important;
}

/* Slack paints a full-viewport layer above <body>. */
.p-theme_background { background: #0f1219 !important; }
```

## The traps

### `.p-theme_background`

A full-viewport opaque layer sitting *above* `<body>`. Anything you do to
`<body>` — a gradient, an image, translucency — is invisible until you repaint
or clear it:

```css
.p-theme_background { background: transparent !important; }  /* to show a body gradient */
```

### Hashed class names

Slack uses two conventions that both contain `__`:

```
.p-channel_sidebar__channel   hand-written, stable
.circleButton__cMiUK          CSS-module output, regenerated every build
```

The tell is the suffix: module hashes carry uppercase letters. The theme test
rejects them automatically, so this fails CI rather than your users.

### Light themes and dark mode

A dark theme can skip the chrome families and mostly get away with it, because
Slack's default chrome is already dark. A light theme cannot — it comes out as
light content inside a dark frame.

### The composer is two elements

`[data-qa="message_input"]` is the editable area, and it is transparent and
border-less by default. The visible box — background, 1px border, 8px corners —
belongs to `.c-wysiwyg_container`, three levels up. Styling the inner one draws
a second box inside Slack's own, which is exactly as bad as it sounds:

```css
[data-qa="message_input"] { background: #222; border: 1px solid #444; }  /* wrong */
.c-wysiwyg_container      { background: #222; border: 1px solid #444; }  /* right */
```

### Opaque panes

Slack's own panes paint their own background. For a gradient or glass effect,
clear them too:

```css
.p-client_container,
.p-workspace__primary_view,
.p-view_contents,
.p-message_pane,
.c-virtual_list__scroll_container { background: transparent !important; }
```

## Selectors worth knowing

Verified against Slack 4.51. Prefer `data-qa`; these are the structural class
names that have held up.

| Selector | What |
| --- | --- |
| `[data-qa="message_container"]` | one message; carries `data-msg-ts`, `data-msg-channel-id` |
| `[data-qa="message-text"]` | its body |
| `[data-qa="message-actions"]` | the hover toolbar |
| `.c-wysiwyg_container` | the composer's **box** — background, border, corners |
| `[data-qa="message_input"]` | the editable inside it; transparent by default |
| `[data-qa="channel-sidebar"]`, `.p-channel_sidebar` | the sidebar |
| `.p-channel_sidebar__channel--selected` | the open channel row |
| `[data-qa="tab_rail_desktop"]`, `.p-tab_rail` | the icon rail |
| `.p-control_strip` | the bottom strip: create, focus mode, avatar |
| `[data-qa="top-nav"]`, `.p-ia4_top_nav` | the top bar |
| `[data-qa="member_profile_pane"]` | the profile flexpane |
| `.c-message_kit__background` | the hoverable message row |
| `.c-message_attachment` | a link unfurl |
| `.c-tooltip__tip`, `.c-tooltip__subtitle` | tooltips |
| `.c-avatar`, `.c-base_icon--image` | avatars |

## Recipes

**Round every avatar**

```css
.c-avatar, .c-avatar img, .c-base_icon--image,
.c-message_kit__avatar img { border-radius: 50% !important; }
```

**One font everywhere, without breaking emoji**

```css
*:not(.c-emoji):not(.c-emoji *) {
  font-family: "Your Font", Lato, sans-serif !important;
}
```

**Highlight the whole message row on hover**

```css
.c-message_kit__background { transition: background-color 60ms ease; }
.c-message_kit__background:hover { background: #2e3035 !important; }
```

**Thinner scrollbars**

```css
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.25);
  border: 3px solid transparent;
  background-clip: content-box;
  border-radius: 999px;
}
::-webkit-scrollbar-track { background: transparent; }
```

**Frosted panels** — note `.p-theme_background` has to be cleared first:

```css
.p-channel_sidebar, .p-tab_rail, .c-wysiwyg_container {
  backdrop-filter: blur(22px) saturate(140%);
}
```

## Read the ones that ship

| Theme | Shows |
| --- | --- |
| [`midnight`](../mods/themes/midnight/theme.css) | the plain three-family override, well commented |
| [`discord-dark`](../mods/themes/discord-dark/theme.css) | a complete reskin: colour, type, radius, scrollbars |
| [`aurora`](../mods/themes/aurora/theme.css) | gradients, glass, translucent chrome |
| [`cocoa`](../mods/themes/cocoa/theme.css) | a light theme, so every family had to be covered |
| [`focus-rings`](../mods/themes/focus-rings/theme.css) | no tokens at all — pure `:focus-visible` semantics |
| [`terminal`](../mods/themes/terminal/theme.css) | a full takeover with `*` selectors |
