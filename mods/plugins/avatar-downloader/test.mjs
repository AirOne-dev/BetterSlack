import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPluginShape, createTestApi, installDom } from '../../../tests/harness.mjs';
import plugin, { fileNameFor, pickBestAvatar, QUALITY_ORDER } from './index.js';

const PROFILE = {
  image_24: 'https://ca.slack-edge.com/T1-U1-hash-24.png',
  image_512: 'https://ca.slack-edge.com/T1-U1-hash-512.png',
  image_original: 'https://ca.slack-edge.com/T1-U1-hash-original.jpg',
};

test('exports a plugin', () => {
  assertPluginShape(assert, plugin);
});

test('prefers the original upload over every rendition', () => {
  assert.deepEqual(pickBestAvatar(PROFILE), {
    key: 'image_original',
    url: PROFILE.image_original,
  });
});

test('falls back down the ladder in order', () => {
  const { image_original, ...noOriginal } = PROFILE;
  assert.equal(pickBestAvatar(noOriginal).key, 'image_512');
  assert.equal(pickBestAvatar({ image_24: PROFILE.image_24 }).key, 'image_24');
  assert.equal(pickBestAvatar({}), null);
  assert.equal(pickBestAvatar(undefined), null);
});

test('quality order is strictly descending', () => {
  const sizes = QUALITY_ORDER.filter((k) => k !== 'image_original').map((k) => Number(k.slice(6)));
  const sorted = [...sizes].sort((a, b) => b - a);
  assert.deepEqual(sizes, sorted);
  assert.equal(QUALITY_ORDER[0], 'image_original');
});

test('builds a safe file name from the display name', () => {
  const user = { id: 'U1', name: 'jean', profile: { display_name: 'Jean/Luc Picard' } };
  assert.equal(fileNameFor(user, PROFILE.image_original, 'image_original'), 'jean-luc-picard-original.jpg');
  assert.equal(fileNameFor(user, PROFILE.image_512, 'image_512'), 'jean-luc-picard-512px.png');
});

test('file name never contains a path separator', () => {
  const nasty = { id: 'U1', profile: { display_name: '../../etc/passwd' } };
  const name = fileNameFor(nasty, 'x.png', 'image_512');
  assert.doesNotMatch(name, /[/\\]/);
  assert.doesNotMatch(name, /\.\./);
});

test('falls back to a usable name when the profile has none', () => {
  assert.match(fileNameFor({}, 'x.png', 'image_512'), /^slack-user-512px\.png$/);
});

test('registers both entry points', async () => {
  const dom = installDom();
  try {
    const { api, recorded } = createTestApi();
    await plugin.start(api);
    assert.equal(recorded.profileButtons.length, 1);
    assert.equal(recorded.messageActions.length, 1);
    assert.equal(recorded.profileButtons[0].id, 'download-avatar');
  } finally {
    dom.cleanup();
  }
});

test('asks the loader to save the best avatar, and reports the size', async () => {
  const dom = installDom();
  try {
    const { api, recorded } = createTestApi({
      web: { userInfo: async () => ({ id: 'U1', name: 'jean', profile: PROFILE }) },
    });
    await plugin.start(api);
    await recorded.profileButtons[0].onClick({ userId: 'U1' });

    assert.equal(recorded.saved.length, 1, 'exactly one save');
    assert.equal(recorded.saved[0].url, PROFILE.image_original);
    assert.equal(recorded.saved[0].filename, 'jean-original.jpg');
    assert.ok(
      recorded.toasts.some((t) => t.variant === 'success' && /original/.test(t.message)),
      'should confirm which quality was saved',
    );
  } finally {
    dom.cleanup();
  }
});

test('goes through the loader, never fetching the CDN from the page', async () => {
  // Slack's CDN has no CORS headers, so a renderer-side fetch always fails.
  // Catching that here stops the regression coming back.
  const { readFileSync } = await import('node:fs');
  const raw = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert.doesNotMatch(source, /\bfetch\s*\(/, 'use api.files.save instead of fetch()');
});

test('surfaces a failed save instead of silently doing nothing', async () => {
  const dom = installDom();
  try {
    const { api, recorded } = createTestApi({
      web: { userInfo: async () => ({ id: 'U1', profile: PROFILE }) },
    });
    recorded.downloadShouldFail = 'HTTP 403';
    await plugin.start(api);
    await recorded.profileButtons[0].onClick({ userId: 'U1' });

    assert.equal(recorded.saved.length, 0);
    assert.ok(recorded.toasts.some((t) => t.variant === 'error' && /403/.test(t.message)));
  } finally {
    dom.cleanup();
  }
});

test('refuses to run without a session token', async () => {
  const dom = installDom();
  try {
    const { api, recorded } = createTestApi({ web: { available: false } });
    await plugin.start(api);
    await recorded.profileButtons[0].onClick({ userId: 'U1' });
    assert.ok(recorded.toasts.some((t) => t.variant === 'error'));
    assert.equal(recorded.saved.length, 0);
  } finally {
    dom.cleanup();
  }
});
