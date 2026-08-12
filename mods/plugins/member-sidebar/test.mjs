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

test('clicking a member opens a profile dialog, filled in from Slack', async () => {
  const dom = installDom();
  const stub = web({ members: ['U1'] });
  stub.web.userInfo = async (id) => ({
    id,
    name: 'zoe',
    tz_label: 'Paris',
    profile: { display_name: 'Zoe', title: 'Engineer', email: 'zoe@acme.test', image_512: 'a.png' },
  });
  stub.web.presence = async () => ({ presence: 'active' });
  stub.web.dndInfo = async () => ({ dnd_enabled: false });
  const { api, recorded } = createTestApi({ web: stub.web });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));

    document.querySelector('.slackmod-members__row').click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(recorded.modals.length, 1, 'a dialog, not Slack’s pane');
    const body = recorded.modals[0].body;
    assert.match(body.textContent, /Zoe/);
    assert.match(body.textContent, /Engineer/);
    assert.match(body.textContent, /zoe@acme\.test/, 'the fields Slack’s own pane shows');
    assert.match(body.textContent, /Active/, 'presence is resolved, not guessed');
    assert.ok(body.querySelector('.slackmod-profile__dot--active'));
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

/**
 * The compatibility contract, and the reason it is a test rather than a note:
 * the dialog is only extensible because it looks like a profile pane to the
 * rest of the app. Rename either hook and User Inspector silently stops
 * appearing inside it, with nothing else failing.
 */
