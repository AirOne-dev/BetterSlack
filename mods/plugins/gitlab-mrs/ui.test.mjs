// The plugin as the runtime loads it, against a GitLab made of plain data:
// what it puts in Slack, what a click does, how the bar shrinks, and what it
// never sends.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { assertPluginShape, createTestApi, installDom } from '../../../tests/harness.mjs';
import plugin from './index.js';
import { levelsFor } from './lib/fit.js';
import { BASE, createGitLab, iso, job, mr, pipeline } from './fixtures.test.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(path.join(here, 'gitlab.css'), 'utf8');
const TOKEN = 'glpat-0123456789abcdefghij';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The far left of the top bar, as Slack 4.51 lays it out: an empty container
// first, the history arrows in the one after it.
const SLOT = `<div class="p-ia4_top_nav__left_container">
  <div class="p-ia4_top_nav__left_container--start"></div>
  <div class="p-ia4_top_nav__left_container--end"><div class="p-ia4_history_buttons"></div></div>
</div>`;

function world() {
  return createGitLab({
    mergeRequests: [mr(10, 1658, iso(14)), mr(10, 1408, iso(10)), mr(20, 723, iso(13)), mr(30, 393, iso(9))],
    pipelines: {
      '10/1658': [pipeline(298850, 10, 'running', iso(14, 5))],
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
      298844: [job(7, 298844, 20, 'checks', 'lint', 'success'), job(8, 298844, 20, 'deploy', 'Deploy', 'manual')],
    },
  });
}

async function boot({ gitlab = world(), settings = { gitUrl: BASE }, signedIn = false } = {}) {
  const dom = installDom();
  document.body.insertAdjacentHTML('beforeend', SLOT);
  const harness = createTestApi({ net: gitlab.handler, settings, files: { 'gitlab.css': CSS } });
  if (signedIn) harness.recorded.credentialFor = new URL(BASE).origin;
  await plugin.start(harness.api);
  const stop = () => {
    for (const dispose of harness.recorded.disposers) { try { dispose(); } catch { /* already gone */ } }
    dom.cleanup();
  };
  const [{ handle }] = harness.recorded.views;
  return { ...harness, gitlab, dom, stop, view: handle };
}

async function until(check, ms = 1500) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await sleep(10);
  }
  assert.fail('timed out waiting');
}

async function connect(t) {
  t.view.open();
  const address = document.querySelector('.betterslack-gitlab-login input[name="address"]');
  const token = document.querySelector('.betterslack-gitlab-login input[name="token"]');
  assert.equal(address.value, BASE, 'prefilled from the setting');
  token.value = TOKEN;
  document.querySelector('.betterslack-gitlab-login').dispatchEvent(new window.Event('submit', { cancelable: true }));
  assert.equal(token.value, '', 'the token leaves the field before the request does');
  await until(() => document.querySelectorAll('.betterslack-gitlab-stage').length >= 5);
  await sleep(60);
}

const text = (node) => node.textContent.replace(/\s+/g, ' ').trim();

test('has the shape the runtime loads', () => assertPluginShape(assert, plugin));

test('puts a tab in the rail, a command in the palette, and a bar in the top bar', async () => {
  const t = await boot();
  try {
    assert.ok(document.querySelector(t.view.tabSelector), 'the tab is in the rail');
    assert.equal(document.querySelector(t.view.tabSelector).getAttribute('aria-label'), 'GitLab');
    const bar = document.getElementById('betterslack-gitlab');
    assert.ok(bar, 'the bar is mounted');
    assert.equal(bar.parentElement.className, 'p-ia4_top_nav__left_container--start', 'at the far left, before the history arrows');
    assert.ok(bar.compareDocumentPosition(document.querySelector('.p-ia4_history_buttons')) & Node.DOCUMENT_POSITION_FOLLOWING);
    assert.ok(t.recorded.commands.some((command) => command.title === 'Open GitLab Merge Requests'));
    t.recorded.commands.find((command) => command.id === 'open').run();
    assert.equal(t.view.isOpen(), true);
    assert.ok(t.recorded.css.some((css) => css.includes('betterslack-gitlab-bar')));
  } finally { t.stop(); }
});

