// The client and the store, against a GitLab made of plain data: what is
// asked, how much, what happens when it goes wrong, and where the token is
// never found.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestApi } from '../../../tests/harness.mjs';
import { createClient, normaliseServer } from './api/gitlab.js';
import { createStore } from './store.js';
import { BASE, NOW, createGitLab, iso, job, mr, pipeline } from './fixtures.test.mjs';

const TOKEN = 'glpat-0123456789abcdefghij';

/** A GitLab with three open merge requests across two groups, one pipeline running. */
function world(extra = {}) {
  const requests = [mr(10, 1658, iso(14)), mr(10, 1408, iso(10)), mr(20, 723, iso(13)), mr(30, 393, iso(9))];
  return createGitLab({
    mergeRequests: requests,
    pipelines: {
      '10/1658': [pipeline(298850, 10, 'running', iso(14, 5)), pipeline(298700, 10, 'failed', iso(12))],
      '10/1408': [pipeline(298830, 10, 'failed', iso(10, 5))],
      '20/723': [pipeline(298844, 20, 'success', iso(13, 5))],
      '30/393': [],
    },
    jobs: {
      298850: [
        job(1, 298850, 10, 'checks', 'Code Quality: [eslint]', 'success'),
        job(2, 298850, 10, 'checks', 'Translations', 'success'),
        job(3, 298850, 10, 'build', 'Vite Build', 'running'),
        job(4, 298850, 10, 'deploy', 'Deploy', 'created'),
      ],
      298830: [job(5, 298830, 10, 'checks', 'oxlint', 'failed'), job(6, 298830, 10, 'build', 'Vite Build', 'skipped')],
      298844: [job(7, 298844, 20, 'checks', 'lint', 'success')],
      298700: [job(8, 298700, 10, 'checks', 'old', 'failed')],
    },
    ...extra,
  });
}

/** A store wired the way index.js wires it, with a clock the test moves. */
function build({ gitlab = world(), settings = { gitUrl: BASE }, ...options } = {}) {
  const harness = createTestApi({ net: gitlab.handler, settings, ...options });
  const { api, recorded } = harness;
  const clock = { now: NOW };
  const client = createClient({
    request: (url, requestOptions) => api.net.request(url, requestOptions),
    getBase: () => normaliseServer(api.settings.get('gitUrl', '')),
  });
  let changes = 0;
  const store = createStore({ api, client, clock: () => clock.now, onChange: () => { changes += 1; } });
  return { api, recorded, gitlab, client, store, clock, changes: () => changes };
}

async function signedIn(options) {
  const t = build(options);
  await t.store.load();
  const outcome = await t.store.signIn(BASE, TOKEN);
  assert.equal(outcome.ok, true);
  await t.store.refresh({ force: true });
  return t;
}

const everything = (t) => JSON.stringify([
  t.gitlab.calls, t.recorded.requests, t.recorded.logs, t.recorded.toasts, t.api.settings.all(),
  [...t.recorded.data].map(([name, entry]) => [name, new TextDecoder().decode(entry.bytes)]),
]);

// -- the client --------------------------------------------------------------

test('an address is reduced to an https base, and anything else is refused', () => {
  assert.equal(normaliseServer('https://gitlab.example.com/'), 'https://gitlab.example.com');
  assert.equal(normaliseServer('gitlab.example.com'), 'https://gitlab.example.com');
  assert.equal(normaliseServer('https://gitlab.example.com/api/v4/user'), 'https://gitlab.example.com');
  assert.equal(normaliseServer('https://example.com/gitlab/'), 'https://example.com/gitlab');
  assert.equal(normaliseServer('https://gitlab.example.com/?x=1#y'), 'https://gitlab.example.com');
  // An intranet name has no dot, and the loader reaches any https address.
  assert.equal(normaliseServer('https://gitlab/'), 'https://gitlab');
  assert.equal(normaliseServer('https://localhost:8443'), 'https://localhost:8443');
  for (const bad of ['http://gitlab.example.com', 'https://u:p@gitlab.example.com', 'ftp://x.example.com', '', '   ', null, 'https://']) {
    assert.equal(normaliseServer(bad), null, String(bad));
  }
});

