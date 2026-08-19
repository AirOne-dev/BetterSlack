import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertPluginShape, createTestApi, installDom } from '../../../tests/harness.mjs';
import plugin from './index.js';

test('has the shape the runtime loads', () => assertPluginShape(assert, plugin));

test('mounts at the foot of the sidebar and fills in the looked-up name', async () => {
  const dom = installDom();
  const { api, recorded } = createTestApi({
    web: { userInfo: async () => ({ id: 'U0EXAMPLE1', profile: { display_name: 'Erwan' } }) },
  });
  try {
    await plugin.start(api);

    const strip = document.getElementById('betterslack-account-strip');
    assert.ok(strip, 'the strip is mounted');
    assert.ok(
      recorded.mounted.some((m) => m.container === '.p-channel_sidebar'),
      'into the sidebar, so it lands under the channel list',
    );

    // Availability comes straight off the page, so it is right immediately.
    assert.equal(strip.querySelector('.betterslack-me__status').textContent, 'Active');

    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(strip.querySelector('.betterslack-me__name').textContent, 'Erwan');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('reads the user id from the avatar URL, not the localised label', async () => {
  const dom = installDom();
  let asked = null;
  const { api, recorded } = createTestApi({
    web: { userInfo: async (id) => { asked = id; return { id, profile: {} }; } },
  });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(asked, 'U0EXAMPLE1');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('the gear opens Slack’s account menu; the strip itself is inert', async () => {
  const dom = installDom();
  const { api, recorded } = createTestApi();
  try {
    await plugin.start(api);
    let clicked = 0;
    document.querySelector('[data-qa="user-button"]').addEventListener('click', () => { clicked++; });

    // The strip shows who you are; it promises no click, so it performs none.
    document.querySelector('#betterslack-account-strip .betterslack-me').click();
    assert.equal(clicked, 0);

    document.querySelector('#betterslack-account-strip .betterslack-me__settings').click();
    assert.equal(clicked, 1, 'Slack opens its own menu rather than one we reimplemented');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('follows the indicator Slack draws on its own avatar', async () => {
  // The bug this replaced: users.getPresence lags the client, worst of all just
  // after the window comes back, so the dot said away while the app said
  // available -- and stayed wrong until the next poll a minute later. Slack
  // puts the answer in the DOM; copying it is instant and always agrees.
  const dom = installDom();
  try {
    // The node Slack itself renders, which the fixture now carries.
    const mine = document.querySelector('[data-qa="user-button"] .c-presence');

    const { api, recorded } = createTestApi({
      // Slack's API insisting otherwise: the node wins.
      web: { presence: async () => ({ presence: 'away' }) },
    });
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const dot = document.querySelector('#betterslack-account-strip .betterslack-me__dot');
    assert.ok(dot.classList.contains('betterslack-me__dot--active'), 'active, as the rail shows');

    // And it follows, rather than waiting for a poll.
    mine.classList.remove('c-presence--active');
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(!dot.classList.contains('betterslack-me__dot--active'), 'away the moment Slack says so');
    assert.equal(document.querySelector('.betterslack-me__status').textContent, 'Away',
      'and the word beside it says the same thing');

    mine.classList.add('c-presence--active');
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(dot.classList.contains('betterslack-me__dot--active'), 'and back again');
    assert.equal(document.querySelector('.betterslack-me__status').textContent, 'Active');

    for (const dispose of recorded.disposers) dispose();
  } finally {
    dom.cleanup();
  }
});

test('falls back to the API when Slack draws no indicator', async () => {
  const dom = installDom();
  const { api, recorded } = createTestApi({
    web: {
      presence: async () => ({ presence: 'active' }),
      dndInfo: async () => ({ dnd_enabled: false }),
    },
  });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const dot = document.querySelector('#betterslack-account-strip .betterslack-me__dot');
    assert.ok(dot, 'the dot sits on the avatar, the way every chat app does it');
    assert.ok(dot.classList.contains('betterslack-me__dot--active'));
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('do not disturb outranks being active, while it is actually on', async () => {
  const dom = installDom();
  const now = Date.now() / 1000;
  const { api, recorded } = createTestApi({
    web: {
      presence: async () => ({ presence: 'active' }),
      // A window covering right now. `dnd_enabled` on its own is a schedule,
      // not a state -- someone with quiet hours every night is not away all
      // day, which is what treating the flag as the answer would show.
      dndInfo: async () => ({ dnd_enabled: true, next_dnd_start_ts: now - 60, next_dnd_end_ts: now + 60 }),
    },
  });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const dot = document.querySelector('#betterslack-account-strip .betterslack-me__dot');
    assert.ok(dot.classList.contains('betterslack-me__dot--dnd'));
    assert.ok(!dot.classList.contains('betterslack-me__dot--active'));
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('takes the member list’s surface, so the two read as one family', () => {
  const source = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
  const rule = source.match(/#\$\{STRIP_ID\} \{[^}]*\}/);
  assert.match(rule[0], /--dt_color-base-sec/, 'the same token the member column uses');
});

test('survives having no session token', async () => {
  const dom = installDom();
  const { api, recorded } = createTestApi({ web: { available: false } });
  try {
    await plugin.start(api);
    const strip = document.getElementById('betterslack-account-strip');
    assert.ok(strip, 'the avatar and availability still render');
    assert.equal(strip.querySelector('.betterslack-me__name').textContent, '');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('collapses the duplicate avatar without breaking Slack’s menu', async () => {
  const dom = installDom();
  const { api, recorded } = createTestApi();
  try {
    await plugin.start(api);
    const css = recorded.css.join('\n');
    // display:none stops Slack's account menu opening at all; collapsing it
    // keeps the menu anchored exactly where it was. Measured, not assumed.
    const rule = css.match(/\.p-control_strip \[data-qa="user-button"\]\s*\{[^}]*\}/);
    assert.ok(rule, 'the rail avatar must be hidden, it is the same person twice');
    assert.match(rule[0], /visibility:\s*hidden/);
    assert.doesNotMatch(rule[0], /display:\s*none/, 'display:none breaks the menu');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('lifts only the unread pill the strip is in the way of', async () => {
  const dom = installDom();
  const { api, recorded } = createTestApi();
  try {
    const sidebar = document.querySelector('.p-channel_sidebar');
    // jsdom has no layout, so both pills are given one.
    const place = (top) => {
      const el = document.createElement('button');
      el.className = 'p-channel_sidebar__banner';
      el.getBoundingClientRect = () => ({ top, height: 28 });
      sidebar.append(el);
      return el;
    };
    sidebar.getBoundingClientRect = () => ({ top: 100, height: 800 });
    const above = place(140);   // near the top: unread earlier in the list
    const below = place(860);   // near the bottom: where the strip now sits

    await plugin.start(api);

    assert.equal(below.style.bottom, '60px', 'the bottom pill clears the strip');
    assert.equal(above.style.bottom, '', 'the top one is left alone');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('moves Slack’s account menu next to the gear that opened it', async () => {
  const dom = installDom();
  const { api, recorded } = createTestApi();
  try {
    await plugin.start(api);

    // Slack opens its menu anchored to the rail button, far from the strip.
    const panel = document.createElement('div');
    panel.className = 'ReactModal__Content';
    panel.style.top = '946px';
    panel.style.left = '65px';
    panel.innerHTML = '<div class="c-menu"></div>';
    document.querySelector('[data-qa="user-button"]').addEventListener('click', () => {
      document.body.append(panel);
    });

    document.querySelector('#betterslack-account-strip .betterslack-me__settings').click();
    await new Promise((resolve) => setTimeout(resolve, 250));

    assert.notEqual(panel.style.top, '946px', 'it was moved off Slack’s anchor');
    assert.notEqual(panel.style.left, '65px');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('re-checks the pills when the window is resized', async () => {
  const dom = installDom();
  const { api, recorded } = createTestApi();
  try {
    const sidebar = document.querySelector('.p-channel_sidebar');
    sidebar.getBoundingClientRect = () => ({ top: 100, height: 800 });
    await plugin.start(api);

    // A pill that appears after start, then a resize: onEach saw it, but this
    // is the path that matters when its position changes rather than its
    // existence.
    const pill = document.createElement('button');
    pill.className = 'p-channel_sidebar__banner';
    pill.getBoundingClientRect = () => ({ top: 860, height: 28 });
    sidebar.append(pill);
    pill.style.bottom = '';

    window.dispatchEvent(new window.Event('resize'));
    assert.equal(pill.style.bottom, '60px');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('shows your own status, emoji and all', async () => {
  const dom = installDom();
  const { api, recorded } = createTestApi({
    web: {
      selfId: 'U000SELF',
      users: async (ids) => new Map(ids.map((id) => [id, {
        id,
        profile: {
          display_name: 'Erwan',
          status_emoji: ':palm_tree:',
          status_text: 'On holiday',
        },
      }])),
      emoji: async () => new Map([['palm_tree', 'https://emoji.example/palm.png']]),
    },
  });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 30));

    const line = document.querySelector('.betterslack-me__status');
    assert.ok(line, 'the strip has a status line');
    assert.match(line.textContent, /On holiday/, 'the sentence someone wrote outranks the presence word');

    // The emoji belongs beside the name, not on the line below: that is where
    // Slack puts it, and where it reads as belonging to the person.
    const img = document.querySelector('.betterslack-me__nameline .betterslack-status__emoji');
    assert.ok(img, 'the emoji sits beside the name');
    assert.equal(img.getAttribute('src'), 'https://emoji.example/palm.png');
    assert.equal(line.querySelector('.betterslack-status__emoji'), null,
      'and not on the status line as well');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('takes the avatar, not whatever image Slack put in the button first', async () => {
  const dom = installDom();
  /*
   * Slack draws your status emoji inside the user button when you have one set,
   * and it comes first in the DOM. Picking `img` positionally took the emoji:
   * the strip showed it where the face goes, and the id read out of the URL came
   * back null -- an emoji URL has no team and user in it -- so the name stayed
   * empty and no status was ever looked up. One selector, three symptoms.
   */
  const button = document.querySelector('[data-qa="user-button"]');
  const emoji = document.createElement('img');
  emoji.setAttribute('src', 'https://emoji.slack-edge.com/T025V5WN2/catjam/0e40.gif');
  button.prepend(emoji);

  const { api, recorded } = createTestApi({
    web: {
      users: async (ids) => new Map(ids.map((id) => [id, { id, profile: { display_name: 'Erwan' } }])),
    },
  });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 30));

    const drawn = document.querySelector('.betterslack-me__avatar');
    assert.ok(drawn, 'the strip drew an avatar');
    assert.doesNotMatch(drawn.getAttribute('src') ?? '', /emoji\.slack-edge/,
      'the status emoji is not the face');
    assert.match(document.querySelector('.betterslack-me__name').textContent, /Erwan/,
      'and the id was read, so the name arrived');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('the status emoji opens Slack’s own status dialog, and only on a click', async () => {
  const dom = installDom();
  let opened = 0;
  let menuOpened = 0;
  document.querySelector('[data-qa="user-button"]')
    .addEventListener('click', () => { menuOpened += 1; });

  const { api, recorded } = createTestApi({
    web: {
      users: async (ids) => new Map(ids.map((id) => [id, {
        id,
        profile: { display_name: 'Erwan', status_emoji: ':catjam:', status_text: '' },
      }])),
      emoji: async () => new Map([['catjam', 'https://emoji.slack-edge.com/T1/catjam/0e40.gif']]),
    },
  });
  api.slack.openStatusEditor = async () => { opened += 1; return true; };
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 30));

    const emoji = document.querySelector('.betterslack-me__emoji');
    assert.ok(emoji, 'the emoji is there');
    assert.equal(emoji.tagName, 'BUTTON', 'and it is pressable');

    // Hovering must not open anything: this is Slack's dialog over the whole
    // window, and a 15px target crossed on the way somewhere else is not a
    // request for it.
    emoji.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(opened, 0, 'hovering opens nothing');

    emoji.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(opened, 1, 'clicking opens the status dialog');
    assert.equal(menuOpened, 0, 'and does not also open the account menu under it');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});
