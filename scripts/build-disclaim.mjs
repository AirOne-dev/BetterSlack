#!/usr/bin/env node
// bin/darwin/disclaim, from scripts/disclaim.c.
//
// Built here, by whoever changes the source, and committed -- never on a
// user's machine. An install has no compiler and must never need one, and the
// in-app update carries bin/ across as it is, so a committed binary is the only
// way this reaches people who update from the panel.
//
// Universal (arm64 + x86_64) and signed ad hoc: an arm64 Mac refuses to run an
// unsigned binary at all. The floor matches BetterSlack.app's
// LSMinimumSystemVersion.
//
// It also writes the source's digest beside the binary, and
// tests/disclaim.test.mjs compares the two: a C file edited without running
// this would otherwise ship the old behaviour under the new source, and nothing
// reading the repository could tell.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

if (process.platform !== 'darwin') {
  console.error('build:disclaim only works on macOS.');
  process.exit(1);
}

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'scripts', 'disclaim.c');
const out = path.join(root, 'bin', 'darwin', 'disclaim');

await fs.mkdir(path.dirname(out), { recursive: true });
await run('cc', [
  '-O2', '-arch', 'arm64', '-arch', 'x86_64', '-mmacosx-version-min=12.0',
  '-o', out, source,
]);
await run('codesign', ['--force', '--sign', '-', out]);
await fs.chmod(out, 0o755);

const digest = createHash('sha256').update(await fs.readFile(source)).digest('hex');
await fs.writeFile(`${out}.sha256`, `${digest}  scripts/disclaim.c\n`, 'utf8');

console.log(`built ${path.relative(root, out)}`);
