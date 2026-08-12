import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { assertPluginShape, createTestApi, installDom } from '../../../tests/harness.mjs';
import plugin from './index.js';

const here = path.dirname(fileURLToPath(import.meta.url));

test('has the shape the runtime loads', () => assertPluginShape(assert, plugin));

/** A web stand-in that records what was asked of Slack. */
function web({ members = ['U1', 'U2'], presence = {}, users } = {}) {
  const calls = [];
  return {
    calls,
    web: {
      call: async (method, params) => {
        calls.push({ method, params });
        if (method === 'conversations.members') return { ok: true, members };
        if (method === 'users.info') {
          const ids = String(params.users).split(',');
          return { ok: true, users: ids.map((id) => users?.[id] ?? { id, profile: { display_name: id } }) };
        }
        return { ok: true };
      },
      presence: async (id) => ({ presence: presence[id] ?? 'away' }),
    },
  };
}

test('lists the channel members beside the message pane', async () => {
  const dom = installDom();
  const stub = web({
    users: {
      U1: { id: 'U1', profile: { display_name: 'Zoe' } },
      U2: { id: 'U2', profile: { display_name: 'Adam' } },
    },
  });
  const { api, recorded } = createTestApi({ web: stub.web });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const column = document.getElementById('slackmod-member-column');
    assert.ok(column, 'the column is mounted');
    assert.ok(
      recorded.mounted.some((m) => m.container === '.p-view_contents--primary'),
      'beside the message pane, so it becomes a second flex column',
    );

    const names = [...column.querySelectorAll('.slackmod-members__name')].map((n) => n.textContent);
    assert.deepEqual(names, ['Adam', 'Zoe'], 'sorted by display name');

    const asked = stub.calls.find((c) => c.method === 'conversations.members');
    assert.equal(asked.params.channel, 'C0BFQCYBRAB', 'the channel comes from the URL');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('asks about every member in one users.info call', async () => {
  const dom = installDom();
  const stub = web({ members: ['U1', 'U2', 'U3'] });
  const { api, recorded } = createTestApi({ web: stub.web });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const lookups = stub.calls.filter((c) => c.method === 'users.info');
    assert.equal(lookups.length, 1, 'one request, not one per member');
    assert.equal(lookups[0].params.users, 'U1,U2,U3');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('splits into online and offline once presence arrives', async () => {
  const dom = installDom();
  const stub = web({
    members: ['U1', 'U2'],
    presence: { U1: 'active', U2: 'away' },
    users: {
      U1: { id: 'U1', profile: { display_name: 'Zoe' } },
      U2: { id: 'U2', profile: { display_name: 'Adam' } },
    },
  });
  const { api, recorded } = createTestApi({ web: stub.web });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 40));

    const column = document.getElementById('slackmod-member-column');
    const headings = [...column.querySelectorAll('.slackmod-members__heading')].map((h) => h.textContent);
    assert.deepEqual(headings, ['Online — 1', 'Offline — 1']);

    // Online first, whatever the alphabet says.
    const names = [...column.querySelectorAll('.slackmod-members__name')].map((n) => n.textContent);
    assert.deepEqual(names, ['Zoe', 'Adam']);
    assert.ok(column.querySelector('.slackmod-members__dot--active'), 'the online dot is lit');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('does not claim everyone is offline before presence has answered', async () => {
  const dom = installDom();
  const stub = web({ members: ['U1'] });
  // A presence call that never settles, i.e. the first moments of every render.
  stub.web.presence = () => new Promise(() => {});
  const { api, recorded } = createTestApi({ web: stub.web });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const headings = [...document.querySelectorAll('.slackmod-members__heading')].map((h) => h.textContent);
    assert.deepEqual(headings, ['Members — 1'], 'one neutral group until it knows');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('clicking a member opens Slack’s own profile, matched on the user id', async () => {
  const dom = installDom();
  const stub = web({ members: ['U1'] });
  const { api, recorded } = createTestApi({ web: stub.web });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Slack opens its channel-details modal when the avatar stack is pressed.
    let profileOpened = null;
    document.querySelector('[data-qa="avatar_stack"]').addEventListener('click', () => {
      const modal = document.createElement('div');
      modal.setAttribute('data-qa', 'channel_details_modal');
      // Two people whose names are identical: only the id tells them apart.
      for (const id of ['U9', 'U1']) {
        const row = document.createElement('button');
        row.setAttribute('data-qa', 'unstyled-button');
        row.innerHTML = `<img src="https://ca.slack-edge.com/T025V5WN2-${id}-abc-48">`;
        row.addEventListener('click', () => { profileOpened = id; });
        modal.append(row);
      }
      document.body.append(modal);
    });

    document.querySelector('.slackmod-members__row').click();
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(profileOpened, 'U1');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('uses the Slack-styled tooltip, never a native title', async () => {
  const dom = installDom();
  const stub = web({ members: ['U1'] });
  const { api, recorded } = createTestApi({ web: stub.web });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const row = document.querySelector('.slackmod-members__row');
    assert.equal(row.getAttribute('title'), null, 'a native title would show as well, and later');
    assert.ok(row.getAttribute('aria-label'), 'the helper labels it for screen readers instead');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('says so rather than half-working without a session token', async () => {
  const dom = installDom();
  const { api, recorded } = createTestApi({ web: { available: false } });
  try {
    await plugin.start(api);
    assert.equal(document.getElementById('slackmod-member-column'), null);
    assert.ok(recorded.logs.some(([level]) => level === 'warn'));
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('the source keeps its own token discipline', () => {
  const source = readFileSync(path.join(here, 'index.js'), 'utf8');
  assert.doesNotMatch(source, /\blocalStorage\b/, 'the token is read only in web-api.ts');
  assert.doesNotMatch(source, /\bfetch\s*\(/, 'network access goes through api.slack.web');
});
