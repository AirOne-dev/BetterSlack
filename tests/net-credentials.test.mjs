// The loader's keeping of a mod's secret.
//
// The properties that matter are negative ones -- there is no way to get the
// secret back out, it is bound to the origin it was given for, a mod that did
// not ask for one cannot have one stored, and it lives nowhere settings.json
// does -- so each is a test of something that must not happen.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// store.ts resolves the home once, on import: set it first.
const HOME = mkdtempSync(path.join(tmpdir(), 'betterslack-credentials-'));
process.env.BETTERSLACK_HOME = HOME;
const credentials = await import('../dist/net-credentials.mjs');
const { exportBackup, mergeSettings, readSettings } = await import('../dist/store.mjs');
const { netRequest } = await import('../dist/net.mjs');

const RECORD = {
  id: 'git',
  type: 'plugin',
  settings: [{ key: 'gitUrl', type: 'text', label: 'Server', default: '' }],
  network: { settings: ['gitUrl'], credential: { header: 'private-token' } },
};
const VALUES = { gitUrl: 'https://git.example.com' };
const SECRET = 'glpat-0123456789abcdefghij';
const FILE = path.join(HOME, 'credentials', 'git.json');

test('a secret is kept for the origin of the address it was given for', async () => {
  const answer = await credentials.setCredential(RECORD, true, VALUES, SECRET, 'https://git.example.com/api/v4');
  assert.deepEqual(answer, { ok: true, has: true });
  assert.deepEqual(JSON.parse(readFileSync(FILE, 'utf8')), { origin: 'https://git.example.com', secret: SECRET });
  assert.deepEqual(await credentials.hasCredential(RECORD, true, VALUES), { ok: true, has: true });
});

test('the file is private to the user, and nothing is left beside it', () => {
  if (process.platform !== 'win32') {
    assert.equal(statSync(FILE).mode & 0o777, 0o600);
    assert.equal(statSync(path.dirname(FILE)).mode & 0o777, 0o700);
  }
  assert.deepEqual(readdirSync(path.dirname(FILE)), ['git.json']);
});

test('no answer the loader can give carries the secret', async () => {
  const answers = [
    await credentials.setCredential(RECORD, true, VALUES, SECRET, VALUES.gitUrl),
    await credentials.hasCredential(RECORD, true, VALUES),
    await credentials.setCredential(RECORD, true, VALUES, 'has a space', VALUES.gitUrl),
    await credentials.setCredential(RECORD, true, VALUES, SECRET, 'https://evil.example/'),
    await credentials.setCredential(RECORD, false, VALUES, SECRET, VALUES.gitUrl),
  ];
  for (const answer of answers) assert.ok(!JSON.stringify(answer).includes(SECRET));
});

test('it is not in settings.json, not in a backup, and not among the mod\'s data', async () => {
  await mergeSettings({ enabled: ['git'] });
  assert.ok(!JSON.stringify(await readSettings()).includes(SECRET));
  assert.ok(!(await exportBackup()).includes(SECRET));
  assert.ok(!existsSync(path.join(HOME, 'data', 'git')), 'api.data folders are readable by the mod\'s own page');
});

test('a secret for one origin is not held, and not sent, once the address moves', async () => {
  const moved = { gitUrl: 'https://other.example.com' };
  assert.deepEqual(await credentials.hasCredential(RECORD, true, moved), { ok: true, has: false });
  const sent = [];
  const fetchImpl = async (_url, options) => {
    sent.push(options.headers);
    return new Response('{}', { status: 200 });
  };
  const held = await credentials.readCredential('git');
  await netRequest(RECORD, true, moved, { url: 'https://other.example.com/x' }, fetchImpl, held);
  await netRequest(RECORD, true, VALUES, { url: 'https://git.example.com/x' }, fetchImpl, held);
  assert.deepEqual(Object.keys(sent[0]), ['accept']);
  assert.equal(sent[1]['private-token'], SECRET);
});

test('it can only be stored for an address the mod\'s settings hold, now', async () => {
  for (const address of ['https://evil.example/', 'http://git.example.com/', 'not a url', 42, undefined]) {
    assert.deepEqual(await credentials.setCredential(RECORD, true, VALUES, 'glpat-other', address),
      { ok: false, error: 'blocked' }, String(address));
  }
  assert.equal((await credentials.readCredential('git')).secret, SECRET, 'a refused store changes nothing');
});

test('only a plugin that asked for a credential, and is on, may store one', async () => {
  const plain = { ...RECORD, network: { settings: ['gitUrl'] } };
  for (const [record, enabled] of [[undefined, true], [{ ...RECORD, type: 'theme' }, true], [plain, true], [RECORD, false]]) {
    assert.deepEqual(await credentials.setCredential(record, enabled, VALUES, 'glpat-other', VALUES.gitUrl),
      { ok: false, error: 'blocked' });
    assert.deepEqual(await credentials.hasCredential(record, enabled, VALUES), { ok: false, error: 'blocked' });
  }
  assert.equal((await credentials.readCredential('git')).secret, SECRET);
});

test('only what can travel in a header is accepted', async () => {
  for (const secret of ['', ' ', 'two words', 'line\nbreak', 'tab\there', 'é', 'x'.repeat(4097), 42, null, undefined]) {
    assert.deepEqual(await credentials.setCredential(RECORD, true, VALUES, secret, VALUES.gitUrl),
      { ok: false, error: 'invalid' }, JSON.stringify(secret));
  }
});

test('a mod\'s id is never a path', async () => {
  assert.equal(await credentials.readCredential('../settings'), null);
  assert.equal(await credentials.removeCredential('../settings'), false);
});

test('clearing forgets it, and so does removing the mod', async () => {
  assert.deepEqual(await credentials.clearCredential(RECORD), { ok: true, has: false });
  assert.equal(existsSync(FILE), false);
  assert.deepEqual(await credentials.hasCredential(RECORD, true, VALUES), { ok: true, has: false });
  await credentials.setCredential(RECORD, true, VALUES, SECRET, VALUES.gitUrl);
  assert.equal(await credentials.removeCredential('git'), true);
  assert.equal(await credentials.removeCredential('git'), false);
});