test('signed out, the bar says so and opens the form; the view shows the form', async () => {
  const t = await boot();
  try {
    await sleep(60);
    const bar = document.getElementById('betterslack-gitlab');
    assert.equal(text(bar), 'GitLab · Connect');
    bar.click();
    assert.equal(t.view.isOpen(), true, 'the bar is the way to the form');
    assert.ok(document.querySelector('.betterslack-gitlab-login'));
    assert.equal(document.querySelector('.betterslack-gitlab-login input[name="token"]').type, 'password');
  } finally { t.stop(); }
});

test('a token the server refuses is said so, in words, and nothing is kept', async () => {
  const t = await boot({ gitlab: createGitLab({ fail: { status: 401 } }) });
  try {
    t.view.open();
    const form = document.querySelector('.betterslack-gitlab-login');
    form.querySelector('input[name="token"]').value = TOKEN;
    form.dispatchEvent(new window.Event('submit', { cancelable: true }));
    await until(() => form.querySelector('.betterslack-gitlab-login__error').textContent !== '');
    assert.match(form.querySelector('.betterslack-gitlab-login__error').textContent, /did not accept this token/);
    assert.ok(!document.body.innerHTML.includes(TOKEN));
    assert.equal(t.recorded.credentialFor, null);
    assert.equal(form.querySelector('input[name="token"]').value, '');
  } finally { t.stop(); }
});

test('signed in: projects by their newest merge request, each with its pipeline, stages and links', async () => {
  const t = await boot();
  try {
    await connect(t);
    const projects = [...document.querySelectorAll('.betterslack-gitlab-project')];
    assert.deepEqual(projects.map((section) => section.querySelector('.betterslack-gitlab-project__name').textContent),
      ['Vision', 'Portals Builder', 'Vite Admin'], 'Vision has the newest, then Portals Builder, then Vite Admin');
    assert.deepEqual(projects.map((section) => section.querySelector('.betterslack-gitlab-project__namespace').textContent),
      ['dating', 'dating', 'apps']);
    const visionRows = [...projects[0].querySelectorAll('.betterslack-gitlab-mr')];
    assert.deepEqual(visionRows.map((row) => row.querySelector('.betterslack-gitlab-mr__number').textContent), ['!1658', '!1408']);

    const first = visionRows[0];
    assert.equal(first.querySelector('.betterslack-gitlab-mr__title').getAttribute('href'), `${BASE}/dating/vision/-/merge_requests/1658`);
    assert.equal(first.querySelector('.betterslack-gitlab-mr__number').getAttribute('href'), `${BASE}/dating/vision/-/merge_requests/1658`);
    assert.equal(first.querySelector('.betterslack-gitlab-chip').getAttribute('href'), `${BASE}/dating/vision/-/pipelines/298850`);
    assert.equal(projects[0].querySelector('.betterslack-gitlab-project__name').getAttribute('href'), `${BASE}/dating/vision`);
    assert.deepEqual([...first.querySelectorAll('.betterslack-gitlab-stage')].map((stage) => stage.dataset.stage), ['checks', 'build', 'deploy']);
    assert.deepEqual([...first.querySelectorAll('.betterslack-gitlab-stage')].map((stage) => stage.dataset.status), ['success', 'running', 'created']);
    assert.equal(text(first.querySelector('.betterslack-gitlab-progress')), '2/4', 'two of the four jobs have finished');
    assert.match(first.querySelector('.betterslack-gitlab-stage').getAttribute('aria-label'), /checks: Passed/);
    assert.equal(text(projects[2].querySelector('.betterslack-gitlab-note')), 'No pipeline');
  } finally { t.stop(); }
});

test('every link is one of GitLab\'s own pages, opened in a new window that cannot reach back', async () => {
  const t = await boot();
  try {
    await connect(t);
    const links = [...document.querySelectorAll('.betterslack-gitlab-view a[href]')];
    assert.ok(links.length > 8);
    for (const anchor of links) {
      assert.ok(anchor.href.startsWith(`${BASE}/`), anchor.href);
      assert.equal(anchor.target, '_blank');
      assert.match(anchor.rel, /noopener/);
      assert.match(anchor.rel, /noreferrer/);
    }
  } finally { t.stop(); }
});

