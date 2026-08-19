#!/usr/bin/env node
// assets/icon.icns, from assets/mark.svg.
//
// The .icns was a committed binary with no recipe, so a change to the mark left
// the app wearing the old one and nothing said so. This is the recipe.
//
// It is not part of `pnpm check`: an icon changes when somebody redraws it, and
// rasterising ten sizes on every gate would be a minute spent proving a file
// nobody touched is still itself.
//
// macOS supplies `iconutil`, which turns an .iconset folder into an .icns, and
// it is the only part of this with no alternative. Rasterising the SVG has
// three, tried in order, because none of them is on every Mac:
//
//   rsvg-convert   brew install librsvg -- the smallest and the fastest
//   magick         brew install imagemagick
//   Google Chrome  already installed on most machines, headless
//
// Transparency is the thing to watch. Chrome paints white behind a page unless
// told not to, and an icon with a white plate behind it is exactly what the
// transparent source was drawn to avoid.

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'assets', 'mark.svg');
const iconset = path.join(root, 'assets', 'BetterSlack.iconset');
const output = path.join(root, 'assets', 'icon.icns');

if (process.platform !== 'darwin') {
  console.error('iconutil is macOS only; assets/icon.icns can only be built there.');
  process.exit(1);
}

/** The sizes an .iconset must contain, by the names iconutil expects. */
const SIZES = [16, 32, 128, 256, 512].flatMap((size) => [
  { file: `icon_${size}x${size}.png`, pixels: size },
  { file: `icon_${size}x${size}@2x.png`, pixels: size * 2 },
]);

const has = async (tool) => {
  try {
    await run('command', ['-v', tool], { shell: '/bin/sh' });
    return true;
  } catch {
    return false;
  }
};

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function renderer() {
  if (await has('rsvg-convert')) {
    return {
      name: 'rsvg-convert',
      render: (pixels, out) => run('rsvg-convert', [
        '--width', String(pixels), '--height', String(pixels),
        '--background-color', 'none', '--output', out, source,
      ]),
    };
  }
  if (await has('magick')) {
    return {
      name: 'magick',
      render: (pixels, out) => run('magick', [
        '-background', 'none', '-density', '1200',
        source, '-resize', `${pixels}x${pixels}`, out,
      ]),
    };
  }
  try {
    await fs.access(CHROME);
    return {
      name: 'Google Chrome (headless)',
      render: async (pixels, out) => {
        const dir = path.dirname(out);
        await run(CHROME, [
          '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
          // Without this Chrome paints white behind the page, and the icon
          // arrives with the plate the source was drawn to avoid.
          '--default-background-color=00000000',
          `--window-size=${pixels},${pixels}`,
          `--screenshot=${out}`,
          `--user-data-dir=${path.join(dir, '.chrome')}`,
          `file://${source}`,
        ]);
      },
    };
  } catch {
    throw new Error(
      'no way to rasterise an SVG here. Install one:\n'
      + '  brew install librsvg      (rsvg-convert, the smallest)\n'
      + '  brew install imagemagick\n'
      + 'or install Google Chrome, which this falls back to.',
    );
  }
}

const draw = await renderer();
console.log(`rasterising with ${draw.name}`);

await fs.rm(iconset, { recursive: true, force: true });
await fs.mkdir(iconset, { recursive: true });
for (const { file, pixels } of SIZES) {
  await draw.render(pixels, path.join(iconset, file));
}
await fs.rm(path.join(iconset, '.chrome'), { recursive: true, force: true });

await run('iconutil', ['--convert', 'icns', '--output', output, iconset]);
await fs.rm(iconset, { recursive: true, force: true });

const { size } = await fs.stat(output);
console.log(`assets/icon.icns: ${SIZES.length} sizes, ${Math.round(size / 1024)} kB`);
