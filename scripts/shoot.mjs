#!/usr/bin/env node
// Take every screenshot the site and the README use, in one Slack launch.
//
//   pnpm shoot                 # into site/shots
//   pnpm shoot -- /tmp/shots   # somewhere else, to compare before replacing
//
// It runs the loader with a scratch home, so whatever you have installed and
// switched on is untouched, and hands the client to scripts/shoot-site.mjs.
// Slack is stopped at the end.

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/*
 * Two recipes: the site's frames, and one picture per mod for the catalogue.
 * The second is the one that runs against a real workspace, so it redacts.
 */
const forMods = process.argv.includes('--mods');
/*
 * `--only=<id>,<id>` retakes some of the set rather than all of it.
 *
 * A mod changes and its picture goes stale; without this the choice was
 * twenty-three frames or none, which in practice meant none.
 */
const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice('--only='.length) ?? '';
const positional = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const out = path.resolve(positional[0]
  ?? (forMods ? path.join(root, 'site/shots/mods') : path.join(root, 'site/shots')));
const recipe = forMods ? 'scripts/shoot-mods.mjs' : 'scripts/shoot-site.mjs';

/** Everything installed, nothing on: the recipe decides what to switch on. */
async function scratchHome() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'betterslack-shots-'));
  const catalogue = JSON.parse(await fs.readFile(path.join(root, 'mods/registry.json'), 'utf8'));
  await fs.writeFile(path.join(home, 'settings.json'), JSON.stringify({
    installed: catalogue.mods.map((mod) => mod.id),
    enabled: [],
    modSettings: {},
    customCss: '',
    hotReload: false,
    modFailures: {},
    slackPrefs: {},
  }));
  return home;
}

const home = await scratchHome();
await fs.mkdir(out, { recursive: true });
console.log(`[shots] into ${out}`);

const child = spawn(process.execPath, [path.join(root, 'bin/betterslack.mjs')], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    BETTERSLACK_HOME: home,
    BETTERSLACK_SHOT: out,
    BETTERSLACK_SHOT_SCRIPT: path.join(root, recipe),
    BETTERSLACK_SHOT_ONLY: only,
  },
});

const code = await new Promise((resolve) => child.on('exit', resolve));
await fs.rm(home, { recursive: true, force: true });

/*
 * A mod's picture belongs to the mod.
 *
 * The panel and the site both read it out of the folder through the manifest,
 * so the last step of taking them is filing them -- otherwise the catalogue
 * keeps showing the previous set and nobody can tell.
 */
if (forMods && code === 0) {
  const kinds = ['themes', 'plugins'];
  for (const file of await fs.readdir(out)) {
    if (!file.endsWith('.jpg')) continue;
    const id = file.replace(/\.jpg$/, '');
    for (const kind of kinds) {
      const folder = path.join(root, 'mods', kind, id);
      if (!await fs.stat(folder).then(() => true, () => false)) continue;
      await fs.copyFile(path.join(out, file), path.join(folder, 'screenshot.jpg'));
      console.log(`[shots] mods/${kind}/${id}/screenshot.jpg`);
    }
  }
}
process.exit(code ?? 0);
