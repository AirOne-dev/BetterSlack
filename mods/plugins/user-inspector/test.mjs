import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPluginShape, createTestApi, installDom } from '../../../tests/harness.mjs';
import plugin, { avatarSizes, buildRows, rolesOf } from './index.js';

const USER = {
  id: 'U018V4TL14N',
  name: 'jean',
  real_name: 'Jean Picard',
  is_admin: true,
  is_owner: false,
  is_bot: false,
  tz: 'Europe/Paris',
  tz_label: 'Central European Time',
  tz_offset: 3600,
  locale: 'fr-FR',
  updated: 1700000000,
  profile: {
    display_name: 'jean',
    title: 'Capitaine',
    phone: '+33 1 23 45 67 89',
    status_text: 'Engage',
    status_emoji: ':rocket:',
    fields: { Xf01: { label: 'Deck', value: 'Deck 1' } },
    image_512: 'https://ca.slack-edge.com/T1-U1-h-512.png',
    image_original: 'https://ca.slack-edge.com/T1-U1-h-original.png',
  },
};

const DATA = { user: USER, presence: { presence: 'active' }, dnd: { dnd_enabled: false } };

/** Mount the plugin and let the async profile load settle. */
async function mount(web = {}) {
  const dom = installDom();
  const harness = createTestApi({
    web: { userInfo: async () => USER, presence: async () => DATA.presence, dndInfo: async () => DATA.dnd, ...web },
  });
  await plugin.start(harness.api);
  await new Promise((r) => setTimeout(r, 20));
  return { dom, ...harness };
}

const host = () => document.getElementById('slackmod-user-details');

test('exports a plugin', () => {
  assertPluginShape(assert, plugin);
});

test('lists only the roles a user actually has', () => {
  assert.deepEqual(rolesOf(USER), ['Admin']);
  assert.deepEqual(rolesOf({ is_primary_owner: true, is_owner: true, is_admin: true }),
    ['Primary owner', 'Owner', 'Admin']);
  assert.deepEqual(rolesOf({}), []);
});

test('builds rows from the API response', () => {
  const rows = Object.fromEntries(buildRows(DATA));
  assert.equal(rows['User ID'], 'U018V4TL14N');
  assert.equal(rows.Username, 'jean');
  assert.equal(rows.Title, 'Capitaine');
  assert.equal(rows.Roles, 'Admin');
  assert.equal(rows.Presence, 'Active');
  assert.equal(rows.Status, ':rocket: Engage');
  assert.equal(rows.Deck, 'Deck 1', 'workspace custom fields use their label');
  assert.match(rows['Time zone'], /Central European Time/);
  assert.match(rows['Profile updated'], /\d/);
});

test('leaves out fields the user has not filled in', () => {
  const rows = Object.fromEntries(buildRows({ user: { id: 'U1', profile: {} } }));
  assert.equal(rows.Title, undefined);
  assert.equal(rows.Phone, undefined);
  assert.equal(rows['User ID'], 'U1');
});

test('reports do-not-disturb only while it is on', () => {
  assert.equal(Object.fromEntries(buildRows({ user: USER, dnd: { dnd_enabled: false } }))['Do not disturb'], undefined);
  const on = Object.fromEntries(buildRows({ user: USER, dnd: { dnd_enabled: true, next_dnd_end_ts: 1700000000 } }));
  assert.match(on['Do not disturb'], /^On until /);
});

test('orders avatar sizes with the original first', () => {
  assert.deepEqual(avatarSizes(USER.profile).map((s) => s.label), ['original', '512px']);
  assert.deepEqual(avatarSizes({}), []);
});

test('renders into the profile pane, not into a dialog', async () => {
  const { dom, recorded } = await mount();
  try {
    assert.equal(recorded.modals.length, 0, 'must not open a modal');
    assert.ok(host(), 'section host is mounted in the pane');
    assert.ok(host().closest('[data-qa="member_profile_pane"]'), 'inside the profile pane');
  } finally {
    dom.cleanup();
  }
});

test('uses Slack’s own section markup so it looks native', async () => {
  const { dom } = await mount();
  try {
    const headers = [...host().querySelectorAll('.p-r_member_profile_section_header')]
      .map((h) => h.textContent);
    assert.deepEqual(headers, ['More details', 'Avatar', 'Raw data']);
    assert.ok(host().querySelector('.p-rimeto_member_profile_field__label'), 'field labels');
    assert.ok(host().querySelector('.p-rimeto_member_profile_field__value'), 'field values');
  } finally {
    dom.cleanup();
  }
});

test('shows the data once it arrives', async () => {
  const { dom } = await mount();
  try {
    const text = host().textContent;
    assert.match(text, /U018V4TL14N/);
    assert.match(text, /Capitaine/);
    assert.match(text, /Deck 1/);
    assert.match(text, /Admin/);
    assert.match(text, /Central European Time/);
  } finally {
    dom.cleanup();
  }
});

test('copies the full response on request', async () => {
  const { dom } = await mount();
  try {
    const copy = [...host().querySelectorAll('button')].find((b) => /Copy raw JSON/.test(b.textContent));
    assert.ok(copy, 'copy button present');
    copy.click();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(dom.recorded.clipboard.length, 1);
    assert.match(dom.recorded.clipboard[0], /"real_name": "Jean Picard"/);
  } finally {
    dom.cleanup();
  }
});

test('still renders when presence and dnd are unavailable', async () => {
  const { dom } = await mount({
    presence: async () => { throw new Error('bots have no presence'); },
    dndInfo: async () => { throw new Error('not permitted'); },
  });
  try {
    assert.match(host().textContent, /U018V4TL14N/);
  } finally {
    dom.cleanup();
  }
});

test('says so when Slack refuses the request', async () => {
  const { dom } = await mount({ userInfo: async () => { throw new Error('user_not_found'); } });
  try {
    assert.match(host().textContent, /user_not_found/);
  } finally {
    dom.cleanup();
  }
});

test('explains itself when there is no session token', async () => {
  const dom = installDom();
  try {
    const { api } = createTestApi({ web: { available: false } });
    await plugin.start(api);
    await new Promise((r) => setTimeout(r, 20));
    assert.match(host().textContent, /session token/i);
  } finally {
    dom.cleanup();
  }
});

test('never reads localStorage itself', async () => {
  // The token must only ever be touched by the audited wrapper in
  // src/runtime/web-api.ts, so mods stay reviewable at a glance.
  const { readFileSync } = await import('node:fs');
  const raw = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert.doesNotMatch(source, /localStorage/);
  assert.doesNotMatch(source, /document\.cookie/);
  assert.doesNotMatch(source, /xoxc/);
});
