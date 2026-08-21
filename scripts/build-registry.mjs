#!/usr/bin/env node
// Regenerates mods/registry.json from the folders under mods/.
// Run it in CI on every pull request so the file can never drift from reality.

import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { floorForMod, loadSinceTable, compareVersions, NO_FLOOR } from './api-floor.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modsRoot = path.join(root, 'mods');

/*
 * The registry is where the oldest usable BetterSlack is published, because the
 * registry is what an older install reads. A mod updates itself out of this
 * file into whatever version the reader is running, so the answer to "can this
 * run here" has to travel with the listing rather than being worked out from
 * source nobody has downloaded yet.
 *
 * Computed here rather than copied from the manifest: see api-floor.mjs for why
 * a hand-written floor is the field everyone forgets. A manifest may still
 * declare one, and validate-mods refuses a declaration below what the code
 * actually needs.
 */
const sinceTable = loadSinceTable();

const mods = [];
for (const kind of ['themes', 'plugins']) {
  const dir = path.join(modsRoot, kind);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(dir, entry.name, 'mod.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    const computed = floorForMod(path.join(dir, entry.name), sinceTable).floor;
    const declared = typeof manifest.needsBetterSlack === 'string' ? manifest.needsBetterSlack : NO_FLOOR;
    const needs = compareVersions(declared, computed) > 0 ? declared : computed;
    mods.push({
      ...manifest,
      // Omitted rather than written as 0.0.0: a theme needs no version of
      // anything, and a floor of zero on every theme is noise in a file people
      // read diffs of.
      ...(needs === NO_FLOOR ? {} : { needsBetterSlack: needs }),
      path: `${kind}/${entry.name}`,
    });
  }
}

mods.sort((a, b) => a.id.localeCompare(b.id));

// No timestamp: a generated file that changes on every run produces noisy
// diffs and pointless merge conflicts in pull requests.
const registry = { generatedAt: 'on-commit', mods };
await fs.writeFile(path.join(modsRoot, 'registry.json'), JSON.stringify(registry, null, 2) + '\n', 'utf8');

console.log(`registry.json: ${mods.length} mod(s)`);
