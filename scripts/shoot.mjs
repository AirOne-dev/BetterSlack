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
 * A mod changes and its picture goes stale; without this the choice is the
 * whole set or none, which in practice means none.
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
/*
 * When this run started, so the filing below can tell its own pictures from
 * what was already in the folder.
 *
 * `site/shots/mods` is also where `pnpm site` puts a copy of every mod's
 * committed screenshot, so the folder is full before the run begins. Filing
 * whatever is in it would have a `--only=one-mod` run announce the whole
 * catalogue, and a run that failed its redaction audit before taking a single
 * picture announce it too.
 */
const startedAt = Date.now();
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
/*
 * Files whatever was taken, even if a later frame failed.
 *
 * All-or-nothing sounds careful and is not: a run that takes twenty-one good
 * pictures and then times out on the twenty-second would throw all twenty-one
 * away. Every picture has already passed the redaction audit by the time it is
 * written, and `--only` means a partial set is an ordinary thing to have. The
 * exit code still says the run failed.
 */
if (forMods) {
  const kinds = ['themes', 'plugins'];
  const catalogue = JSON.parse(await fs.readFile(path.join(root, 'mods/registry.json'), 'utf8'));
  // Longest id first: a frame is filed as `<id>-<name>`, and `demo-mode` would
  // otherwise be claimed by a mod called `demo`.
  const ids = catalogue.mods.map((mod) => mod.id).sort((a, b) => b.length - a.length);

  for (const file of await fs.readdir(out)) {
    if (!file.endsWith('.webp')) continue;
    const taken = await fs.stat(path.join(out, file)).then((s_) => s_.mtimeMs, () => 0);
    if (taken < startedAt) continue;
    const stem = file.replace(/\.webp$/, '');
    /*
     * `<id>-2`, `<id>-3`: two conventions in one folder.
     *
     * A frame is filed here as `<id>-<name>`, but `build-site.mjs` copies a
     * mod's *second* and *third* declared screenshots into the same folder as
     * `<id>-2` and `<id>-3`, and the loader writes one picture per attached
     * window under the same shape. Read back as frames, those land in the mod
     * folder as `screenshot-2.webp` -- a file no manifest names, which nothing
     * draws and nobody deletes. A frame is never called a number.
     */
    if (/-\d+$/.test(stem)) continue;
    const id = ids.find((candidate) => stem === candidate || stem.startsWith(`${candidate}-`));
    if (!id) continue;
    // The first frame is the mod's picture; the rest are numbered by the name
    // the recipe gave them, and the manifest is what decides their order.
    const suffix = stem === id ? '' : stem.slice(id.length);
    for (const kind of kinds) {
      const folder = path.join(root, 'mods', kind, id);
      if (!await fs.stat(folder).then(() => true, () => false)) continue;
      await fs.copyFile(path.join(out, file), path.join(folder, `screenshot${suffix}.webp`));
      console.log(`[shots] mods/${kind}/${id}/screenshot${suffix}.webp`);
    }
    /*
     * A named frame is a working file, and it is deleted once it is filed.
     *
     * The mod's folder is where the picture belongs; `build-site.mjs` copies it
     * back here under the name the page asks for, which is `<id>-2`, never
     * `<id>-actions`. Left behind, `<id>-<name>.webp` is a byte-identical
     * second copy that no manifest names, nothing draws, and every later run
     * writes again -- and the folder is published, so it costs a download too.
     * The first frame is exempt: `<id>.webp` is the name the page uses.
     */
    if (suffix) await fs.rm(path.join(out, file), { force: true });
  }
}
process.exit(code ?? 0);