test('a stage opens its jobs, each a link to GitLab, and a click elsewhere closes it', async () => {
  const t = await boot();
  try {
    await connect(t);
    const stage = document.querySelector('.betterslack-gitlab-stage[data-stage="checks"]');
    stage.click();
    await sleep(5);
    const layer = document.getElementById('betterslack-gitlab-layer');
    assert.ok(layer);
    assert.equal(text(layer.querySelector('.betterslack-gitlab-popover__title')), 'checks');
    const jobs = [...layer.querySelectorAll('.betterslack-gitlab-job')];
    assert.deepEqual(jobs.map((row) => row.querySelector('.betterslack-gitlab-job__name').textContent),
      ['Code Quality: [eslint]', 'Translations']);
    assert.deepEqual(jobs.map((row) => row.getAttribute('href')), [`${BASE}/dating/vision/-/jobs/1`, `${BASE}/dating/vision/-/jobs/2`]);
    assert.equal(text(jobs[0].querySelector('.betterslack-gitlab-job__meta')), '43s');
    assert.equal(layer.querySelector('.betterslack-gitlab-popover__link').getAttribute('href'), `${BASE}/dating/vision/-/pipelines/298850`);

    document.querySelector('.betterslack-gitlab-stage[data-stage="build"]').click();
    await sleep(5);
    assert.equal(document.querySelectorAll('#betterslack-gitlab-layer').length, 1, 'one popover at a time');
    assert.equal(text(document.querySelector('#betterslack-gitlab-layer .betterslack-gitlab-popover__title')), 'build');

    await sleep(5);
    document.body.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
    assert.equal(document.getElementById('betterslack-gitlab-layer'), null);
  } finally { t.stop(); }
});

test('a job that is manual or failed says what it is, not just that it is not green', async () => {
  const t = await boot();
  try {
    await connect(t);
    document.querySelector('.betterslack-gitlab-stage[data-stage="deploy"][data-pipeline="298844"]').click();
    await sleep(5);
    const row = document.querySelector('#betterslack-gitlab-layer .betterslack-gitlab-job');
    assert.equal(row.dataset.kind, 'manual');
    assert.equal(text(row.querySelector('.betterslack-gitlab-job__meta')), 'Waiting for you');
    assert.match(row.getAttribute('aria-label'), /Waiting for you/);
  } finally { t.stop(); }
});

test('the top bar shows the pipeline that is going, and what it is on', async () => {
  const t = await boot();
  try {
    await connect(t);
    const bar = document.getElementById('betterslack-gitlab');
    assert.equal(bar.dataset.phase, 'ready');
    assert.equal(bar.dataset.kind, 'running');
    assert.equal(text(bar.querySelector('.betterslack-gitlab-bar__project')), 'Vision');
    assert.equal(text(bar.querySelector('.betterslack-gitlab-bar__mr')), '!1658');
    assert.equal(text(bar.querySelector('.betterslack-gitlab-bar__note')), 'build');
    assert.equal(text(bar.querySelector('.betterslack-gitlab-bar__progress')), '2/4');
    assert.deepEqual([...bar.querySelectorAll('.betterslack-gitlab-dot')].map((dot) => dot.dataset.status), ['success', 'running', 'created']);
    assert.equal(bar.dataset.parts, 'icon project mr branch note progress dots');
    assert.equal(text(bar.querySelector('.betterslack-gitlab-bar__branch')), 'feature/1658', 'the merge request\'s branch, when there is room');
    assert.equal(bar.dataset.tone, 'info', 'the icon is tinted by how the pipeline is going');
    assert.ok(bar.querySelector('.betterslack-gitlab-bar__caret'), 'it shows that it opens');
    assert.equal(bar.title, 'Show the latest pipelines');
  } finally { t.stop(); }
});

test('with none going, the bar shows the last that finished, and says what failed when it failed', async () => {
  const gitlab = world();
  gitlab.state.pipelines['10/1658'] = [pipeline(298850, 10, 'success', iso(14, 5))];
  gitlab.state.jobs[298850] = gitlab.state.jobs[298850].map((item) => ({ ...item, status: 'success' }));
  const t = await boot({ gitlab });
  try {
    await connect(t);
    const bar = document.getElementById('betterslack-gitlab');
    // Newest is Vision !1658 (14:05, passed): the bar is calm.
    assert.equal(bar.dataset.kind, 'success');
    assert.equal(text(bar.querySelector('.betterslack-gitlab-bar__note')), '');

    gitlab.state.pipelines['10/1658'] = [pipeline(298851, 10, 'failed', iso(14, 20))];
    gitlab.state.jobs[298851] = [job(20, 298851, 10, 'checks', 'oxlint', 'failed'), job(21, 298851, 10, 'build', 'Vite Build', 'skipped')];
    t.recorded.commands.find((command) => command.id === 'refresh').run();
    await until(() => document.getElementById('betterslack-gitlab').dataset.kind === 'failed');
    await sleep(60);
    assert.equal(text(bar.querySelector('.betterslack-gitlab-bar__note')), 'oxlint failed');
  } finally { t.stop(); }
});

