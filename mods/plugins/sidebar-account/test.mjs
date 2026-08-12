import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertPluginShape, createTestApi, installDom } from '../../../tests/harness.mjs';
import plugin from './index.js';

test('has the shape the runtime loads', () => assertPluginShape(assert, plugin));

test('mounts at the foot of the sidebar and fills in the looked-up name', async () => {
  const dom = installDom();
  const { api, recorded } = createTestApi({
    web: { userInfo: async () => ({ id: 'U041KF85GP5', profile: { display_name: 'Erwan' } }) },
  });
  try {
    await plugin.start(api);

    const strip = document.getElementById('slackmod-account-strip');
    assert.ok(strip, 'the strip is mounted');
    assert.ok(
      recorded.mounted.some((m) => m.container === '.p-channel_sidebar'),
      'into the sidebar, so it lands under the channel list',
    );

    // Availability comes straight off the page, so it is right immediately.
    assert.equal(strip.querySelector('.slackmod-me__status').textContent, 'Active');

    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(strip.querySelector('.slackmod-me__name').textContent, 'Erwan');
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
    assert.equal(asked, 'U041KF85GP5');
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
    document.querySelector('#slackmod-account-strip .slackmod-me').click();
    assert.equal(clicked, 0);

    document.querySelector('#slackmod-account-strip .slackmod-me__settings').click();
    assert.equal(clicked, 1, 'Slack opens its own menu rather than one we reimplemented');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('shows availability as a dot, coloured from Slack’s answer', async () => {
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
    const dot = document.querySelector('#slackmod-account-strip .slackmod-me__dot');
    assert.ok(dot, 'the dot sits on the avatar, the way every chat app does it');
    assert.ok(dot.classList.contains('slackmod-me__dot--active'));
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('do not disturb outranks being active', async () => {
  const dom = installDom();
  const { api, recorded } = createTestApi({
    web: {
      presence: async () => ({ presence: 'active' }),
      dndInfo: async () => ({ dnd_enabled: true }),
    },
  });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const dot = document.querySelector('#slackmod-account-strip .slackmod-me__dot');
    assert.ok(dot.classList.contains('slackmod-me__dot--dnd'));
    assert.ok(!dot.classList.contains('slackmod-me__dot--active'));
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
    const strip = document.getElementById('slackmod-account-strip');
    assert.ok(strip, 'the avatar and availability still render');
    assert.equal(strip.querySelector('.slackmod-me__name').textContent, '');
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

    document.querySelector('#slackmod-account-strip .slackmod-me__settings').click();
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
