// Guards on the loader's request capability.
//
// `api.net` lets a mod read a server's answer that the page itself never could,
// so the constraints matter more than the happy path: a mod must reach only an
// address its declared settings hold, over https, with nothing of its choosing
// in the headers, and must never be walked somewhere else by a redirect.

import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedBases, netRequest, within } from '../dist/net.mjs';
import { parseManifest } from '../dist/catalog.mjs';

const RECORD = {
  id: 'hours',
  type: 'plugin',
  settings: [
    { key: 'apiUrl', type: 'text', label: 'Server', default: '' },
    { key: 'theme', type: 'text', label: 'Theme', default: 'https://elsewhere.example/' },
  ],
  network: { settings: ['apiUrl'] },
};
const VALUES = { apiUrl: 'https://hours.example.com/api/' };

/** A server that records what it was asked and answers `body`. */
function server(body = { ok: true }, init = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return new Response(text, { status: 200, headers: { 'content-type': 'application/json' }, ...init });
  };
  return { calls, fetchImpl };
}

test('the allowed addresses are what the named settings hold, and only those', () => {
  assert.deepEqual(allowedBases(RECORD, VALUES).map((url) => url.href), ['https://hours.example.com/api/']);
  // `theme` holds an address too, but the manifest does not name it.
  assert.deepEqual(allowedBases(RECORD, { theme: 'https://elsewhere.example/' }), []);
  assert.deepEqual(allowedBases(RECORD, { apiUrl: 'http://hours.example.com/api/' }), []);
  assert.deepEqual(allowedBases(RECORD, { apiUrl: 'https://user:pass@hours.example.com/' }), []);
  assert.deepEqual(allowedBases(RECORD, { apiUrl: '   ' }), []);
  assert.deepEqual(allowedBases({ ...RECORD, network: undefined }, VALUES), []);
});

test('an address is within the base at its path or below a slash, never beside it', () => {
  const base = new URL('https://hours.example.com/api');
  assert.equal(within(new URL('https://hours.example.com/api'), base), true);
  assert.equal(within(new URL('https://hours.example.com/api/'), base), true);
  assert.equal(within(new URL('https://hours.example.com/api/?action=login'), base), true);
  assert.equal(within(new URL('https://hours.example.com/api-admin/'), base), false);
  assert.equal(within(new URL('https://hours.example.com/'), base), false);
  assert.equal(within(new URL('https://hours.example.com/api/../admin'), base), false);
  assert.equal(within(new URL('https://hours.example.com/api/%2e%2e/admin'), base), false);
  // An escaped slash survives the parser; a server that decodes first would
  // land outside the base.
  assert.equal(within(new URL('https://hours.example.com/api/..%2Fadmin'), base), false);
  assert.equal(within(new URL('https://hours.example.com/api/%2e%2e%5cadmin'), base), false);
  assert.equal(within(new URL('https://hours.example.com.evil.example/api/'), base), false);
  assert.equal(within(new URL('https://hours.example.com:8443/api/'), base), false);
});

test('refuses a mod that is off, missing, a theme, or names no address', async () => {
  const { calls, fetchImpl } = server();
  const ask = { url: 'https://hours.example.com/api/', method: 'POST', form: { a: 'b' } };
  assert.deepEqual(await netRequest(undefined, true, VALUES, ask, fetchImpl), { error: 'blocked' });
  assert.deepEqual(await netRequest(RECORD, false, VALUES, ask, fetchImpl), { error: 'blocked' });
  assert.deepEqual(await netRequest({ ...RECORD, type: 'theme' }, true, VALUES, ask, fetchImpl), { error: 'blocked' });
  assert.deepEqual(await netRequest({ ...RECORD, network: undefined }, true, VALUES, ask, fetchImpl), { error: 'blocked' });
  assert.equal(calls.length, 0, 'nothing may leave for a refused request');
});

test('refuses any address the settings do not hold, before anything leaves', async () => {
  const { calls, fetchImpl } = server();
  for (const url of [
    'https://elsewhere.example/api/',
    'https://hours.example.com/other/',
    'http://hours.example.com/api/',
    'https://user:pass@hours.example.com/api/',
    'file:///etc/passwd',
    'not a url',
    42,
  ]) {
    assert.deepEqual(await netRequest(RECORD, true, VALUES, { url, method: 'GET' }, fetchImpl),
      { error: 'blocked' }, `should refuse ${url}`);
  }
  assert.equal(calls.length, 0);
});

test('refuses a request it would not know how to send', async () => {
  const { calls, fetchImpl } = server();
  const url = 'https://hours.example.com/api/';
  for (const ask of [
    { url, method: 'PUT' },
    { url, method: 'GET', form: { a: 'b' } },
    { url, method: 'POST', form: { a: 1 } },
    { url, method: 'POST', form: ['a'] },
    { url, method: 'POST', form: Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, 'v'])) },
    { url, method: 'POST', form: { big: 'x'.repeat(70_000) } },
  ]) {
    assert.deepEqual(await netRequest(RECORD, true, VALUES, ask, fetchImpl), { error: 'invalid' });
  }
  assert.equal(calls.length, 0);
});