test('it asks for the open merge requests of the signed-in user, by id, across everything', async () => {
  const t = await signedIn();
  const list = t.gitlab.calls.filter((call) => call.path === '/api/v4/merge_requests');
  assert.ok(list.length >= 1);
  assert.deepEqual({ ...list[0].params, page: undefined, per_page: undefined }, {
    state: 'opened', scope: 'all', author_id: '7', order_by: 'updated_at', sort: 'desc', page: undefined, per_page: undefined,
  });
  // One global request: no group, no project and no user name is in any address.
  for (const call of t.gitlab.calls) {
    assert.ok(!/\/groups\/|dating|apps|robin/.test(call.url.replace(BASE, '')), call.url);
  }
  assert.equal(t.store.state.mergeRequests.length, 4);
});

test('every page is read, and a full last page says there may be more', async () => {
  const many = Array.from({ length: 250 }, (_, i) => mr(10, i + 1, iso(1, i)));
  const t = build({ gitlab: createGitLab({ mergeRequests: many }) });
  await t.store.load();
  await t.store.signIn(BASE, TOKEN);
  const result = await t.client.mergeRequests(7);
  assert.equal(result.ok, true);
  assert.equal(result.items.length, 250);
  assert.equal(result.partial, null);
  assert.equal(t.gitlab.calls.filter((call) => call.path === '/api/v4/merge_requests' && call.params.author_id === '7').length >= 3, true);

  const huge = build({ gitlab: createGitLab({ mergeRequests: Array.from({ length: 600 }, (_, i) => mr(10, i + 1, iso(1, i % 60))) }) });
  await huge.store.load();
  await huge.store.signIn(BASE, TOKEN);
  const capped = await huge.client.mergeRequests(7);
  assert.equal(capped.items.length, 500);
  assert.equal(capped.partial, 'pagination');
});

test('a later page failing keeps the merge requests already read', async () => {
  const many = Array.from({ length: 150 }, (_, i) => mr(10, i + 1, iso(1, i % 60)));
  const gitlab = createGitLab({ mergeRequests: many });
  const inner = gitlab.handler;
  const handler = async (url, options) => (new URL(url).searchParams.get('page') === '2' && new URL(url).pathname.endsWith('/merge_requests')
    ? { status: 502, json: null } : inner(url, options));
  const t = build({ gitlab: { ...gitlab, handler } });
  t.api.net.request = (url, options) => handler(url, { ...options, credential: true });
  const result = await t.client.mergeRequests(7);
  assert.equal(result.ok, true);
  assert.equal(result.items.length, 100);
  assert.equal(result.partial, 'server');
});

test('every failure is one reason from a short list, and none echoes what the server said', async () => {
  const cases = [[{ status: 401, json: { message: TOKEN } }, 'unauthorized'], [{ status: 403, json: {} }, 'forbidden'],
    [{ status: 404, json: {} }, 'notFound'], [{ status: 429, json: {} }, 'rateLimited'], [{ status: 500, json: {} }, 'server'],
    [{ status: 503, json: null }, 'server'], [{ status: 301, json: null }, 'redirect'], [{ error: 'timeout' }, 'timeout'],
    [{ error: 'network' }, 'unreachable'], [{ error: 'blocked' }, 'blocked'], [{ status: 200, json: null }, 'unexpected'],
    [{ status: 418, json: {} }, 'unexpected']];
  for (const [answer, reason] of cases) {
    const client = createClient({ request: async () => answer, getBase: () => BASE });
    const result = await client.user();
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
    assert.ok(!JSON.stringify(result).includes(TOKEN));
  }
  const throwing = createClient({ request: async () => { throw new Error(TOKEN); }, getBase: () => BASE });
  assert.deepEqual(await throwing.user(), { ok: false, reason: 'unreachable' });
});

test('the same request asked twice at once is one request, and never more than four are in the air', async () => {
  let inAir = 0;
  let peak = 0;
  let calls = 0;
  const client = createClient({
    getBase: () => BASE,
    request: async () => {
      calls += 1;
      inAir += 1;
      peak = Math.max(peak, inAir);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inAir -= 1;
      return { status: 200, json: { id: 1, name: 'n', path_with_namespace: 'a/b', web_url: `${BASE}/a/b` } };
    },
  });
  await Promise.all([client.project(1), client.project(1), client.project(1)]);
  assert.equal(calls, 1);
  await Promise.all(Array.from({ length: 12 }, (_, i) => client.project(i + 2)));
  assert.equal(peak, 4);
});