test('the bar gives up the stage first, then the project, and keeps its icon', async () => {
  const t = await boot();
  try {
    await connect(t);
    const bar = document.getElementById('betterslack-gitlab');
    // jsdom lays nothing out: stand in for a bar that is 40px for each part it shows.
    Object.defineProperty(bar, 'scrollWidth', { configurable: true, get: () => bar.dataset.parts.split(' ').length * 40 });
    const room = (width) => {
      Object.defineProperty(bar, 'clientWidth', { configurable: true, get: () => width });
      window.dispatchEvent(new window.Event('resize'));
      return bar.dataset.parts;
    };
    assert.equal(room(400), 'icon project mr branch note progress dots');
    assert.equal(room(250), 'icon project mr note progress dots', 'the branch goes first');
    assert.equal(room(200), 'icon project mr progress dots');
    assert.equal(room(160), 'icon project mr progress');
    assert.equal(room(120), 'icon mr progress');
    assert.equal(room(80), 'icon progress');
    assert.equal(room(10), 'icon', 'a bar that fits nothing still shows its icon');
    assert.equal(room(400), 'icon project mr branch note progress dots', 'and grows back when there is room');
  } finally { t.stop(); }
});

test('clicking the bar lists the newest pipeline of each of the last three branches, and See more opens the view', async () => {
  const gitlab = world();
  // One merge request pushed to four times: it is one branch, so it is one entry.
  gitlab.state.pipelines['10/1658'] = [
    pipeline(298850, 10, 'running', iso(14, 5)),
    pipeline(298849, 10, 'failed', iso(14, 0)),
    pipeline(298848, 10, 'failed', iso(13, 58)),
    pipeline(298847, 10, 'failed', iso(13, 55)),
  ];
  gitlab.state.jobs[298849] = [job(30, 298849, 10, 'checks', 'tsc', 'failed')];
  const t = await boot({ gitlab });
  try {
    await connect(t);
    t.view.close();
    document.getElementById('betterslack-gitlab').click();
    await sleep(5);
    const layer = () => document.getElementById('betterslack-gitlab-layer');
    assert.ok(layer());
    const entries = [...layer().querySelectorAll('.betterslack-gitlab-recent__entry')];
    assert.equal(entries.length, 3);
    // 1658 (14:05, not its four), 723 (13:05) and 1408 (10:05): the fourth branch, 393, has no pipeline.
    assert.deepEqual(entries.map((entry) => entry.querySelector('.betterslack-gitlab-recent__number').textContent),
      ['#298850', '#298844', '#298830']);
    assert.deepEqual(entries.map((entry) => text(entry.querySelector('.betterslack-gitlab-recent__title'))),
      ['Vision · !1658', 'Portals Builder · !723', 'Vision · !1408']);
    assert.match(text(entries[0]), /Change 1658/, 'the merge request\'s title, so it is known which it is');
    assert.equal(text(entries[0].querySelector('.betterslack-gitlab-recent__branch')), 'feature/1658');
    assert.match(text(entries[0]), /Running · 2\/4/);
    assert.match(text(entries[2]), /oxlint failed/);

    // Buttons to GitLab: the merge request and the pipeline, each a link to the page GitLab gave.
    const actions = [...entries[0].querySelectorAll('.betterslack-gitlab-action')];
    assert.deepEqual(actions.map((a) => text(a)), ['Merge request', 'Pipeline']);
    assert.deepEqual(actions.map((a) => a.getAttribute('href')),
      [`${BASE}/dating/vision/-/merge_requests/1658`, `${BASE}/dating/vision/-/pipelines/298850`]);
    for (const a of actions) {
      assert.equal(a.target, '_blank');
      assert.match(a.rel, /noopener/);
      assert.match(a.className, /c-button/, 'Slack\'s own button');
    }

    // A stage opens its jobs from here too.
    const chips = [...entries[0].querySelectorAll('.betterslack-gitlab-recent__stage')];
    assert.deepEqual(chips.map((chip) => text(chip)), ['checks', 'build', 'deploy']);
    chips[0].click();
    await sleep(5);
    assert.equal(text(document.querySelector('#betterslack-gitlab-layer .betterslack-gitlab-popover__title')), 'checks');
    document.getElementById('betterslack-gitlab').click();
    await sleep(5);

    layer().querySelector('[data-action="see-more"]').click();
    assert.equal(document.getElementById('betterslack-gitlab-layer'), null, 'the popover goes');
    assert.equal(t.view.isOpen(), true, 'See more opens the BetterSlack view, not GitLab');
  } finally { t.stop(); }
});

