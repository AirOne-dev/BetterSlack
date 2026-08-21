---
name: derivePalette
group: tools
title: Tools
signature: (background: Colour, accent: Colour): Palette
since: 2.0.1
preview: tools-roles
control: background | text | #1a1a1e
control: accent | text | #536aed
---

Two colours in, the twelve roles a theme is written from out. This is what the theme builder runs before it writes a stylesheet, so a colour chosen here is a colour Slack would be painted with.

The pairs worth checking are checked: `contrast` and `readability` grade the text against the background the app really puts behind it.

```js
import { derivePalette } from './colour.js';
import { buildThemeCss } from './roles.js';

const palette = derivePalette(parseColour('#1a1a1e'), parseColour('#536aed'));
api.css(buildThemeCss(palette, 'Midnight'));
```