test('nothing is asked of a server that has no address', async () => {
  let asked = 0;
  const client = createClient({ request: async () => { asked += 1; return { status: 200, json: {} }; }, getBase: () => null });
  assert.deepEqual(await client.user(), { ok: false, reason: 'blocked' });
  assert.equal(asked, 0);
});

// -- signing in and out ------------------------------------------------------

test('a valid token signs in, and the user comes from GitLab, not from a setting', async () => {
  const t = build();
  await t.store.load();
  assert.equal(t.store.state.signedIn, false);
  const outcome = await t.store.signIn(`${BASE}/`, `  ${TOKEN}  `);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.user.username, 'robin');
  assert.deepEqual(t.recorded.credentials, [{ secret: TOKEN, address: BASE }], 'trimmed, and handed to the loader');
  assert.equal(t.store.state.signedIn, true);
  assert.equal(t.store.state.user.id, 7);
  assert.equal(t.api.settings.get('gitUrl'), BASE);
  await t.store.refresh({ force: true });
  assert.equal(t.gitlab.calls.find((call) => call.path === '/api/v4/merge_requests').params.author_id, '7');
  assert.equal(t.gitlab.calls.every((call) => call.credential), true, 'every request carries the loader\'s credential');
});

test('the token is in no address, no log, no toast, no setting, no file and no error', async () => {
  const good = await signedIn();
  await good.store.flush();
  assert.ok(!everything(good).includes(TOKEN));

  const bad = build({ gitlab: createGitLab({ fail: { status: 401 } }) });
  await bad.store.load();
  const outcome = await bad.store.signIn(BASE, TOKEN);
  assert.equal(outcome.ok, false);
  assert.ok(!JSON.stringify(outcome).includes(TOKEN));
  assert.ok(!everything(bad).replace(JSON.stringify(bad.recorded.credentials), '').includes(TOKEN),
    'only the call that hands it to the loader holds it');
});

test('a token the server refuses is not kept, and nothing else is written', async () => {
  const t = build({ gitlab: createGitLab({ fail: { status: 401 } }) });
  await t.store.load();
  const outcome = await t.store.signIn(BASE, TOKEN);
  assert.deepEqual(outcome, { ok: false, reason: 'unauthorized' });
  assert.equal(t.recorded.credentialFor, null, 'the loader was told to forget it');
  assert.equal(t.store.state.signedIn, false);
  assert.equal(t.recorded.data.size, 0);
});

test('an unreachable server leaves nothing behind either', async () => {
  for (const [fail, reason] of [[{ error: 'network' }, 'unreachable'], [{ error: 'timeout' }, 'timeout'], [{ status: 403 }, 'forbidden'], [{ status: 502 }, 'server']]) {
    const t = build({ gitlab: createGitLab({ fail }) });
    await t.store.load();
    assert.deepEqual(await t.store.signIn(BASE, TOKEN), { ok: false, reason });
    assert.equal(t.recorded.credentialFor, null);
  }
});

test('a malformed address or token is refused before anything is sent', async () => {
  const t = build();
  await t.store.load();
  assert.deepEqual(await t.store.signIn('http://gitlab.example.com', TOKEN), { ok: false, reason: 'address' });
  assert.deepEqual(await t.store.signIn(BASE, 'short'), { ok: false, reason: 'tokenFormat' });
  assert.deepEqual(await t.store.signIn(BASE, 'has a space in it, so it is not a token'), { ok: false, reason: 'tokenFormat' });
  assert.deepEqual(await t.store.signIn(BASE, ''), { ok: false, reason: 'tokenFormat' });
  assert.equal(t.recorded.credentials.length, 0);
  assert.equal(t.gitlab.calls.length, 0);
});

test('a loader that refuses the credential is a refusal, and no request follows', async () => {
  const t = build({ credentialAccepted: false });
  await t.store.load();
  assert.deepEqual(await t.store.signIn(BASE, TOKEN), { ok: false, reason: 'blocked' });
  assert.equal(t.gitlab.calls.length, 0);
});