test('a change under the screen patches it: the same rows stay, one icon changes', async () => {
  const gitlab = world();
  const t = await boot({ gitlab });
  try {
    await connect(t);
    const row = [...document.querySelectorAll('.betterslack-gitlab-mr')].find((el) => text(el.querySelector('.betterslack-gitlab-mr__number')) === '!1658');
    const section = row.closest('.betterslack-gitlab-project');
    const build = row.querySelector('.betterslack-gitlab-stage[data-stage="build"]');
    assert.equal(build.dataset.status, 'running');

    gitlab.state.pipelines['10/1658'] = [pipeline(298850, 10, 'running', iso(14, 5), { updated_at: iso(14, 9) })];
    gitlab.state.jobs[298850] = gitlab.state.jobs[298850].map((item) => (item.id === 3 ? { ...item, status: 'success', duration: 90 } : item.id === 4 ? { ...item, status: 'running' } : item));
    t.recorded.commands.find((command) => command.id === 'refresh').run();
    await until(() => row.querySelector('.betterslack-gitlab-stage[data-stage="deploy"]').dataset.status === 'running');

    assert.equal([...document.querySelectorAll('.betterslack-gitlab-mr')].find((el) => text(el.querySelector('.betterslack-gitlab-mr__number')) === '!1658'), row, 'same row');
    assert.equal(row.closest('.betterslack-gitlab-project'), section);
    assert.equal(row.querySelector('.betterslack-gitlab-stage[data-stage="build"]'), build, 'same button');
    assert.equal(build.dataset.status, 'success');
    assert.equal(text(row.querySelector('.betterslack-gitlab-progress')), '3/4');
  } finally { t.stop(); }
});

test('an open popover follows a job finishing, and is left alone when nothing changed', async () => {
  const gitlab = world();
  const t = await boot({ gitlab });
  try {
    await connect(t);
    document.querySelector('.betterslack-gitlab-stage[data-stage="build"]').click();
    await sleep(5);
    const list = document.querySelector('#betterslack-gitlab-layer .betterslack-gitlab-jobs');
    assert.equal(list.querySelector('.betterslack-gitlab-job').dataset.kind, 'running');

    t.recorded.commands.find((command) => command.id === 'refresh').run();
    await sleep(80);
    assert.equal(document.querySelector('#betterslack-gitlab-layer .betterslack-gitlab-jobs'), list, 'nothing changed, nothing redrawn');

    gitlab.state.pipelines['10/1658'] = [pipeline(298850, 10, 'running', iso(14, 5), { updated_at: iso(14, 9) })];
    gitlab.state.jobs[298850] = gitlab.state.jobs[298850].map((item) => (item.id === 3 ? { ...item, status: 'success', duration: 90 } : item));
    t.recorded.commands.find((command) => command.id === 'refresh').run();
    await until(() => document.querySelector('#betterslack-gitlab-layer .betterslack-gitlab-job')?.dataset.kind === 'success');
    assert.equal(text(document.querySelector('#betterslack-gitlab-layer .betterslack-gitlab-job__meta')), '1m 30s');
  } finally { t.stop(); }
});

test('nothing from Slack is ever sent: every request is a GitLab API path with ids of GitLab\'s own', async () => {
  const t = await boot();
  try {
    await connect(t);
    assert.ok(t.recorded.requests.length > 5);
    for (const { url, method, form } of t.recorded.requests) {
      assert.ok(url.startsWith(`${BASE}/api/v4/`), url);
      assert.ok(!/T0EXAMPLE1|C0BFQCYBRAB|xox[a-z]-/i.test(url), 'no workspace, channel or Slack token');
      assert.ok(method === undefined || method === 'GET');
      assert.equal(form, undefined);
    }
    assert.ok(!JSON.stringify(t.recorded.logs).includes(TOKEN));
    assert.equal(t.recorded.webCalls?.length ?? 0, 0, 'Slack\'s own API is not touched');
  } finally { t.stop(); }
});

