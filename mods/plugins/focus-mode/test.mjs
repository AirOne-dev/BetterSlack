import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPluginShape, createTestApi, installDom } from '../../../tests/harness.mjs';
import plugin from './index.js';

const FLAG = 'slackmod-focus-mode';

/** Real keyboard events, because the mod binds through api.helpers.hotkey. */
function press(dom, init) {
  window.dispatchEvent(new dom.dom.window.KeyboardEvent('keydown', { bubbles: true, ...init }));
}

const isOn = () => document.documentElement.classList.contains(FLAG);

async function mount(settings = {}) {
  const dom = installDom();
  const harness = createTestApi({ settings });
  await plugin.start(harness.api);
  return { dom, ...harness };
}

test('exports a plugin', () => {
  assertPluginShape(assert, plugin);
});

test('starts off, and its CSS is keyed off the flag class', async () => {
  const { dom, recorded } = await mount();
  try {
    assert.equal(isOn(), false);
    assert.ok(recorded.css.join('\n').includes(FLAG), 'styles hang off the flag');
  } finally {
    dom.cleanup();
  }
});

test('the hotkey toggles both ways', async () => {
  const { dom } = await mount();
  try {
    press(dom, { code: 'KeyF', key: 'F', shiftKey: true, metaKey: true });
    assert.equal(isOn(), true);
    press(dom, { code: 'KeyF', key: 'F', shiftKey: true, metaKey: true });
    assert.equal(isOn(), false);
  } finally {
    dom.cleanup();
  }
});

test('ignores the hotkey when Alt is held', async () => {
  const { dom } = await mount();
  try {
    press(dom, { code: 'KeyF', key: 'F', shiftKey: true, metaKey: true, altKey: true });
    assert.equal(isOn(), false);
  } finally {
    dom.cleanup();
  }
});

test('remembers the state across a restart', async () => {
  const { dom, store } = await mount();
  try {
    press(dom, { code: 'KeyF', key: 'F', shiftKey: true, metaKey: true });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(store.on, true, 'persisted through api.settings');
  } finally {
    dom.cleanup();
  }

  const second = await mount({ on: true });
  try {
    assert.equal(isOn(), true, 'comes back on');
  } finally {
    second.dom.cleanup();
  }
});

test('Escape leaves focus mode, but only while it is on', async () => {
  const { dom } = await mount();
  try {
    press(dom, { key: 'Escape' });
    assert.equal(isOn(), false, 'no-op when already off');

    press(dom, { code: 'KeyF', key: 'F', shiftKey: true, metaKey: true });
    press(dom, { key: 'Escape' });
    assert.equal(isOn(), false, 'Escape exits');
  } finally {
    dom.cleanup();
  }
});

test('Escape is left alone while typing in the composer', async () => {
  const { dom } = await mount();
  try {
    press(dom, { code: 'KeyF', key: 'F', shiftKey: true, metaKey: true });
    const editor = document.querySelector('.ql-editor');
    editor.setAttribute('tabindex', '0');
    editor.focus();

    press(dom, { key: 'Escape' });
    assert.equal(isOn(), true, 'Escape in the composer belongs to Slack');
  } finally {
    dom.cleanup();
  }
});

test('disabling the plugin removes the flag and the indicator', async () => {
  const { dom, recorded } = await mount();
  try {
    press(dom, { code: 'KeyF', key: 'F', shiftKey: true, metaKey: true });
    assert.equal(isOn(), true);

    for (const dispose of recorded.disposers) dispose();

    assert.equal(isOn(), false, 'flag removed');
    assert.equal(document.getElementById('slackmod-focus-indicator'), null, 'indicator removed');
  } finally {
    dom.cleanup();
  }
});
