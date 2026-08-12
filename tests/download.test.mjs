// Guards on the loader's download capability.
//
// It writes to disk on a mod's say-so, so the constraints matter more than the
// happy path: a mod must not be able to choose where the file lands, reach a
// non-https URL, or fill the disk.

import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadFile, DownloadError, safeFilename } from '../dist/download.mjs';

test('reduces any path to a bare file name', () => {
  assert.equal(safeFilename('../../etc/passwd'), 'passwd');
  assert.equal(safeFilename('/absolute/path/x.png'), 'x.png');
  assert.equal(safeFilename('..'), 'slackmod-download');
  assert.equal(safeFilename(''), 'slackmod-download');
  assert.doesNotMatch(safeFilename('a/../../b.png'), /[/\\]/);
});

test('strips characters a filesystem would treat specially', () => {
  assert.doesNotMatch(safeFilename('re: "photo" $(rm -rf) .png'), /["$()]/);
  assert.doesNotMatch(safeFilename('x y.png'), / /);
});

test('caps the length', () => {
  assert.ok(safeFilename('a'.repeat(400)).length <= 120);
});

test('refuses anything that is not https', async () => {
  for (const url of ['http://example.com/x.png', 'file:///etc/passwd', 'ftp://x/y', 'not a url']) {
    await assert.rejects(() => downloadFile(url, 'x.png'), DownloadError, `should refuse ${url}`);
  }
});

test('refuses a file the server declares as oversized', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    headers: new Map([['content-length', String(200 * 1024 * 1024)]]),
    arrayBuffer: async () => new ArrayBuffer(0),
  });
  try {
    await assert.rejects(() => downloadFile('https://example.com/big.bin', 'big.bin'), /cap/);
  } finally {
    globalThis.fetch = previous;
  }
});

test('refuses a body that exceeds the cap despite a small content-length', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    headers: new Map([['content-length', '10']]),
    arrayBuffer: async () => new ArrayBuffer(30 * 1024 * 1024),
  });
  try {
    await assert.rejects(() => downloadFile('https://example.com/liar.bin', 'liar.bin'), /cap/);
  } finally {
    globalThis.fetch = previous;
  }
});
