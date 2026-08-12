#!/usr/bin/env node
// Regenerates mods/registry.json from the folders under mods/.
// Run it in CI on every pull request so the file can never drift from reality.

import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modsRoot = path.join(root, 'mods');

const mods = [];
for (const kind of ['themes', 'plugins']) {
  const dir = path.join(modsRoot, kind);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(dir, entry.name, 'mod.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    mods.push({ ...manifest, path: `${kind}/${entry.name}` });
  }
}

mods.sort((a, b) => a.id.localeCompare(b.id));

// No timestamp: a generated file that changes on every run produces noisy
// diffs and pointless merge conflicts in pull requests.
const registry = { generatedAt: 'on-commit', mods };
await fs.writeFile(path.join(modsRoot, 'registry.json'), JSON.stringify(registry, null, 2) + '\n', 'utf8');

console.log(`registry.json: ${mods.length} mod(s)`);