test('signing out forgets the token, who it was and everything that was kept', async () => {
  const t = await signedIn();
  await t.store.flush();
  assert.ok(t.recorded.data.has('snapshot.json') && t.recorded.data.has('session.json'));
  await t.store.signOut();
  assert.equal(t.recorded.credentialFor, null);
  assert.equal(t.recorded.data.size, 0);
  assert.equal(t.store.state.signedIn, false);
  assert.equal(t.store.state.mergeRequests.length, 0);
  assert.equal(t.store.state.user, null);
});

test('a token revoked mid-session ends the session, the cache and the credential, and says so', async () => {
  const t = await signedIn();
  await t.store.flush();
  t.gitlab.state.fail = { status: 401 };
  t.clock.now += 6 * 60_000;
  await t.store.refresh();
  assert.equal(t.store.state.signedIn, false);
  assert.equal(t.store.state.invalid, true);
  assert.equal(t.recorded.credentialFor, null);
  assert.equal(t.recorded.data.has('snapshot.json'), false);
  assert.equal(t.store.state.mergeRequests.length, 0);
  assert.equal(t.store.state.lastUser, 'robin', 'the name is kept for the form');
});

// -- reading -----------------------------------------------------------------

test('only the merge requests of the user, grouped by project in the order of the newest, with their pipelines and jobs', async () => {
  const t = await signedIn();
  const { state } = t.store;
  assert.equal(state.mergeRequests.length, 4);
  assert.deepEqual(Object.keys(state.projects).sort(), ['10', '20', '30']);
  const running = state.mergeRequests.find((request) => request.iid === 1658);
  assert.equal(state.pipelines[running.id].list[0].id, 298850, 'newest first');
  assert.equal(state.pipelines[running.id].active, true);
  assert.equal(state.jobs[298850].jobs.length, 4);
});

test('the list is drawn before the rest arrives', async () => {
  const t = build();
  await t.store.load();
  await t.store.signIn(BASE, TOKEN);
  const seen = [];
  const inner = t.api.net.request;
  t.api.net.request = async (url, options) => {
    if (/\/merge_requests\/\d+\/pipelines/.test(url)) seen.push(t.store.state.mergeRequests.length);
    return inner(url, options);
  };
  await t.store.refresh({ force: true });
  assert.ok(seen.length > 0 && seen.every((count) => count === 4), 'by the time a pipeline is asked for, the list is in');
});

test('a merge request that fails does not take the others with it', async () => {
  const gitlab = world();
  delete gitlab.state.pipelines['20/723'];
  const t = await signedIn({ gitlab });
  const failing = t.store.state.mergeRequests.find((request) => request.iid === 723);
  assert.equal(t.store.state.pipelines[failing.id].error, 'inaccessible');
  const fine = t.store.state.mergeRequests.find((request) => request.iid === 1658);
  assert.equal(t.store.state.pipelines[fine.id].list.length, 2);
  assert.equal(t.store.state.failure, null, 'the round as a whole succeeded');
});

test('a merge request closed between two rounds disappears, with its pipelines', async () => {
  const t = await signedIn();
  const gone = t.store.state.mergeRequests.find((request) => request.iid === 393);
  t.gitlab.state.mergeRequests = t.gitlab.state.mergeRequests.filter((raw) => raw.iid !== 393);
  await t.store.refresh({ force: true });
  assert.equal(t.store.state.mergeRequests.length, 3);
  assert.equal(t.store.state.pipelines[gone.id], undefined);
});

test('when GitLab cannot be reached the last answers stay, marked, and the next try waits', async () => {
  const t = await signedIn();
  t.gitlab.state.fail = { error: 'network' };
  await t.store.refresh({ force: true });
  assert.equal(t.store.state.mergeRequests.length, 4);
  assert.deepEqual({ reason: t.store.state.failure.reason, count: t.store.state.failure.count }, { reason: 'unreachable', count: 1 });
  const asked = t.gitlab.calls.length;
  t.clock.now += 10_000;
  await t.store.tick();
  assert.equal(t.gitlab.calls.length, asked, 'inside the wait, nothing is asked');
  t.gitlab.state.fail = null;
  t.clock.now += 5 * 60_000;
  await t.store.tick();
  assert.equal(t.store.state.failure, null);
});

