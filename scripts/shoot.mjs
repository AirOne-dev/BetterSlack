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
const out = path.resolve(process.argv[2] ?? path.join(root, 'site/shots'));

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
    BETTERSLACK_SHOT_SCRIPT: path.join(root, 'scripts/shoot-site.mjs'),
  },
});

const code = await new Promise((resolve) => child.on('exit', resolve));
await fs.rm(home, { recursive: true, force: true });
process.exit(code ?? 0);
