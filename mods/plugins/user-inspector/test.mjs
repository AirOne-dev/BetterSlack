import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPluginShape, createTestApi, installDom } from '../../../tests/harness.mjs';
import plugin from './index.js';

const USER = {
  id: 'U018V4TL14N',
  name: 'jean',
  real_name: 'Jean Picard',
  is_admin: true,
  is_bot: false,
  tz: 'Europe/Paris',
  tz_offset: 3600,
  updated: 1700000000,
  profile: {
    display_name: 'jean',
    title: 'Capitaine',
    status_text: 'Engage',
    fields: { Xf01: { value: 'Deck 1' } },
    image_512: 'https://ca.slack-edge.com/T1-U1-h-512.png',
    image_original: 'https://ca.slack-edge.com/T1-U1-h-original.png',
  },
};

async function open(overrides = {}) {
  const dom = installDom();
  const { api, recorded } = createTestApi({
    web: { userInfo: async () => USER, ...overrides },
  });
  await plugin.start(api);
  await recorded.profileButtons[0].onClick({ userId: USER.id });
  return { dom, recorded };
}

test('exports a plugin', () => {
  assertPluginShape(assert, plugin);
});

test('adds a Details button to the profile pane', async () => {
  const dom = installDom();
  try {
    const { api, recorded } = createTestApi();
    await plugin.start(api);
    assert.equal(recorded.profileButtons.length, 1);
    assert.equal(recorded.profileButtons[0].id, 'details');
  } finally {
    dom.cleanup();
  }
});

test('renders identity, roles, profile and custom fields', async () => {
  const { dom, recorded } = await open();
  try {
    const text = recorded.modals[0].body.textContent;
    assert.match(text, /U018V4TL14N/, 'user id');
    assert.match(text, /Jean Picard/, 'real name');
    assert.match(text, /Europe\/Paris/, 'timezone');
    assert.match(text, /Capitaine/, 'title');
    assert.match(text, /Deck 1/, 'custom field value');
    assert.match(text, /is_admin/, 'role flags');
  } finally {
    dom.cleanup();
  }
});

test('renders booleans readably rather than as true/false', async () => {
  const { dom, recorded } = await open();
  try {
    const rows = [...recorded.modals[0].body.querySelectorAll('.sm-insp-grid dt')];
    const admin = rows.find((dt) => dt.textContent === 'is_admin');
    assert.equal(admin.nextElementSibling.textContent, 'yes');
  } finally {
    dom.cleanup();
  }
});

test('turns Slack timestamps into dates', async () => {
  const { dom, recorded } = await open();
  try {
    const rows = [...recorded.modals[0].body.querySelectorAll('.sm-insp-grid dt')];
    const updated = rows.find((dt) => dt.textContent === 'updated');
    assert.match(updated.nextElementSibling.textContent, /\(1700000000\)$/);
    assert.notEqual(updated.nextElementSibling.textContent, '1700000000');
  } finally {
    dom.cleanup();
  }
});

test('lists every avatar size, original first', async () => {
  const { dom, recorded } = await open();
  try {
    const links = [...recorded.modals[0].body.querySelectorAll('.sm-insp-images a')];
    assert.deepEqual(links.map((a) => a.textContent), ['original', '512']);
  } finally {
    dom.cleanup();
  }
});

test('includes the raw response for anything the summary misses', async () => {
  const { dom, recorded } = await open();
  try {
    const raw = recorded.modals[0].body.querySelector('.sm-insp-raw');
    assert.ok(raw, 'raw response present');
    assert.match(raw.value, /"real_name": "Jean Picard"/);
  } finally {
    dom.cleanup();
  }
});

test('still renders when presence and dnd are unavailable', async () => {
  const { dom, recorded } = await open({
    presence: async () => { throw new Error('bots have no presence'); },
    dndInfo: async () => { throw new Error('not permitted'); },
  });
  try {
    assert.match(recorded.modals[0].body.textContent, /Jean Picard/);
  } finally {
    dom.cleanup();
  }
});

test('reports an API refusal instead of showing an empty dialog', async () => {
  const { dom, recorded } = await open({
    userInfo: async () => { throw new Error('user_not_found'); },
  });
  try {
    assert.match(recorded.modals[0].body.textContent, /user_not_found/);
  } finally {
    dom.cleanup();
  }
});

test('never reads localStorage itself', async () => {
  // The token must only ever be touched by the audited wrapper in
  // src/runtime/web-api.ts, so mods stay reviewable at a glance.
  const { readFileSync } = await import('node:fs');
  const raw = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
  // Comments are stripped first: documenting the rule must not trip it.
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert.doesNotMatch(source, /localStorage/);
  assert.doesNotMatch(source, /document\.cookie/);
  assert.doesNotMatch(source, /xoxc/);
});