test('asking while a round is travelling is handed that round, not a second one', async () => {
  const t = build();
  await t.store.load();
  await t.store.signIn(BASE, TOKEN);
  await t.store.refresh({ force: true });
  const before = t.gitlab.calls.filter((call) => call.path === '/api/v4/merge_requests').length;
  await Promise.all([t.store.refresh({ force: true }), t.store.refresh({ force: true }), t.store.refresh()]);
  assert.equal(t.gitlab.calls.filter((call) => call.path === '/api/v4/merge_requests').length, before + 1);
});

test('a pulse asks about the pipelines that are going, and about nothing else', async () => {
  const t = await signedIn();
  t.gitlab.calls.length = 0;
  t.clock.now += 11_000;
  await t.store.refresh({ pulse: true });
  const paths = t.gitlab.calls.map((call) => call.path.replace(/\d+/g, 'N'));
  assert.ok(!paths.includes('/api/v4/merge_requests'));
  assert.ok(paths.every((path) => /pipelines/.test(path)), paths.join(' '));
  assert.equal(paths.filter((path) => path.endsWith('/pipelines')).length, 1, 'one merge request has one that is going');
});

test('a finished pipeline is not asked about again until something changes, and its jobs not at all', async () => {
  const t = await signedIn();
  t.gitlab.calls.length = 0;
  t.clock.now += 60_000;
  await t.store.refresh();
  const asked = t.gitlab.calls.map((call) => call.path);
  assert.equal(asked.filter((path) => path.endsWith('/merge_requests/1408/pipelines')).length, 0);
  assert.equal(asked.filter((path) => path.includes('/pipelines/298830/jobs')).length, 0);
  assert.equal(asked.filter((path) => path.includes('/pipelines/298844/jobs')).length, 0);
  // Somebody pushes: the merge request's sha moves, and its pipelines are looked at again.
  t.gitlab.state.mergeRequests.find((raw) => raw.iid === 1408).sha = 'new';
  t.gitlab.calls.length = 0;
  t.clock.now += 60_000;
  await t.store.refresh();
  assert.equal(t.gitlab.calls.filter((call) => call.path.endsWith('/merge_requests/1408/pipelines')).length, 1);
});

test('projects are asked for once, however many merge requests they have', async () => {
  const t = await signedIn();
  const projectCalls = t.gitlab.calls.filter((call) => /^\/api\/v4\/projects\/\d+$/.test(call.path));
  assert.equal(projectCalls.length, 3);
  t.gitlab.calls.length = 0;
  t.clock.now += 60_000;
  await t.store.refresh({ force: true });
  assert.equal(t.gitlab.calls.filter((call) => /^\/api\/v4\/projects\/\d+$/.test(call.path)).length, 0);
});

test('hundreds of merge requests do not become hundreds of requests at once', async () => {
  const many = Array.from({ length: 80 }, (_, i) => mr(10, i + 1, iso(1, i % 60)));
  const pipelines = Object.fromEntries(many.map((request, i) => [`10/${request.iid}`, [pipeline(5000 + i, 10, 'success', iso(2))]]));
  const jobs = Object.fromEntries(many.map((_, i) => [5000 + i, [job(i + 1, 5000 + i, 10, 'a', 'x', 'success')]]));
  const t = await signedIn({ gitlab: createGitLab({ mergeRequests: many, pipelines, jobs }) });
  const jobCalls = t.gitlab.calls.filter((call) => call.path.endsWith('/jobs')).length;
  assert.equal(jobCalls, 30, 'a round asks for the jobs of thirty, and says there are more');
  assert.equal(t.store.state.backlog, true);
  t.clock.now += 6_000;
  await t.store.tick();
  assert.equal(t.gitlab.calls.filter((call) => call.path.endsWith('/jobs')).length, 60);
});

// -- the cache ---------------------------------------------------------------