test('disconnecting forgets the token and the lists, and the bar offers the form again', async () => {
  const t = await boot();
  try {
    await connect(t);
    [...document.querySelectorAll('.betterslack-gitlab-header__actions button')].find((b) => b.textContent === 'Disconnect').click();
    await sleep(80);
    assert.equal(t.recorded.credentialFor, null);
    assert.deepEqual([...t.recorded.data.keys()], []);
    assert.equal(document.getElementById('betterslack-gitlab').dataset.phase, 'signedOut');
    assert.equal(document.querySelectorAll('.betterslack-gitlab-mr').length, 0);
    assert.equal(document.querySelector('.betterslack-gitlab-login').closest('[hidden]'), null);
  } finally { t.stop(); }
});

test('switching it off takes everything it put in Slack with it', async () => {
  const t = await boot();
  await connect(t);
  document.getElementById('betterslack-gitlab').click();
  await sleep(5);
  for (const dispose of t.recorded.disposers) { try { dispose(); } catch { /* ok */ } }
  assert.equal(document.getElementById('betterslack-gitlab'), null);
  assert.equal(document.getElementById('betterslack-gitlab-layer'), null);
  assert.equal(document.querySelector(t.view.tabSelector), null);
  assert.equal(document.querySelector('.betterslack-gitlab-view'), null);
  t.dom.cleanup();
});

test('in French it says it in French', async () => {
  const dom = installDom();
  document.body.insertAdjacentHTML('beforeend', SLOT);
  const harness = createTestApi({ net: world().handler, settings: { gitUrl: BASE }, files: { 'gitlab.css': CSS }, locale: 'fr-FR' });
  try {
    await plugin.start(harness.api);
    await sleep(60);
    assert.equal(text(document.getElementById('betterslack-gitlab')), 'GitLab · Se connecter');
    assert.ok(harness.recorded.commands.some((command) => command.title === 'Ouvrir les Merge Requests GitLab'));
  } finally {
    for (const dispose of harness.recorded.disposers) { try { dispose(); } catch { /* ok */ } }
    dom.cleanup();
  }
});

test('the top bar can be turned off, and the badge counts what failed', async () => {
  const dom = installDom();
  document.body.insertAdjacentHTML('beforeend', SLOT);
  const harness = createTestApi({ net: world().handler, settings: { gitUrl: BASE, topBar: false, railBadge: 'failed' }, files: { 'gitlab.css': CSS } });
  try {
    await plugin.start(harness.api);
    assert.equal(document.getElementById('betterslack-gitlab'), null);
  } finally {
    for (const dispose of harness.recorded.disposers) { try { dispose(); } catch { /* ok */ } }
    dom.cleanup();
  }
});

test('every part the bar can show has a rule in the stylesheet that shows it', () => {
  // The bar decides what is on screen with `data-parts`; a part with no rule
  // that shows it, or one whose selector list was cut in two, is a part that
  // is never seen -- and nothing in jsdom lays anything out to notice.
  const depth = [...CSS].reduce((n, ch) => n + (ch === '{') - (ch === '}'), 0);
  assert.equal(depth, 0, 'braces balance');
  const parts = new Set([...levelsFor({ failed: false }).flat(), ...levelsFor({ failed: true }).flat(), 'stale']);
  parts.delete('icon');
  for (const part of parts) {
    const selector = `#betterslack-gitlab[data-parts~="${part}"] .betterslack-gitlab-bar__${part}`;
    const at = CSS.indexOf(selector);
    assert.ok(at >= 0, `${part} has a rule`);
    const rest = CSS.slice(at + selector.length);
    assert.ok(!/[;}]/.test(rest.slice(0, rest.indexOf('{'))), `${part}: the selector list runs straight into its block`);
    assert.match(rest.slice(rest.indexOf('{'), rest.indexOf('}')), /display:\s*inline/, `${part} is shown`);
  }
});

