#!/usr/bin/env node
// The loader and runtime unit tests.
//
// This was `node --test tests/` in package.json, which is the shape everything
// here wants: a new test file runs without anybody remembering to add it to a
// list. Node 22 took it away. Positional arguments to `--test` became glob
// patterns, so a bare directory is no longer expanded -- it is treated as a
// file to run, and the whole suite fails with
// `Cannot find module '…/tests'` before a single test starts. Measured:
//
//   node       --test tests/   --test "tests/**/*.test.mjs"
//   20.20.2    ok              fails
//   22.21.1    fails           ok
//   24.16.0    fails           ok
//   25.9.0     fails           ok
//
// Neither form works on both, and the project supports Node 18 and up, so
// neither can go in package.json. Handing Node an explicit list of files works
// on every version -- and doing the finding here rather than in the shell keeps
// the discovery, and works where there is no shell glob to rely on.

import { spawn } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'tests');

/** Every *.test.mjs under tests/, at any depth. */
function find(from) {
  return readdirSync(from).sort().flatMap((name) => {
    const full = path.join(from, name);
    if (statSync(full).isDirectory()) return find(full);
    return name.endsWith('.test.mjs') ? [full] : [];
  });
}

const files = find(dir);
if (files.length === 0) {
  console.error(`no *.test.mjs under ${path.relative(root, dir)} -- that is a bug, not an empty suite`);
  process.exit(1);
}

const node = spawn(process.execPath, ['--test', ...process.argv.slice(2), ...files], {
  cwd: root,
  stdio: 'inherit',
});
node.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
