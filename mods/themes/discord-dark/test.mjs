import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { themeChecks } from '../../../tests/theme.mjs';
import { createLayoutTestApi, installDom } from '../../../tests/harness.mjs';

const { css } = themeChecks(test, assert, import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(here, 'mod.json'), 'utf8'));

test('maps all three Slack token families', () => {
  assert.match(css, /--dt_color-base-pry/, 'content family');
  assert.match(css, /--dt_color-theme-surf-inv-sec/, 'chrome family');
  assert.match(css, /--sk_primary_background/, 'legacy family');
});

test('uses Discord type stack', () => {
  assert.match(css, /"gg sans"/);
  assert.match(css, /Noto Sans/);
});

test('repaints Slack full-viewport backdrop layer', () => {
  assert.match(css, /\.p-theme_background/);
});

test('gives the rail Discord behaviour without labels', () => {
  assert.match(css, /\.p-tab_rail__button__label\s*\{[^}]*display:\s*none/);
  assert.match(css, /\.p-tab_rail__button--active::before/, 'the active pill');
});

test('declares exactly the permissions its script needs', () => {
  assert.equal(manifest.script, 'layout.js');
  assert.deepEqual(manifest.permissions, ['layout', 'workspace']);
});

/**
 * The rule the whole permission system rests on: what the consent dialog names
 * is what the script can reach. A script using something undeclared would be
 * asking for trust it never obtained.
 */
test('the script touches nothing it did not declare', async () => {
  const source = readFileSync(path.join(here, 'layout.js'), 'utf8');
  assert.doesNotMatch(source, /\blocalStorage\b/, 'must go through api.workspace, never the token');
  assert.doesNotMatch(source, /\bfetch\s*\(/, 'network access is api.workspace only');
  assert.doesNotMatch(source, /\beval\s*\(|new\s+Function\s*\(/, "Slack's CSP blocks both");
});

test('mounts the account strip and fills in the name it looked up', async () => {
  const dom = installDom();
  const { api, recorded } = createLayoutTestApi({ permissions: ['layout', 'workspace'] });
  try {
    const { start } = await import('./layout.js');
    await start(api);

    const strip = document.getElementById('dc-account-strip');
    assert.ok(strip, 'the strip is mounted into the sidebar');
    assert.ok(
      recorded.mounted.some((m) => m.container === '.p-channel_sidebar'),
      'and into the sidebar specifically, so it lands under the channel list',
    );

    // The lookup is a promise; let it settle before reading the name.
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(strip.querySelector('.dc-me__name').textContent, 'Tester');
    assert.equal(strip.querySelector('.dc-me__status').textContent, 'Active');

    // Clicking drives Slack's own button rather than reimplementing its menu.
    strip.querySelector('.dc-me').click();
    assert.deepEqual(recorded.clicked, ['[data-qa="user-button"]']);
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('renders the member column from the channel in the URL', async () => {
  const dom = installDom();
  const { api, recorded } = createLayoutTestApi({
    permissions: ['layout', 'workspace'],
    web: {
      call: async (method, params) => {
        assert.equal(method, 'conversations.members');
        assert.equal(params.channel, 'C0BFQCYBRAB', 'reads the channel from the URL');
        return { ok: true, members: ['U1', 'U2'] };
      },
      userInfo: async (id) => ({ id, profile: { display_name: id === 'U1' ? 'Zoe' : 'Adam' } }),
    },
  });
  try {
    const { start } = await import('./layout.js');
    await start(api);

    const column = document.getElementById('dc-member-column');
    assert.ok(column, 'the column is mounted beside the message pane');

    await new Promise((resolve) => setTimeout(resolve, 10));
    const names = [...column.querySelectorAll('.dc-members__name')].map((n) => n.textContent);
    assert.deepEqual(names, ['Adam', 'Zoe'], 'sorted by display name');
    assert.match(column.querySelector('.dc-members__heading').textContent, /Members — 2/);
  } finally {
    // Also the teardown check: the column polls the URL on a timer, and a mod
    // that leaks it would keep running after the theme is switched off.
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('degrades to colours alone when only layout was granted', async () => {
  const dom = installDom();
  const { api, recorded } = createLayoutTestApi({ permissions: ['layout'] });
  try {
    const { start } = await import('./layout.js');
    await start(api);

    assert.ok(document.getElementById('dc-account-strip'), 'the strip still mounts');
    assert.equal(document.getElementById('dc-member-column'), null, 'the column does not');
    assert.ok(
      recorded.logs.some(([level, message]) => level === 'warn' && /workspace permission/.test(message)),
      'and says why rather than failing silently',
    );
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});