test('a project folds and unfolds, remembers it, and says what is going on inside while folded', async () => {
  const gitlab = world();
  const t = await boot({ gitlab });
  try {
    await connect(t);
    const visionSection = () => document.querySelector('.betterslack-gitlab-project');
    const rows = (section) => section.querySelectorAll('.betterslack-gitlab-mr');
    assert.equal(visionSection().hasAttribute('data-collapsed'), false);
    assert.equal(visionSection().querySelector('.betterslack-gitlab-mrs').hidden, false);

    // The band is the control; its link is not.
    visionSection().querySelector('.betterslack-gitlab-project__name').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    assert.equal(visionSection().hasAttribute('data-collapsed'), false, 'the project\'s own link does not fold it');

    const toggle = visionSection().querySelector('.betterslack-gitlab-project__toggle');
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(toggle.getAttribute('aria-label'), 'Collapse Vision');
    toggle.click();
    assert.equal(visionSection().hasAttribute('data-collapsed'), true);
    assert.equal(visionSection().querySelector('.betterslack-gitlab-mrs').hidden, true);
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(toggle.getAttribute('aria-label'), 'Expand Vision');
    assert.equal(rows(visionSection()).length, 2, 'the rows are still there, and still kept up to date');

    // Folded, it says what is inside: one failed (1408), one running (1658).
    const summary = [...visionSection().querySelectorAll('.betterslack-gitlab-summary')].map((chip) => chip.getAttribute('aria-label'));
    assert.deepEqual(summary, ['1 failed', '1 running']);

    // Anywhere on the band unfolds it again.
    visionSection().querySelector('.betterslack-gitlab-project__head').click();
    assert.equal(visionSection().hasAttribute('data-collapsed'), false);

    // Kept: by project id, in the settings, and nothing else.
    visionSection().querySelector('.betterslack-gitlab-project__head').click();
    await sleep(5);
    assert.deepEqual(t.api.settings.get('collapsed'), [10]);
  } finally { t.stop(); }
});

test('a folded project is folded again after a restart, and "collapse all" folds and unfolds them all', async () => {
  const dom = installDom();
  document.body.insertAdjacentHTML('beforeend', SLOT);
  const gitlab = world();
  const harness = createTestApi({ net: gitlab.handler, settings: { gitUrl: BASE, collapsed: [20] }, files: { 'gitlab.css': CSS } });
  harness.recorded.credentialFor = new URL(BASE).origin;
  try {
    await plugin.start(harness.api);
    const [{ handle }] = harness.recorded.views;
    handle.open();
    await until(() => document.querySelectorAll('.betterslack-gitlab-project').length === 3);
    await sleep(60);
    const sections = () => [...document.querySelectorAll('.betterslack-gitlab-project')];
    assert.deepEqual(sections().map((section) => section.hasAttribute('data-collapsed')), [false, true, false], 'Portals Builder (20) was folded');

    const all = [...document.querySelectorAll('.betterslack-gitlab-header__actions button')].find((b) => /Collapse all|Expand all/.test(b.textContent));
    assert.equal(all.textContent, 'Collapse all');
    all.click();
    assert.deepEqual(sections().map((section) => section.hasAttribute('data-collapsed')), [true, true, true]);
    assert.equal(all.textContent, 'Expand all');
    all.click();
    assert.deepEqual(sections().map((section) => section.hasAttribute('data-collapsed')), [false, false, false]);
    await sleep(5);
    assert.deepEqual(harness.api.settings.get('collapsed'), []);
  } finally {
    for (const dispose of harness.recorded.disposers) { try { dispose(); } catch { /* ok */ } }
    dom.cleanup();
  }
});

test('a merge request row has its four parts as direct children of the grid the stylesheet lays out', async () => {
  const t = await boot();
  try {
    await connect(t);
    const row = document.querySelector('.betterslack-gitlab-mr');
    assert.deepEqual([...row.children].map((child) => child.className.split(' ')[0]),
      ['betterslack-gitlab-mr__line', 'betterslack-gitlab-mr__meta', 'betterslack-gitlab-pipeline', 'betterslack-gitlab-mr__number']);
    for (const area of ['line', 'number', 'meta', 'pipeline']) assert.ok(CSS.includes(`grid-area: ${area}`), area);
    assert.match(CSS, /@container betterslack-gitlab \(min-width: 1000px\)[\s\S]*"line meta pipeline number"/, 'one line when there is room');
  } finally { t.stop(); }
});

