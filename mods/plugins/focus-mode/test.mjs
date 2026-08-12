import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPluginShape, createTestApi, installDom } from '../../../tests/harness.mjs';
import plugin from './index.js';

const FLAG = 'slackmod-focus-mode';

function press(recorded, event) {
  for (const { match, handler } of recorded.shortcuts) {
    if (match(event)) handler(event);
  }
}

test('exports a plugin', () => {
  assertPluginShape(assert, plugin);
});

test('registers shortcuts and injects its stylesheet', async () => {
  const dom = installDom();
  try {
    const { api, recorded } = createTestApi();
    await plugin.start(api);
    assert.ok(recorded.shortcuts.length >= 1, 'at least the toggle shortcut');
    assert.ok(recorded.css.join('\n').includes(FLAG), 'styles are keyed off the flag class');
  } finally {
    dom.cleanup();
  }
});

test('Cmd/Ctrl+Shift+F toggles the flag both ways', async () => {
  const dom = installDom();
  try {
    const { api, recorded } = createTestApi();
    await plugin.start(api);
    const event = { code: 'KeyF', shiftKey: true, metaKey: true, altKey: false, key: 'F' };

    press(recorded, event);
    assert.ok(document.documentElement.classList.contains(FLAG), 'on');
    press(recorded, event);
    assert.ok(!document.documentElement.classList.contains(FLAG), 'off');
  } finally {
    dom.cleanup();
  }
});

test('ignores the shortcut when Alt is held', async () => {
  const dom = installDom();
  try {
    const { api, recorded } = createTestApi();
    await plugin.start(api);
    press(recorded, { code: 'KeyF', shiftKey: true, metaKey: true, altKey: true, key: 'F' });
    assert.ok(!document.documentElement.classList.contains(FLAG));
  } finally {
    dom.cleanup();
  }
});

test('Escape leaves focus mode, but only while it is on', async () => {
  const dom = installDom();
  try {
    const { api, recorded } = createTestApi();
    await plugin.start(api);

    press(recorded, { key: 'Escape' });
    assert.ok(!document.documentElement.classList.contains(FLAG), 'no-op when already off');

    press(recorded, { code: 'KeyF', shiftKey: true, metaKey: true, altKey: false, key: 'F' });
    press(recorded, { key: 'Escape' });
    assert.ok(!document.documentElement.classList.contains(FLAG), 'Escape exits');
  } finally {
    dom.cleanup();
  }
});

test('Escape is left alone while typing in the composer', async () => {
  const dom = installDom();
  try {
    const { api, recorded } = createTestApi();
    await plugin.start(api);
    press(recorded, { code: 'KeyF', shiftKey: true, metaKey: true, altKey: false, key: 'F' });

    const editor = document.querySelector('.ql-editor');
    editor.setAttribute('tabindex', '0');
    editor.focus();

    press(recorded, { key: 'Escape' });
    assert.ok(
      document.documentElement.classList.contains(FLAG),
      'Escape in the composer belongs to Slack, not to us',
    );
  } finally {
    dom.cleanup();
  }
});

test('disabling the plugin removes the flag and the indicator', async () => {
  const dom = installDom();
  try {
    const { api, recorded } = createTestApi();
    await plugin.start(api);
    press(recorded, { code: 'KeyF', shiftKey: true, metaKey: true, altKey: false, key: 'F' });
    assert.ok(document.documentElement.classList.contains(FLAG));

    for (const dispose of recorded.disposers) dispose();

    assert.ok(!document.documentElement.classList.contains(FLAG), 'flag removed');
    assert.equal(document.getElementById('slackmod-focus-indicator'), null, 'indicator removed');
  } finally {
    dom.cleanup();
  }
});
