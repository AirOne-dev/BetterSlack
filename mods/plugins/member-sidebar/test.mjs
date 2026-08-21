import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { assertPluginShape, createTestApi, installDom, readModFiles, switchWorkspace } from '../../../tests/harness.mjs';
import plugin from './index.js';

// The plugin reads its stylesheet with api.assets.text('column.css'), so the
// test api has to be given the folder the app would have shipped it.
const FILES = readModFiles(path.dirname(fileURLToPath(import.meta.url)));
const createApi = (options) => createTestApi({ ...options, files: FILES });

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
  const { api, recorded } = createApi({ web: stub.web });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const column = document.getElementById('betterslack-member-column');
    assert.ok(column, 'the column is mounted');
    assert.ok(
      recorded.mounted.some((m) => m.container === '.p-view_contents--primary'),
      'beside the message pane, so it becomes a second flex column',
    );

    const names = [...column.querySelectorAll('.betterslack-members__name')].map((n) => n.textContent);
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
  const { api, recorded } = createApi({ web: stub.web });
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
  const { api, recorded } = createApi({ web: stub.web });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 40));

    const column = document.getElementById('betterslack-member-column');
    const headings = [...column.querySelectorAll('.betterslack-members__heading')].map((h) => h.textContent);
    assert.deepEqual(headings, ['Online — 1', 'Offline — 1']);

    // Online first, whatever the alphabet says.
    const names = [...column.querySelectorAll('.betterslack-members__name')].map((n) => n.textContent);
    assert.deepEqual(names, ['Zoe', 'Adam']);
    assert.ok(column.querySelector('.betterslack-members__dot--active'), 'the online dot is lit');
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
  const { api, recorded } = createApi({ web: stub.web });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const headings = [...document.querySelectorAll('.betterslack-members__heading')].map((h) => h.textContent);
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
  const { api, recorded } = createApi({ web: stub.web });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));

    document.querySelector('.betterslack-members__row').click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(recorded.modals.length, 1, 'a dialog, not Slack’s pane');
    const body = recorded.modals[0].body;
    assert.match(body.textContent, /Zoe/);
    assert.match(body.textContent, /Engineer/);
    assert.match(body.textContent, /zoe@acme\.test/, 'the fields Slack’s own pane shows');
    assert.match(body.textContent, /Active/, 'presence is resolved, not guessed');
    assert.ok(body.querySelector('.betterslack-profile__dot--active'));
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
  const { api, recorded } = createApi({ web: stub.web });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));
    document.querySelector('.betterslack-members__row').click();
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
    id: 'U0EXAMPLE1',
    name: 'zoe',
    profile: {
      display_name: 'Zoe',
      // The id User Inspector reads comes off this URL, so it has to be a real
      // Slack avatar URL rather than a placeholder.
      image_512: 'https://ca.slack-edge.com/T0EXAMPLE1-U0EXAMPLE1-abc-512',
    },
  };
  stub.web.userInfo = async () => user;
  const { api, recorded } = createApi({ web: stub.web });
  try {
    const inspector = (await import('../user-inspector/index.js')).default;
    await plugin.start(api);
    // Both plugins on at once, exactly as the panel would have them.
    await inspector.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));

    document.querySelector('.betterslack-members__row').click();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const pane = recorded.modals[0].body.querySelector('[data-qa="member_profile_pane"]');
    assert.ok(
      pane.querySelector('.betterslack-user-details'),
      'User Inspector appended its sections into our dialog, with no code shared',
    );
    assert.equal(
      document.querySelectorAll('.betterslack-user-details').length, 2,
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
  const { api, recorded } = createApi({ web: stub.web });
  let opened = null;
  api.slack.openDirectMessage = async (id) => { opened = id; return 'D1'; };
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));
    document.querySelector('.betterslack-members__row').click();
    await new Promise((resolve) => setTimeout(resolve, 30));

    const message = [...recorded.modals[0].body.querySelectorAll('.betterslack-profile__actions button')]
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
  const { api, recorded } = createApi({ web: stub.web });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));
    document.querySelector('.betterslack-members__row').click();
    await new Promise((resolve) => setTimeout(resolve, 30));

    const before = document.querySelectorAll('[data-qa="member_profile_pane"]').length;
    const more = recorded.modals[0].body.querySelector('.betterslack-profile__more');
    assert.ok(more.querySelector('svg'), 'the ellipsis glyph, like Slack’s');
    more.click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    // api.ui.menu owns the layer now, so the id is the API's rather than this
    // plugin's -- what matters is that it is Slack's markup and ours to close.
    const menu = document.getElementById('betterslack-menu-layer');
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
  const { api, recorded } = createApi({ web: stub.web });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const row = document.querySelector('.betterslack-members__row');
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
  const { api, recorded } = createApi({ web: { available: false } });
  try {
    await plugin.start(api);
    assert.equal(document.getElementById('betterslack-member-column'), null);
    assert.ok(recorded.logs.some(([level]) => level === 'warn'));
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('the source keeps its own token discipline', () => {
  // Every file in the folder, not only the entry: a mod is a folder now, and a
  // rule that only held for index.js would be a rule with a way around it.
  for (const [name, source] of Object.entries(FILES)) {
    if (name.endsWith('.css') || name === 'test.mjs') continue;
    assert.doesNotMatch(source, /\blocalStorage\b/, `${name}: the token is read only in web-api.ts`);
    assert.doesNotMatch(source, /\bfetch\s*\(/, `${name}: network goes through api.slack.web`);
  }
});

test('undoes the layout that comes with Slack’s avatar class', () => {
  // The class is borrowed for compatibility, and Slack positions it absolutely
  // for its own pane — which parked it on top of the dialog title until this.
  const css = FILES['column.css'];
  const rule = css.match(/\.betterslack-profile \.betterslack-profile__avatar\s*\{[^}]*\}/);
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
  const { api, recorded } = createApi({ web: stub.web });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));
    document.querySelector('.betterslack-members__row').click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const text = recorded.modals[0].body.textContent;
    assert.match(text, /On holiday/);
    assert.doesNotMatch(text, /:tada:/, 'a custom shortcode has no unicode to fall back on');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('draws a custom status emoji as the image the workspace has for it', async () => {
  const dom = installDom();
  const stub = web({ members: ['U1'] });
  stub.web.userInfo = async (id) => ({
    id,
    profile: { display_name: 'Zoe', status_emoji: ':glitch_crab:', status_text: 'On holiday' },
  });
  // The workspace's own emoji, which is the only place a custom one can come
  // from: emoji.list has no standard names in it and a shortcode alone builds
  // no URL.
  stub.web.emoji = async () => new Map([['glitch_crab', 'https://emoji.slack-edge.com/T1/glitch_crab/db04.png']]);
  const { api, recorded } = createApi({ web: stub.web });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));
    document.querySelector('.betterslack-members__row').click();
    await new Promise((resolve) => setTimeout(resolve, 30));

    const img = recorded.modals[0].body.querySelector('.betterslack-status__emoji');
    assert.ok(img, 'the status emoji is drawn');
    assert.equal(img.getAttribute('src'), 'https://emoji.slack-edge.com/T1/glitch_crab/db04.png');
    assert.match(recorded.modals[0].body.textContent, /On holiday/);
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('prefers what Slack sent with the profile over the workspace map', async () => {
  const dom = installDom();
  const stub = web({ members: ['U1'] });
  stub.web.userInfo = async (id) => ({
    id,
    profile: {
      display_name: 'Zoe',
      status_emoji: ':tada:',
      status_text: 'Shipping',
      // What Slack's own client draws from, and it wins: it is the answer for
      // this profile rather than a lookup that might be a different workspace's.
      status_emoji_display_info: [{ emoji_name: 'tada', display_url: 'https://a.slack-edge.com/tada.png' }],
    },
  });
  stub.web.emoji = async () => new Map([['tada', 'https://wrong.example/tada.png']]);
  const { api, recorded } = createApi({ web: stub.web });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));
    document.querySelector('.betterslack-members__row').click();
    await new Promise((resolve) => setTimeout(resolve, 30));

    const img = recorded.modals[0].body.querySelector('.betterslack-status__emoji');
    assert.equal(img.getAttribute('src'), 'https://a.slack-edge.com/tada.png');
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
  const { api, recorded } = createApi({ web: stub.web });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));
    document.querySelector('.betterslack-members__row').click();
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
  const { api, recorded } = createApi({ web: stub.web });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));
    document.querySelector('.betterslack-members__row').click();
    await new Promise((resolve) => setTimeout(resolve, 30));

    const buttons = [...recorded.modals[0].body.querySelectorAll('.betterslack-profile__actions button')];
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
  const { api, recorded } = createApi({ web: stub.web });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const rows = [...document.querySelectorAll('.betterslack-members__row')];
    rows[0].click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    rows[1].click();
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.equal(recorded.modals.length, 2, 'two were opened');
    assert.equal(document.querySelectorAll('.betterslack-test-modal').length, 1, 'one is on screen');
    assert.equal(recorded.modals[0].closed, true, 'the first was closed, not buried');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('speaks the app’s language', async () => {
  const dom = installDom();
  const stub = web({ members: ['U1'] });
  const { api, recorded } = createApi({ web: stub.web, locale: 'fr-FR' });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const column = document.getElementById('betterslack-member-column');
    assert.match(column.textContent, /Membres/, 'the column heading is French');

    document.querySelector('.betterslack-members__row').click();
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
  const { api, recorded } = createApi({ web: stub.web });
  const calls = [];
  api.slack.vipUsers = async () => ['U1'];
  api.slack.setVip = async (id, want) => { calls.push([id, want]); return want; };
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));
    document.querySelector('.betterslack-members__row').click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    recorded.modals[0].body.querySelector('.betterslack-profile__more').click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const vip = [...recorded.modals[0].body.querySelectorAll('.betterslack-profile__actions button')]
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
  const { api, recorded } = createApi({ web: stub.web });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));
    document.querySelector('.betterslack-members__row').click();
    await new Promise((resolve) => setTimeout(resolve, 30));

    const huddle = [...recorded.modals[0].body.querySelectorAll('.betterslack-profile__actions button')]
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
  const { api, recorded } = createApi({ web: stub.web });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));
    document.querySelector('.betterslack-members__row').click();
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
  const { api, recorded } = createApi({ web: stub.web });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(lookups, 1);

    // Same channel id, different team: the cached people belong to the old one.
    switchWorkspace(dom, 'T999OTHER');
    await new Promise((resolve) => setTimeout(resolve, 1300));
    document.getElementById('betterslack-member-column').replaceChildren();
    await new Promise((resolve) => setTimeout(resolve, 1300));
    assert.ok(lookups >= 2, 'it looked them up again instead of reusing the other workspace');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('nothing in the column may shrink, or it never overflows to scroll', () => {
  // Flex items give up height before their container overflows. The rows were
  // rendering at 34px instead of 42 and tightening as the window shrank, which
  // is also why the scrollbar never appeared.
  const css = FILES['column.css'];
  const rule = css.match(/__heading,[\s\S]{0,120}__note \{ flex: 0 0 auto; \}/);
  assert.ok(rule, 'headings, rows and notes must all be flex: 0 0 auto');
  assert.match(css, /min-height: 0;/, 'and the column itself must be allowed to shrink');
});

