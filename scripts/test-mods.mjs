#!/usr/bin/env node
// Runs a mod's tests, or every mod's tests.
//
//   node scripts/test-mods.mjs             all mods
//   node scripts/test-mods.mjs quote-reply one mod
//   node scripts/test-mods.mjs --list      the ids, as JSON (used by CI)
//
// Each mod runs in its own `node --test` process, so one mod cannot leak
// globals into another and a crash is attributed to the mod that caused it.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modsRoot = path.join(root, 'mods');

export function listMods() {
  const mods = [];
  for (const kind of ['themes', 'plugins']) {
    const dir = path.join(modsRoot, kind);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      mods.push({
        id: entry.name,
        kind,
        dir: path.join(dir, entry.name),
        test: path.join(dir, entry.name, 'test.mjs'),
      });
    }
  }
  return mods.sort((a, b) => a.id.localeCompare(b.id));
}

// Importable as a module (changed-mods.mjs and check-structure.mjs use
// listMods); only act as a CLI when run directly.
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const args = invokedDirectly ? process.argv.slice(2) : null;
if (args === null) {
  // imported: stop here
} else {

if (args[0] === '--list') {
  console.log(JSON.stringify(listMods().map((m) => m.id)));
  process.exit(0);
}

const wanted = args.filter((a) => !a.startsWith('-'));
const mods = listMods().filter((m) => wanted.length === 0 || wanted.includes(m.id));

if (mods.length === 0) {
  console.error(`No mod matched ${wanted.join(', ')}`);
  process.exit(1);
}

let failed = 0;
for (const mod of mods) {
  // Every mod must ship tests. Without this rule the gate is opt-in, and a
  // pull request can dodge it simply by not adding a file.
  if (!existsSync(mod.test)) {
    console.error(`✗ ${mod.id}: no test.mjs — every mod must ship tests`);
    failed++;
    continue;
  }

  const result = spawnSync(process.execPath, ['--test', mod.test], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    console.error(`✗ ${mod.id}: tests failed`);
    failed++;
  } else {
    console.log(`✓ ${mod.id}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} mod(s) failed`);
  process.exit(1);
}
console.log(`\n${mods.length} mod(s) passed`);
}
