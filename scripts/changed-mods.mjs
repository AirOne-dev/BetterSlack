#!/usr/bin/env node
// Which mods does a pull request actually touch?
//
//   node scripts/changed-mods.mjs                 against origin/master
//   node scripts/changed-mods.mjs --base <ref>    against something else
//   node scripts/changed-mods.mjs --json          just the ids, for CI
//
// The point is that a contributor's pull request is judged on their mod, not on
// somebody else's. One exception, and it is deliberate: when the shared code a
// mod is tested against changes — the runtime API or the test harness — every
// mod is in scope, because the contract they were written against just moved.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { listMods } from './test-mods.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Changing any of these invalidates every mod's assumptions. */
const SHARED_PATHS = [
  'src/runtime/',
  'src/shared/',
  'tests/harness.mjs',
  'tests/theme.mjs',
  'scripts/test-mods.mjs',
  'scripts/check-structure.mjs',
];

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function changedFiles(base) {
  // Three dots: what this branch changed since it diverged, not everything that
  // has landed on the base since.
  try {
    return git(['diff', '--name-only', `${base}...HEAD`]).split('\n').filter(Boolean);
  } catch {
    // Shallow clone or unknown base: fall back to the last commit rather than
    // silently reporting "nothing changed".
    return git(['diff', '--name-only', 'HEAD~1...HEAD']).split('\n').filter(Boolean);
  }
}

export function changedMods(base = 'origin/master') {
  const files = changedFiles(base);
  const all = listMods().map((m) => m.id);

  const sharedChanged = files.filter((f) => SHARED_PATHS.some((p) => f.startsWith(p)));
  if (sharedChanged.length > 0) {
    return { ids: all, reason: `shared code changed (${sharedChanged[0]}…)`, files };
  }

  const ids = new Set();
  for (const file of files) {
    const match = file.match(/^mods\/(themes|plugins)\/([^/]+)\//);
    // Only mods that still exist: a deletion has nothing left to test.
    if (match && all.includes(match[2])) ids.add(match[2]);
  }
  return { ids: [...ids].sort(), reason: 'mods touched by this branch', files };
}

const args = process.argv.slice(2);
const baseIndex = args.indexOf('--base');
const base = baseIndex >= 0 ? args[baseIndex + 1] : 'origin/master';
const result = changedMods(base);

if (args.includes('--json')) {
  console.log(JSON.stringify(result.ids));
} else {
  console.error(`base: ${base}`);
  console.error(`reason: ${result.reason}`);
  console.error(`mods: ${result.ids.length > 0 ? result.ids.join(', ') : '(none)'}`);
  console.log(JSON.stringify(result.ids));
}
