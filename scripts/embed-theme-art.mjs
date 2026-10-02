#!/usr/bin/env node
// Writes a theme's app-icon.svg and splash.svg into its theme.css, as the
// --betterslack-app-icon and --betterslack-splash-art properties.
//
// The pictures are kept as files so they can be opened and edited, and are
// shipped inside the stylesheet because a stylesheet is what every update path
// carries: a mod update fetches .css and leaves an .svg behind. A theme's test
// fails when the two have drifted, so running this is never optional.
//
//   node scripts/embed-theme-art.mjs windows-xp

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ART = [
  ['app-icon.svg', '--betterslack-app-icon'],
  ['splash.svg', '--betterslack-splash-art'],
];

/** An SVG as a data URI that can sit inside url("..."). */
export function svgDataUri(svg) {
  const compact = svg
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/>\s+</g, '><')
    .replace(/\s+/g, ' ')
    .trim();
  return `data:image/svg+xml,${encodeURIComponent(compact).replace(/'/g, '%27')}`;
}

/** The stylesheet with each declaration replaced by the file it comes from. */
export async function embed(themeDir, css) {
  let out = css;
  for (const [file, property] of ART) {
    let svg;
    try {
      svg = await fs.readFile(path.join(themeDir, file), 'utf8');
    } catch {
      continue;
    }
    const line = `${property}: url("${svgDataUri(svg)}");`;
    const pattern = new RegExp(`${property}:\\s*url\\("[^"]*"\\);`);
    if (!pattern.test(out)) throw new Error(`${path.basename(themeDir)}/theme.css declares no ${property} to fill`);
    out = out.replace(pattern, () => line);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    console.error('usage: node scripts/embed-theme-art.mjs <theme-id> [...]');
    process.exit(1);
  }
  for (const id of ids) {
    const dir = path.join(root, 'mods', 'themes', id);
    const file = path.join(dir, 'theme.css');
    const css = await fs.readFile(file, 'utf8');
    const next = await embed(dir, css);
    if (next !== css) await fs.writeFile(file, next);
    console.log(next === css ? `${id}: already current` : `${id}: embedded`);
  }
}