test('sends a form, accepts JSON, follows nothing and sets no header of the mod\'s', async () => {
  const { calls, fetchImpl } = server({ token: 't', weeks: {} });
  const answer = await netRequest(RECORD, true, VALUES, {
    url: 'https://hours.example.com/api/#ignored',
    method: 'POST',
    form: { username: 'robin', password: 'p&ss=word' },
  }, fetchImpl);

  assert.deepEqual(answer, { status: 200, json: { token: 't', weeks: {} } });
  assert.equal(calls.length, 1);
  const [{ url, options }] = calls;
  assert.equal(url, 'https://hours.example.com/api/', 'the fragment never leaves');
  assert.equal(options.method, 'POST');
  assert.equal(options.body, 'username=robin&password=p%26ss%3Dword');
  assert.equal(options.redirect, 'manual');
  assert.deepEqual(Object.keys(options.headers).sort(), ['accept', 'content-type']);
  assert.equal(options.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.ok(options.signal, 'every request carries a timeout');
});

test('a GET carries no body and no content type', async () => {
  const { calls, fetchImpl } = server();
  await netRequest(RECORD, true, VALUES, { url: 'https://hours.example.com/api/manifest.json' }, fetchImpl);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.body, undefined);
  assert.deepEqual(Object.keys(calls[0].options.headers), ['accept']);
});

test('an error status is still an answer, and a body that is not JSON is null', async () => {
  const unauthorised = server({ error: 'Invalid or expired token' }, { status: 401 });
  assert.deepEqual(
    await netRequest(RECORD, true, VALUES, { url: VALUES.apiUrl, method: 'POST', form: {} }, unauthorised.fetchImpl),
    { status: 401, json: { error: 'Invalid or expired token' } },
  );
  const html = server('<html>Bad gateway</html>', { status: 502 });
  assert.deepEqual(
    await netRequest(RECORD, true, VALUES, { url: VALUES.apiUrl }, html.fetchImpl),
    { status: 502, json: null },
  );
});

test('a redirect comes back as a status and is never followed', async () => {
  const { calls, fetchImpl } = server('', { status: 301, headers: { location: 'https://elsewhere.example/' } });
  assert.deepEqual(
    await netRequest(RECORD, true, VALUES, { url: 'https://hours.example.com/api/old', method: 'POST', form: {} }, fetchImpl),
    { status: 301, json: null },
  );
  assert.equal(calls.length, 1);
});

test('a server that does not answer is a timeout, one that cannot be reached is network', async () => {
  const slow = async () => { throw new DOMException('The operation timed out.', 'TimeoutError'); };
  const down = async () => { throw new TypeError('fetch failed'); };
  assert.deepEqual(await netRequest(RECORD, true, VALUES, { url: VALUES.apiUrl }, slow), { error: 'timeout' });
  assert.deepEqual(await netRequest(RECORD, true, VALUES, { url: VALUES.apiUrl }, down), { error: 'network' });
});

test('refuses an answer bigger than it will hold, claimed or streamed', async () => {
  const claimed = async () => new Response('{}', { headers: { 'content-length': String(5 * 1024 * 1024) } });
  assert.deepEqual(await netRequest(RECORD, true, VALUES, { url: VALUES.apiUrl }, claimed), { error: 'too-large' });

  const chunk = new Uint8Array(1024 * 1024);
  const streamed = async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(chunk); },
  }));
  assert.deepEqual(await netRequest(RECORD, true, VALUES, { url: VALUES.apiUrl }, streamed), { error: 'too-large' });
});

test('the manifest names text settings of its own, and only a plugin may', () => {
  const manifest = (extra, type = 'plugin') => JSON.stringify({
    id: 'hours', name: 'Hours', type, version: '1.0.0', author: 'a', description: 'd',
    entry: type === 'plugin' ? 'index.js' : 'theme.css', betterslackApi: 1,
    settings: [
      { key: 'apiUrl', type: 'text', label: 'Server' },
      { key: 'every', type: 'number', label: 'Every' },
    ],
    ...extra,
  });
  assert.deepEqual(parseManifest(manifest({ network: { settings: ['apiUrl'] } }), 'mod.json', 'plugin').network,
    { settings: ['apiUrl'] });
  assert.equal(parseManifest(manifest({}), 'mod.json', 'plugin').network, undefined);
  assert.throws(() => parseManifest(manifest({ network: { settings: ['apiUrl'] } }, 'theme'), 'mod.json', 'theme'),
    /plugins only/);
  assert.throws(() => parseManifest(manifest({ network: { settings: ['missing'] } }), 'mod.json', 'plugin'),
    /not a text setting/);
  assert.throws(() => parseManifest(manifest({ network: { settings: ['every'] } }), 'mod.json', 'plugin'),
    /not a text setting/);
  assert.throws(() => parseManifest(manifest({ network: { settings: [] } }), 'mod.json', 'plugin'),
    /at least one/);
  assert.throws(() => parseManifest(manifest({ network: ['apiUrl'] }), 'mod.json', 'plugin'), /at least one/);
});

