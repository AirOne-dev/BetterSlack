// bin/darwin/disclaim is a committed binary, so it is checked the way a
// binary can be.
//
// It is what keeps a huddle from killing Slack on macOS (scripts/disclaim.c
// says why), and it reaches people who update from the panel only because the
// update carries bin/ across as it is -- nobody's machine compiles it. Three
// ways that could quietly stop being true, each checked here: the source
// edited without rebuilding, the binary losing its executable bit, and one
// architecture missing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = path.join(root, 'bin', 'darwin', 'disclaim');

test('the committed binary was built from the committed source', () => {
  const source = readFileSync(path.join(root, 'scripts', 'disclaim.c'));
  const digest = createHash('sha256').update(source).digest('hex');
  const recorded = readFileSync(`${binary}.sha256`, 'utf8').split(/\s+/)[0];
  assert.equal(
    recorded,
    digest,
    'scripts/disclaim.c changed without a rebuild -- run pnpm build:disclaim on a Mac and commit both files',
  );
});

test('it is executable, or the loader skips it and Slack can crash on a call', () => {
  assert.ok(statSync(binary).mode & 0o111, 'bin/darwin/disclaim lost its executable bit');
});

test('it is universal, for Apple silicon and Intel alike', () => {
  const bytes = readFileSync(binary);
  // A fat Mach-O header is big-endian: magic, then the number of slices, then
  // one 20-byte record per slice whose first word is the CPU type.
  assert.equal(bytes.readUInt32BE(0), 0xcafebabe, 'not a universal Mach-O');
  const count = bytes.readUInt32BE(4);
  const cpus = Array.from({ length: count }, (_, i) => bytes.readUInt32BE(8 + i * 20));
  const X86_64 = 0x01000007;
  const ARM64 = 0x0100000c;
  assert.ok(cpus.includes(X86_64), 'no x86_64 slice');
  assert.ok(cpus.includes(ARM64), 'no arm64 slice');
});