test('a render answered after the workspace moved is not painted', async () => {
  const dom = installDom();
  /*
   * The symptom this guards: the column lists the right people and then, a
   * second later, replaces them with a single row -- yourself. Slack settles
   * onto its last session a moment after the client is up, so a request sent
   * against one workspace can come back while the URL, and the token every
   * later call uses, has moved to another.
   */
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const stub = web({ members: ['U1', 'U2', 'U3'] });
  const original = stub.web.call;
  stub.web.call = async (method, params) => {
    if (method === 'conversations.members') {
      await held;
      return { members: ['U1', 'U2', 'U3'] };
    }
    return original(method, params);
  };

  const { api, recorded } = createApi({ web: stub.web });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));

    // The workspace moves while the request is in flight -- URL and drawing
    // together, which is what Slack does.
    switchWorkspace(dom, 'T0OTHER', 'C0BQ8AG3771');
    release();
    await new Promise((resolve) => setTimeout(resolve, 40));

    const column = document.getElementById('betterslack-member-column');
    assert.equal(column.querySelectorAll('.betterslack-members__row').length, 0,
      'the answer belongs to a workspace the user has left, so it is dropped');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('lists the conversation Slack is showing, not the one the URL still names', async () => {
  /*
   * Measured at a cold start with three workspaces signed in: the URL read
   * `/client/T0BQ89Z4L4F/C0BQ8AG3771` while the client had drawn thirty-seven
   * avatars from `T025V5WN2` and a conversation from it. Slack restores the
   * view before it settles the address. Reading the URL then listed the members
   * of a channel in the workspace the user had left -- one row, themselves,
   * because they are the only member of it the other workspace admits to.
   */
  const dom = installDom();
  dom.dom.reconfigure({ url: 'https://app.slack.com/client/T0STALE/C0STALE' });

  const asked = [];
  const stub = web({ members: ['U1', 'U2'] });
  stub.web.call = async (method, params) => {
    if (method === 'conversations.members') {
      asked.push(params.channel);
      return { ok: true, members: ['U1', 'U2'] };
    }
    if (method === 'users.info') {
      return { ok: true, users: [{ id: 'U1', profile: {} }, { id: 'U2', profile: {} }] };
    }
    return { ok: true };
  };
  const { api, recorded } = createApi({ web: stub.web });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 40));

    assert.deepEqual(asked, ['C0BFQCYBRAB'],
      'the channel Slack drew, not the stale one in the address');
    assert.equal(document.querySelectorAll('.betterslack-members__row').length, 2);
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('draws the list you saw last time before either request lands', async () => {
  /*
   * Two round trips stood between changing channel and seeing anyone. What
   * comes back is nearly always what came back before, so it is drawn from what
   * was stored and confirmed behind you -- and the loading note only appears
   * when there is nothing stored to show instead.
   */
  const dom = installDom();
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const stub = web({ members: ['U1', 'U2'] });
  const original = stub.web.call;
  stub.web.call = async (method, params) => {
    if (method === 'conversations.members') { await held; return { members: ['U1', 'U2'] }; }
    return original(method, params);
  };
  stub.web.userInfo = async (id) => ({ id, profile: { display_name: `Person ${id}` } });

  // A first run fills the cache.
  const first = createApi({ web: stub.web });
  release();
  await plugin.start(first.api);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(document.querySelectorAll('.betterslack-members__row').length, 2);
  for (const dispose of first.recorded.disposers) dispose();
  // The column survives its plugin being disposed, so the second run would
  // otherwise be counting both.
  document.getElementById('betterslack-member-column')?.remove();

  // A second run, with the network held open: the rows are there anyway.
  let stall;
  const stalled = new Promise((resolve) => { stall = resolve; });
  stub.web.call = async (method, params) => {
    if (method === 'conversations.members') { await stalled; return { members: ['U1', 'U2'] }; }
    return original(method, params);
  };
  const second = createApi({ web: stub.web, settings: first.api.settings.all() });
  try {
    await plugin.start(second.api);
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(document.querySelectorAll('.betterslack-members__row').length, 2,
      'drawn from the cache, with nothing yet answered');
    assert.equal(document.querySelector('.betterslack-members__note'), null,
      'and no loading note over a list that is already right');
    stall();
  } finally {
    for (const dispose of second.recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('the column is dragged by a handle wearing Slack\u2019s own classes', async () => {
  /*
   * Slack's channel sidebar is resized by a `.p-resizer`: 8px, absolute,
   * col-resize, transparent, positioned rather than laid out. Wearing the same
   * classes means Slack's stylesheet draws it, so it follows every theme and
   * every hover state without a copy of that CSS here.
   */
  const dom = installDom();
  const { api, recorded } = createApi({ web: web({ members: ['U1'] }).web, settings: { width: 300 } });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const column = document.getElementById('betterslack-member-column');
    assert.equal(column.style.flex, '0 0 300px', 'the stored width is applied on mount');

    const handle = column.querySelector('.betterslack-members__resizer');
    assert.ok(handle, 'there is a handle');
    assert.ok(handle.classList.contains('p-resizer'), 'and it is Slack\u2019s, not a lookalike');
    assert.equal(handle.getAttribute('role'), 'none',
      'no tab stop, since Slack\u2019s own handle has none either');

    // The list is replaced on every redraw; the handle must survive it.
    const list = column.querySelector('.betterslack-members__list');
    assert.ok(list, 'the rows go in a list of their own');
    assert.ok(column.contains(handle), 'the handle is not a child of what gets replaced');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('a dragged width is clamped, and written once at the end', async () => {
  const dom = installDom();
  const { api, recorded } = createApi({ web: web({ members: ['U1'] }).web });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const column = document.getElementById('betterslack-member-column');
    const handle = column.querySelector('.betterslack-members__resizer');
    handle.setPointerCapture = () => {};
    column.getBoundingClientRect = () => ({ right: 1000, left: 760, width: 240 });

    const at = (type, x) => {
      const event = new window.Event(type, { bubbles: true });
      event.clientX = x;
      event.pointerId = 1;
      handle.dispatchEvent(event);
    };

    at('pointerdown', 760);
    at('pointermove', 700);
    assert.equal(column.style.flex, '0 0 300px', 'the right edge stays put');

    // Past the far end: clamped rather than allowed to swallow the pane.
    at('pointermove', 100);
    assert.equal(column.style.flex, '0 0 520px');
    at('pointermove', 990);
    assert.equal(column.style.flex, '0 0 180px');

    assert.equal(api.settings.get('width'), undefined, 'nothing written mid-drag');
    at('pointerup', 990);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(api.settings.get('width'), 180, 'written once, when the drag ends');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('stays out of the views that are not conversations', async () => {
  /*
   * Repertoires, Fils de discussion, Brouillons et envoyes and Appels d'equipe
   * all render into `.p-view_contents--primary`, and unlike a channel they
   * stack a header above their content in it. The column used to mount there
   * anyway -- `currentChannelId()` answers with any message Slack has drawn,
   * and those views draw plenty -- and the stylesheet then laid the header and
   * the content side by side. Measured on Repertoires: a 52px header became a
   * 1631px column down the left, with 243px of content beside it.
   */
  const dom = installDom();
  const stub = web();
  const { api, recorded } = createApi({ web: stub.web });
  try {
    dom.dom.reconfigure({ url: 'https://app.slack.com/client/T0EXAMPLE1/later' });
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const column = document.getElementById('betterslack-member-column');
    assert.ok(column, 'it still mounts, so nothing has to be remounted on the way back');
    assert.equal(column.hidden, true, 'and it is hidden, which is what the stylesheet keys off');
    assert.equal(
      stub.calls.filter((c) => c.method === 'conversations.members').length,
      0,
      'and Slack is not asked for the members of a route -- `LATER` is not a channel',
    );
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('the side-by-side layout travels with the column, not with the mod', () => {
  // Unconditional, `flex-direction: row` on that pane is the single line that
  // broke four of Slack's own views. Both rules have to be scoped to a pane
  // that is actually holding a visible column.
  const css = FILES['column.css'];
  const rows = css.match(/^\.p-view_contents--primary[^\n{]*/gm) ?? [];
  assert.ok(rows.length >= 2, 'the pane is still laid out');
  for (const selector of rows) {
    assert.match(
      selector,
      /:has\(> #betterslack-member-column:not\(\[hidden\]\)\)/,
      `unscoped rule on the primary pane: ${selector.trim()}`,
    );
  }
  assert.match(
    css,
    /#betterslack-member-column\[hidden\] \{ display: none !important; \}/,
    'and hidden has to beat the display flex the column sets on itself',
  );
});
