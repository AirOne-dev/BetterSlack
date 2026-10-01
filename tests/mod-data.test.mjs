// api.data's loader half: a folder per mod, held to the rules a reviewer
// would check -- no escaping the folder, no naming another mod's, caps.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Before the import: store.ts resolves the home once, when it is loaded, and
// this must not run against a real ~/.betterslack.
const home = mkdtempSync(path.join(tmpdir(), 'betterslack-data-'));
process.env.BETTERSLACK_HOME = home;
const { writeData, readData, listData, removeData, safeDataName, MAX_FILE_BYTES } =
  await import('../dist/mod-data.mjs');

const b64 = (text) => Buffer.from(text).toString('base64');

test('a file kept is a file read back', async () => {
  const entry = await writeData('custom-sounds', 'ding.mp3', b64('RIFF'));
  assert.equal(entry.name, 'ding.mp3');
  assert.equal(entry.bytes, 4);
  assert.equal(Buffer.from(await readData('custom-sounds', 'ding.mp3'), 'base64').toString(), 'RIFF');
  assert.ok(existsSync(path.join(home, 'data', 'custom-sounds', 'ding.mp3')));
});

test('a name cannot leave the mod\'s folder', async () => {
  const entry = await writeData('custom-sounds', '../../settings.json', b64('{}'));
  assert.equal(entry.name, 'settings.json');
  assert.ok(existsSync(path.join(home, 'data', 'custom-sounds', 'settings.json')));
  assert.ok(!existsSync(path.join(home, 'settings.json')));
  assert.equal(safeDataName('my sound (1).MP3'), 'my-sound-1-.MP3');
  assert.throws(() => safeDataName('...'));
});

test('a mod id that is not one is refused', async () => {
  await assert.rejects(writeData('../mods', 'x.txt', b64('x')));
  await assert.rejects(listData('Custom Sounds'));
});

test('one mod does not see another\'s files', async () => {
  await writeData('history', 'log.json', b64('[]'));
  const names = (await listData('custom-sounds')).map((entry) => entry.name);
  assert.ok(!names.includes('log.json'));
});

test('a file over the cap is refused, not truncated', async () => {
  const big = Buffer.alloc(MAX_FILE_BYTES + 1).toString('base64');
  await assert.rejects(writeData('custom-sounds', 'big.wav', big), /at most/);
  assert.equal(await readData('custom-sounds', 'big.wav'), null);
});

test('removing answers whether there was something to remove', async () => {
  assert.equal(await removeData('custom-sounds', 'ding.mp3'), true);
  assert.equal(await removeData('custom-sounds', 'ding.mp3'), false);
  assert.equal(await readData('custom-sounds', 'ding.mp3'), null);
});
