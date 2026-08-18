// The recipe for the site's screenshots: what to switch on, what to open, and
// what to photograph. Run it with `pnpm shoot` -- scripts/shoot.mjs starts the
// loader and hands the client to the default export below.
//
// One launch for the lot. Everything that differs between these pictures is
// something the runtime can change in place through `window.__betterslack`:
// which mods are on, which panel tab is open. Restarting Slack between frames
// is what the first version did, and it took minutes to produce pictures that
// differ by one switch.
//
// Two rules, both learned the hard way:
//
//   Shoot at the size the picture is published at. Cropping a taller frame
//   afterwards takes the crop from the middle -- which is how the top bar and
//   the composer went missing from every panel shot on the site.
//
//   Shoot on the empty BetterSlack workspace, never a real one. These end up
//   in a public README; nothing in them should belong to anybody.

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const OUT = process.env.BETTERSLACK_SHOT;
const DEMO_TEAM = process.env.BETTERSLACK_SHOT_TEAM ?? 'T0BQ89Z4L4F';

const THEMES = ['aurora', 'cocoa', 'discord-dark', 'discord-light', 'focus-rings', 'midnight', 'terminal'];

/** The frames the site and the README declare, so nothing is resized later. */
const THEME_SIZE = '1800x1128';
const PANEL_SIZE = '1800x990';

/** In the page: everything the runtime already knows how to do. */
const only = (ids) => `(async () => {
  const m = window.__betterslack.manager;
  const wanted = ${JSON.stringify(ids)};
  for (const mod of m.list()) {
    const want = wanted.includes(mod.id);
    if (m.isEnabled(mod.id) !== want) await m.setEnabled(mod.id, want);
  }
  return m.getSettings().enabled.join(',');
})()`;

const openPanel = (tab, shelf) => `(async () => {
  window.__betterslack.panel.open(${JSON.stringify(tab)});
  ${shelf === undefined ? '' : `await new Promise((r) => setTimeout(r, 600));
  document.querySelectorAll('.betterslack-shelf')[${shelf}]?.click();`}
  return true;
})()`;

const closePanel = `(() => { window.__betterslack.close(); return true; })()`;

const palette = `(() => {
  // The plugin binds its shortcut with api.helpers.hotkey, which listens for an
  // ordinary keydown -- no trusted gesture needed.
  window.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'k', code: 'KeyK', metaKey: true, ctrlKey: true, bubbles: true,
  }));
  return true;
})()`;

export default async function shootSite({ evaluate, shoot, sleep }) {
  const where = await evaluate('location.pathname');
  if (!String(where).includes(DEMO_TEAM)) {
    console.log('[shots] switching to the demo workspace');
    await evaluate(`location.href = 'slack://open?team=${DEMO_TEAM}'`);
    await sleep(8000);
  }
  const team = await evaluate('location.pathname');
  if (!String(team).includes(DEMO_TEAM)) {
    throw new Error(`refusing to photograph ${team}: these pictures are public`);
  }

  // The catalogue thumbnails: one theme at a time, nothing else on.
  for (const id of THEMES) {
    await evaluate(only([id]));
    await sleep(1400);
    await shoot(`crop-${id}`, THEME_SIZE);
    console.log(`[shots] crop-${id}`);
  }

  /*
   * The panel, over Discord Dark rather than Slack's default. The panel wears
   * Slack's own classes precisely so it follows whatever theme is on, and a
   * screenshot of it over the stock palette says none of that.
   */
  const withTheme = ['discord-dark', 'member-sidebar', 'sidebar-account', 'command-palette'];
  await evaluate(only(withTheme));
  await sleep(1800);

  await evaluate(openPanel('themes'));
  await sleep(900);
  await shoot('panel', PANEL_SIZE);
  console.log('[shots] panel');

  await evaluate(openPanel('plugins', 2));
  await sleep(1200);
  await shoot('panel-browse', PANEL_SIZE);
  console.log('[shots] panel-browse');

  await evaluate(closePanel);
  await sleep(600);
  await evaluate(palette);
  await sleep(1200);
  await shoot('palette', PANEL_SIZE);
  console.log('[shots] palette');

  // Escape closes the palette; the combo shot is the client with the mods in it.
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true`);
  await sleep(1500);
  await shoot('discord-combo', PANEL_SIZE);
  console.log('[shots] discord-combo');

  await toJpeg(OUT);
}

/**
 * PNG to JPEG, at the published width.
 *
 * `sips` because it is on every Mac and these are taken on a Mac -- the
 * alternative is a dependency for eleven files a year.
 */
async function toJpeg(dir) {
  for (const file of await fs.readdir(dir)) {
    if (!file.endsWith('.png')) continue;
    const png = path.join(dir, file);
    const jpg = png.replace(/\.png$/, '.jpg');
    await run('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '82', png, '--out', jpg]);
    // Captured at twice the size on a retina display; the site wants 1800.
    await run('sips', ['--resampleWidth', '1800', jpg]);
    await fs.rm(png);
  }
  console.log(`[shots] wrote ${dir}`);
}