test('the dialog is a profile pane as far as other plugins are concerned', async () => {
  const dom = installDom();
  const stub = web({ members: ['U1'] });
  stub.web.userInfo = async (id) => ({ id, profile: { display_name: 'Zoe', image_512: 'a.png' } });
  const { api, recorded } = createTestApi({ web: stub.web });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));
    document.querySelector('.slackmod-members__row').click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const pane = recorded.modals[0].body.querySelector('[data-qa="member_profile_pane"]');
    assert.ok(pane, 'the hook every profile add-on in this repo watches');

    const avatar = pane.querySelector('.p-r_member_profile__avatar__img');
    assert.ok(avatar, 'and the avatar they read the user id from');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('User Inspector fills in the dialog without knowing it exists', async () => {
  // The shared fixture already contains one of Slack's own profile panes, which
  // is the interesting case: User Inspector must fill both, not whichever it
  // reached first.
  const dom = installDom();
  const stub = web({ members: ['U1'] });
  const user = {
    id: 'U041KF85GP5',
    name: 'zoe',
    profile: {
      display_name: 'Zoe',
      // The id User Inspector reads comes off this URL, so it has to be a real
      // Slack avatar URL rather than a placeholder.
      image_512: 'https://ca.slack-edge.com/T025V5WN2-U041KF85GP5-abc-512',
    },
  };
  stub.web.userInfo = async () => user;
  const { api, recorded } = createTestApi({ web: stub.web });
  try {
    const inspector = (await import('../user-inspector/index.js')).default;
    await plugin.start(api);
    // Both plugins on at once, exactly as the panel would have them.
    await inspector.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));

    document.querySelector('.slackmod-members__row').click();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const pane = recorded.modals[0].body.querySelector('[data-qa="member_profile_pane"]');
    assert.ok(
      pane.querySelector('.slackmod-user-details'),
      'User Inspector appended its sections into our dialog, with no code shared',
    );
    assert.equal(
      document.querySelectorAll('.slackmod-user-details').length, 2,
      'and into Slack’s own pane as well — one profile does not starve the other',
    );
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('Message opens the direct message directly, with no staged clicks', async () => {
  const dom = installDom();
  const stub = web({ members: ['U1'] });
  const { api, recorded } = createTestApi({ web: stub.web });
  let opened = null;
  api.slack.openDirectMessage = async (id) => { opened = id; return 'D1'; };
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));
    document.querySelector('.slackmod-members__row').click();
    await new Promise((resolve) => setTimeout(resolve, 30));

    const message = [...recorded.modals[0].body.querySelectorAll('.slackmod-profile__actions button')]
      .find((b) => b.textContent === 'Message');
    assert.ok(message, 'the dialog offers Message');
    message.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(opened, 'U1', 'one API call, not a walk through Slack’s UI');
    assert.equal(document.querySelector('[data-qa="avatar_stack"]').dataset.clicked, undefined);
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('the overflow opens our own menu and never Slack’s profile pane', async () => {
  const dom = installDom();
  const stub = web({ members: ['U1'] });
  const { api, recorded } = createTestApi({ web: stub.web });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));
    document.querySelector('.slackmod-members__row').click();
    await new Promise((resolve) => setTimeout(resolve, 30));

    const before = document.querySelectorAll('[data-qa="member_profile_pane"]').length;
    const more = recorded.modals[0].body.querySelector('.slackmod-profile__more');
    assert.ok(more.querySelector('svg'), 'the ellipsis glyph, like Slack’s');
    more.click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const menu = document.getElementById('slackmod-profile-menu');
    assert.ok(menu, 'our own menu');
    assert.ok(menu.querySelector('.c-menu__items'), 'in Slack’s menu markup, so it follows the theme');
    assert.ok(menu.querySelectorAll('.c-menu_item__button').length >= 5, 'with its entries');
    assert.equal(
      document.querySelectorAll('[data-qa="member_profile_pane"]').length, before,
      'and no profile pane was reopened',
    );
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('a member row carries no tooltip, only its label', async () => {
  const dom = installDom();
  const stub = web({ members: ['U1'] });
  const { api, recorded } = createTestApi({ web: stub.web });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const row = document.querySelector('.slackmod-members__row');
    // The row already shows the name; hovering only repeated it.
    assert.equal(row.getAttribute('title'), null, 'no native tooltip');
    assert.equal(document.querySelector('.c-tooltip__tip'), null, 'and none of ours either');
    assert.ok(row.getAttribute('aria-label'), 'the name is still announced');
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

test('undoes the layout that comes with Slack’s avatar class', () => {
  // The class is borrowed for compatibility, and Slack positions it absolutely
  // for its own pane — which parked it on top of the dialog title until this.
  const css = readFileSync(path.join(here, 'index.js'), 'utf8');
  const rule = css.match(/\.slackmod-profile \.slackmod-profile__avatar\s*\{[^}]*\}/);
  assert.ok(rule, 'the avatar needs its own reset');
  assert.match(rule[0], /position:\s*static\s*!important/);
});

test('never prints a raw emoji shortcode', async () => {
  const dom = installDom();
  const stub = web({ members: ['U1'] });
  stub.web.userInfo = async (id) => ({
    id,
    profile: { display_name: 'Zoe', status_emoji: ':tada:', status_text: 'On holiday' },
  });
  const { api, recorded } = createTestApi({ web: stub.web });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));
    document.querySelector('.slackmod-members__row').click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const text = recorded.modals[0].body.textContent;
    assert.match(text, /On holiday/);
    assert.doesNotMatch(text, /:tada:/, 'a custom shortcode has no unicode to fall back on');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('the copy actions need nothing from Slack', async () => {
  const dom = installDom();
  const stub = web({ members: ['U1'] });
  stub.web.userInfo = async (id) => ({ id, name: 'zoe.b', profile: { display_name: 'Zoe' } });
  stub.web.teamDomain = 'acme';
  const { api, recorded } = createTestApi({ web: stub.web });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));
    document.querySelector('.slackmod-members__row').click();
    await new Promise((resolve) => setTimeout(resolve, 30));

    const actions = recorded.modals[0].options.actions;
    const labels = actions.map((a) => a.label);
    assert.deepEqual(labels, ['Copy name', 'Copy member ID', 'Copy profile link']);

    for (const action of actions) {
      // Every one keeps the dialog open: copying is rarely the last thing.
      assert.equal(action.onClick(), false);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));

    const { clipboard } = dom.recorded;
    assert.deepEqual(clipboard, ['@zoe.b', 'U1', 'https://acme.slack.com/team/U1']);
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('offers Message and an overflow, and nothing it cannot really do', async () => {
  const dom = installDom();
  const stub = web({ members: ['U1'] });
  const { api, recorded } = createTestApi({ web: stub.web });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));
    document.querySelector('.slackmod-members__row').click();
    await new Promise((resolve) => setTimeout(resolve, 30));

    const buttons = [...recorded.modals[0].body.querySelectorAll('.slackmod-profile__actions button')];
    assert.equal(buttons.length, 4, 'Message, Huddle, VIP and the overflow');
    assert.equal(buttons[0].textContent, 'Message');
    assert.equal(buttons[1].textContent, 'Huddle');
    assert.match(buttons[2].textContent, /VIPs$/, 'VIP is a button of its own, as in Slack');
    assert.equal(buttons[3].getAttribute('aria-label'), 'More actions');
    assert.equal(buttons[3].textContent, '', 'a glyph, not a word');
    // Slack pairs a glyph with the label on all but the overflow.
    for (const b of buttons.slice(0, 3)) assert.ok(b.querySelector('svg'), 'icon beside the text');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('a second click replaces the dialog rather than stacking one on it', async () => {
  const dom = installDom();
  const stub = web({ members: ['U1', 'U2'] });
  const { api, recorded } = createTestApi({ web: stub.web });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const rows = [...document.querySelectorAll('.slackmod-members__row')];
    rows[0].click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    rows[1].click();
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.equal(recorded.modals.length, 2, 'two were opened');
    assert.equal(document.querySelectorAll('.slackmod-test-modal').length, 1, 'one is on screen');
    assert.equal(recorded.modals[0].closed, true, 'the first was closed, not buried');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('speaks the app’s language', async () => {
  const dom = installDom();
  const stub = web({ members: ['U1'] });
  const { api, recorded } = createTestApi({ web: stub.web, locale: 'fr-FR' });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const column = document.getElementById('slackmod-member-column');
    assert.match(column.textContent, /Membres/, 'the column heading is French');

    document.querySelector('.slackmod-members__row').click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(recorded.modals[0].options.title, 'Profil');
    assert.deepEqual(recorded.modals[0].options.actions.map((a) => a.label),
      ['Copier le nom', 'Copier l’ID de membre', 'Copier le lien du profil']);
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('VIP is a direct preference write, offering add or remove as appropriate', async () => {
  const dom = installDom();
  const stub = web({ members: ['U1'] });
  const { api, recorded } = createTestApi({ web: stub.web });
  const calls = [];
  api.slack.vipUsers = async () => ['U1'];
  api.slack.setVip = async (id, want) => { calls.push([id, want]); return want; };
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));
    document.querySelector('.slackmod-members__row').click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    recorded.modals[0].body.querySelector('.slackmod-profile__more').click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const vip = [...recorded.modals[0].body.querySelectorAll('.slackmod-profile__actions button')]
      .find((b) => /VIP/.test(b.textContent));
    assert.match(vip.textContent, /Remove from VIPs/, 'already a VIP, so the button offers removal');
    vip.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(calls, [['U1', false]], 'one preference write, no UI driven anywhere');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('Huddle asks Slack to open its own preview', async () => {
  const dom = installDom();
  const stub = web({ members: ['U1'] });
  const { api, recorded } = createTestApi({ web: stub.web });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));
    document.querySelector('.slackmod-members__row').click();
    await new Promise((resolve) => setTimeout(resolve, 30));

    const huddle = [...recorded.modals[0].body.querySelectorAll('.slackmod-profile__actions button')]
      .find((b) => b.textContent === 'Huddle');
    huddle.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(recorded.huddles, ['U1']);
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('says who the profile belongs to, rather than leaving it to be guessed', async () => {
  const dom = installDom();
  const stub = web({ members: ['U1'] });
  // A bot avatar: not on Slack's CDN, so the URL carries no user id at all.
  stub.web.userInfo = async (id) => ({
    id, profile: { display_name: 'Bot', image_512: 'https://a.slack-edge.com/bot_icons/x_48.png' },
  });
  const { api, recorded } = createTestApi({ web: stub.web });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));
    document.querySelector('.slackmod-members__row').click();
    await new Promise((resolve) => setTimeout(resolve, 30));

    const pane = recorded.modals[0].body.querySelector('[data-qa="member_profile_pane"]');
    assert.equal(pane.getAttribute('data-user-id'), 'U1');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('forgets a workspace’s people when the workspace changes', async () => {
  const dom = installDom();
  const stub = web({ members: ['U1'] });
  let lookups = 0;
  stub.web.call = async (method, params) => {
    if (method === 'conversations.members') return { ok: true, members: ['U1'] };
    if (method === 'users.info') { lookups++; return { ok: true, users: [{ id: 'U1', profile: {} }] }; }
    return { ok: true };
  };
  const { api, recorded } = createTestApi({ web: stub.web });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(lookups, 1);

    // Same channel id, different team: the cached people belong to the old one.
    dom.dom.reconfigure({ url: 'https://app.slack.com/client/T999OTHER/C0BFQCYBRAB' });
    await new Promise((resolve) => setTimeout(resolve, 1300));
    document.getElementById('slackmod-member-column').replaceChildren();
    await new Promise((resolve) => setTimeout(resolve, 1300));
    assert.ok(lookups >= 2, 'it looked them up again instead of reusing the other workspace');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});