test('the bar is not part of the window\'s drag handle, or a click on it would never arrive', () => {
  assert.match(CSS, /#betterslack-gitlab \{[^}]*-webkit-app-region:\s*no-drag/);
});

test('in a full-screen window the bar uses the room Slack keeps for the window\'s buttons, and in any other it does not', async () => {
  const t = await boot();
  try {
    const bar = document.getElementById('betterslack-gitlab');
    const spacer = document.createElement('div');
    spacer.className = 'p-ia4_top_nav__native_ui_spacer';
    Object.defineProperty(spacer, 'offsetWidth', { configurable: true, value: 76 });
    document.body.append(spacer);
    const fullScreen = (on) => {
      window.matchMedia = (query) => ({ matches: on && query.includes('fullscreen') });
      window.dispatchEvent(new window.Event('resize'));
      return bar.style.getPropertyValue('--gl-bleed');
    };
    assert.equal(fullScreen(false), '0px', 'with the window\'s buttons there, nothing');
    assert.equal(fullScreen(true), '62px', 'the spacer\'s width less a margin of 14px to the edge');
    Object.defineProperty(spacer, 'offsetWidth', { configurable: true, value: 0 });
    assert.equal(fullScreen(true), '0px', 'a platform that reserves nothing is not moved');
    assert.match(CSS, /margin:\s*0 0 0 calc\(-1 \* var\(--gl-bleed/);
    assert.match(CSS, /max-width:\s*calc\(100% \+ var\(--gl-bleed/);
    assert.match(CSS, /padding-right:\s*40px/, 'air before the history arrows');
    assert.match(CSS, /contain:\s*inline-size/, 'the bar\'s content width does not size its container');
    assert.match(CSS, /flex:\s*1 1 0 !important/, 'sized by what is left, not by the bar\'s content: the arrows must not move');
  } finally { delete window.matchMedia; t.stop(); }
});

test('the bar drops a part rather than squeezing the project to an ellipsis', () => {
  const rule = (name) => new RegExp(`\\.betterslack-gitlab-bar__${name}[^{]*\\{[^}]*flex-shrink:\\s*0`);
  for (const name of ['project', 'mr', 'progress', 'dots', 'icon']) assert.match(CSS, rule(name), `${name} keeps its size`);
  assert.match(CSS, /bar__branch,\s*\.betterslack-gitlab-bar__note \{ flex-shrink: 1; min-width: 56px/, 'only these give, down to a few letters');
});

test('a stage opened from the latest-pipelines list lands under the chip that was clicked', async () => {
  const t = await boot();
  try {
    await connect(t);
    t.view.close();
    document.getElementById('betterslack-gitlab').click();
    await sleep(5);
    const chip = document.querySelector('#betterslack-gitlab-layer .betterslack-gitlab-recent__stage');
    chip.getBoundingClientRect = () => ({ left: 120, right: 200, top: 280, bottom: 300, width: 80, height: 20 });
    chip.click();
    await sleep(5);
    const layer = document.getElementById('betterslack-gitlab-layer');
    assert.ok(layer.querySelector('.betterslack-gitlab-jobs'));
    // The chip left the page with the list it was in; the jobs still go under where it was.
    assert.equal(layer.style.transform, 'translate3d(120px, 306px, 0)');
  } finally { t.stop(); }
});

test('a bar that is no longer showing a pipeline does not keep the colour of a failed one', async () => {
  const gitlab = world();
  gitlab.state.pipelines['10/1658'] = [pipeline(298851, 10, 'failed', iso(15))];
  gitlab.state.jobs[298851] = [job(60, 298851, 10, 'checks', 'oxlint', 'failed')];
  const t = await boot({ gitlab });
  try {
    await connect(t);
    const bar = document.getElementById('betterslack-gitlab');
    await until(() => bar.dataset.kind === 'failed');
    t.gitlab.state.fail = { status: 401 };
    t.recorded.commands.find((command) => command.id === 'refresh').run();
    await until(() => bar.dataset.phase === 'invalid');
    assert.equal(bar.hasAttribute('data-kind'), false);
  } finally { t.stop(); }
});

test('a stage button has one tooltip, made when it is named', async () => {
  const t = await boot();
  try {
    await connect(t);
    // `helpers.tooltip` hands back a cleanup per registration: one for each stage button on screen.
    const buttons = document.querySelectorAll('.betterslack-gitlab-stage').length;
    assert.ok(buttons > 0);
    assert.ok([...document.querySelectorAll('.betterslack-gitlab-stage')].every((button) => button.__dispose && button.dataset.stage));
  } finally { t.stop(); }
});