// -- a credential: the one header that is not the mod's ----------------------

const GIT = {
  id: 'git',
  type: 'plugin',
  settings: [{ key: 'gitUrl', type: 'text', label: 'Server', default: '' }],
  network: { settings: ['gitUrl'], credential: { header: 'private-token' } },
};
const GIT_VALUES = { gitUrl: 'https://git.example.com' };
const HELD = { origin: 'https://git.example.com', secret: 'glpat-secret-value' };

test('a credential travels in the header the manifest names, to its own origin', async () => {
  const { calls, fetchImpl } = server([]);
  await netRequest(GIT, true, GIT_VALUES, { url: 'https://git.example.com/api/v4/user' }, fetchImpl, HELD);
  assert.deepEqual(calls[0].options.headers, { accept: 'application/json', 'private-token': HELD.secret });
  assert.ok(!calls[0].url.includes(HELD.secret), 'never in the address');

  const bearer = server([]);
  await netRequest({ ...GIT, network: { settings: ['gitUrl'], credential: { header: 'authorization', prefix: 'Bearer ' } } }, true, GIT_VALUES,
    { url: 'https://git.example.com/api/v4/user' }, bearer.fetchImpl, HELD);
  assert.equal(bearer.calls[0].options.headers.authorization, `Bearer ${HELD.secret}`);
});

test('a credential is never sent to another origin, even where the setting now points', async () => {
  const { calls, fetchImpl } = server([]);
  // The address setting was rewritten: the secret was stored for the old one.
  await netRequest(GIT, true, { gitUrl: 'https://evil.example' }, { url: 'https://evil.example/api/v4/user' },
    fetchImpl, HELD);
  assert.deepEqual(Object.keys(calls[0].options.headers), ['accept']);
  // Same host, another port or scheme-equivalent origin: also another origin.
  await netRequest(GIT, true, { gitUrl: 'https://git.example.com:8443' }, { url: 'https://git.example.com:8443/x' },
    fetchImpl, HELD);
  assert.deepEqual(Object.keys(calls[1].options.headers), ['accept']);
});

test('a manifest without a credential sends none, whatever is held', async () => {
  const { calls, fetchImpl } = server([]);
  await netRequest({ ...GIT, network: { settings: ['gitUrl'] } }, true, GIT_VALUES,
    { url: 'https://git.example.com/x' }, fetchImpl, HELD);
  assert.deepEqual(Object.keys(calls[0].options.headers), ['accept']);
});

test('a refused request carries the credential nowhere, and a redirect is not followed with it', async () => {
  const { calls, fetchImpl } = server('', { status: 302, headers: { location: 'https://evil.example/' } });
  assert.deepEqual(await netRequest(GIT, true, GIT_VALUES, { url: 'https://evil.example/' }, fetchImpl, HELD),
    { error: 'blocked' });
  assert.equal(calls.length, 0);
  assert.deepEqual(await netRequest(GIT, true, GIT_VALUES, { url: 'https://git.example.com/old' }, fetchImpl, HELD),
    { status: 302, json: null });
  assert.equal(calls[0].options.redirect, 'manual');
});

test('network.credential names any header a secret may travel in, and refuses the transport\'s own', () => {
  const manifest = (network) => JSON.stringify({
    id: 'git', name: 'Git', type: 'plugin', version: '1.0.0', author: 'a', description: 'd',
    entry: 'index.js', betterslackApi: 1,
    settings: [{ key: 'gitUrl', type: 'text', label: 'Server' }],
    network,
  });
  const parsed = (credential) =>
    parseManifest(manifest({ settings: ['gitUrl'], credential }), 'mod.json', 'plugin').network;
  assert.deepEqual(parsed({ header: 'PRIVATE-TOKEN' }).credential, { header: 'private-token' });
  assert.deepEqual(parsed({ header: 'Authorization', prefix: 'Bearer ' }).credential,
    { header: 'authorization', prefix: 'Bearer ' });
  // A service nobody here has heard of needs nothing added to the loader.
  assert.deepEqual(parsed({ header: 'X-Some-Service-Key' }).credential, { header: 'x-some-service-key' });
  assert.equal(parseManifest(manifest({ settings: ['gitUrl'] }), 'mod.json', 'plugin').network.credential, undefined);

  for (const bad of ['PRIVATE-TOKEN', { header: 'Cookie' }, { header: 'host' }, { header: 'Content-Type' },
    { header: 'Proxy-Authorization' }, { header: 'Sec-Fetch-Mode' }, { header: 'has space' }, { header: 'x\ny' },
    { header: '' }, { header: 'ok', prefix: 'two\nlines' }, { header: 'ok', extra: 1 }, { prefix: 'Bearer ' }, null, []]) {
    assert.throws(() => parsed(bad), /network\.credential/, JSON.stringify(bad));
  }
});