test('a restart draws what was kept at once, then refreshes it', async () => {
  const first = await signedIn();
  await first.store.flush();
  const files = first.recorded.data;

  const second = build({ gitlab: createGitLab({ fail: { error: 'network' } }) });
  for (const [name, entry] of files) second.recorded.data.set(name, entry);
  second.recorded.credentialFor = new URL(BASE).origin;
  await second.store.load();
  assert.equal(second.store.state.signedIn, true);
  assert.equal(second.store.state.mergeRequests.length, 4, 'drawn before GitLab has answered');
  assert.equal(second.gitlab.calls.length, 0);
  await second.store.tick();
  assert.equal(second.store.state.mergeRequests.length, 4, 'and kept when GitLab cannot be reached');
  assert.equal(second.store.state.failure.reason, 'unreachable');
});

test('what was kept is not used for another account, a stale day, or when signed out', async () => {
  const first = await signedIn();
  await first.store.flush();
  const copy = (target) => { for (const [name, entry] of first.recorded.data) target.recorded.data.set(name, entry); };

  const other = build({ gitlab: createGitLab({ me: { id: 8, username: 'sam', name: 'Sam' } }) });
  copy(other);
  other.recorded.credentialFor = new URL(BASE).origin;
  const session = JSON.parse(new TextDecoder().decode(other.recorded.data.get('session.json').bytes));
  session.user.id = 8;
  other.recorded.data.set('session.json', { bytes: new TextEncoder().encode(JSON.stringify(session)), modified: 0 });
  await other.store.load();
  assert.equal(other.store.state.mergeRequests.length, 0, 'a snapshot for user 7 is not user 8\'s');

  const old = build();
  copy(old);
  old.recorded.credentialFor = new URL(BASE).origin;
  old.clock.now = NOW + 25 * 3600_000;
  const aged = createStore({ api: old.api, client: old.client, clock: () => old.clock.now });
  await aged.load();
  assert.equal(aged.state.mergeRequests.length, 0);

  const out = build();
  copy(out);
  await out.store.load();
  assert.equal(out.store.state.signedIn, false);
  assert.equal(out.store.state.mergeRequests.length, 0, 'without a credential there is nothing to show');
});

test('what is written to disk is never written more than once in five seconds', async () => {
  const t = await signedIn();
  const writes = [];
  const inner = t.api.data.write;
  t.api.data.write = (name, content) => { writes.push(name); return inner(name, content); };
  for (let i = 0; i < 5; i += 1) { t.clock.now += 500; await t.store.refresh({ force: true }); }
  assert.equal(writes.filter((name) => name === 'snapshot.json').length, 0, 'the first save was at sign-in');
  t.clock.now += 6000;
  await t.store.refresh({ force: true });
  assert.equal(writes.filter((name) => name === 'snapshot.json').length, 1);
});

test('a round that was travelling when the session ended writes nothing into the cleared state', async () => {
  const gitlab = world();
  const t = build({ gitlab });
  await t.store.load();
  await t.store.signIn(BASE, TOKEN);
  await t.store.refresh({ force: true });
  assert.equal(t.store.state.mergeRequests.length, 4);

  // The next list answers only when told to.
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const inner = t.api.net.request;
  t.api.net.request = async (url, options) => {
    if (new URL(url).pathname === '/api/v4/merge_requests') await gate;
    return inner(url, options);
  };
  t.clock.now += 60_000;
  const travelling = t.store.refresh({ force: true });
  await t.store.signOut();
  release();
  await travelling;
  assert.equal(t.store.state.signedIn, false);
  assert.equal(t.store.state.mergeRequests.length, 0, 'the last account\'s merge requests do not come back');
  assert.deepEqual(t.store.state.pipelines, {});
  assert.deepEqual(t.store.state.jobs, {});
  assert.deepEqual(t.store.state.projects, {});
  assert.equal(t.recorded.data.size, 0, 'and nothing is kept for the next account to find');
});

test('a token refused while a round travels ends the session once and keeps nothing', async () => {
  const gitlab = world();
  const t = build({ gitlab });
  await t.store.load();
  await t.store.signIn(BASE, TOKEN);
  await t.store.refresh({ force: true });
  t.gitlab.state.fail = { status: 401 };
  t.clock.now += 60_000;
  await t.store.refresh({ force: true });
  assert.equal(t.store.state.invalid, true);
  assert.equal(t.store.state.mergeRequests.length, 0);
  assert.equal(t.recorded.credentialFor, null);
});
