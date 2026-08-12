import test from 'node:test';
import assert from 'node:assert/strict';
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

test('clicking it presses Slack’s own account button', async () => {
  const dom = installDom();
  const { api, recorded } = createTestApi();
  try {
    await plugin.start(api);
    let clicked = 0;
    document.querySelector('[data-qa="user-button"]').addEventListener('click', () => { clicked++; });
    document.querySelector('#slackmod-account-strip .slackmod-me').click();
    assert.equal(clicked, 1, 'Slack opens its own menu rather than one we reimplemented');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
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
