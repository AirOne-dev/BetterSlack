import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPluginShape, createTestApi, installDom } from '../../../tests/harness.mjs';
import plugin, { PREFERENCE, TOGGLE_ACTION, toggleDevTools } from './index.js';

/** A stand-in for Slack's preload bridge, recording what it is asked to do. */
function fakeBridge({ enabled = false, withRedux = true } = {}) {
  const calls = { preferences: [], dispatched: [] };
  let value = enabled;
  return {
    calls,
    bridge: {
      app: {
        getPreference: (name) => (name === PREFERENCE ? value : undefined),
        setPreference: ({ name, value: next }) => {
          calls.preferences.push({ name, value: next });
          if (name === PREFERENCE) value = next;
        },
      },
      ...(withRedux
        ? { redux: { dispatchUpdate: (action) => calls.dispatched.push(action) } }
        : {}),
    },
  };
}

test('exports a plugin', () => {
  assertPluginShape(assert, plugin);
});

test('dispatches Slack’s own action, not a reimplementation', () => {
  assert.deepEqual(TOGGLE_ACTION, { type: 'TOGGLE_DEV_TOOLS' });
  // FSA compliance matters: Slack validates the action before dispatching it.
  assert.equal(Object.keys(TOGGLE_ACTION).length, 1);
  assert.equal(typeof TOGGLE_ACTION.type, 'string');
});

test('enables the setting the toggle epic is gated on, then toggles', () => {
  const { bridge, calls } = fakeBridge({ enabled: false });
  toggleDevTools(bridge);

  assert.deepEqual(calls.preferences, [{ name: PREFERENCE, value: true }]);
  assert.deepEqual(calls.dispatched, [TOGGLE_ACTION]);
});

test('does not rewrite the preference once it is already on', () => {
  const { bridge, calls } = fakeBridge({ enabled: true });
  toggleDevTools(bridge);
  toggleDevTools(bridge);

  assert.deepEqual(calls.preferences, [], 'left alone');
  assert.equal(calls.dispatched.length, 2, 'still toggles every time');
});

test('toggling twice sends the same action twice, which is what closes it', () => {
  const { bridge, calls } = fakeBridge();
  toggleDevTools(bridge);
  toggleDevTools(bridge);
  assert.deepEqual(calls.dispatched, [TOGGLE_ACTION, TOGGLE_ACTION]);
});

test('explains itself when the desktop bridge is missing', () => {
  assert.throws(() => toggleDevTools(undefined), /bridge is not available/);
  assert.throws(() => toggleDevTools(fakeBridge({ withRedux: false }).bridge), /bridge is not available/);
});

test('sits above the SlackMod button in the control strip', async () => {
  const dom = installDom();
  try {
    const { api, recorded } = createTestApi();
    await plugin.start(api);

    assert.equal(recorded.toolbarButtons.length, 1);
    assert.equal(recorded.toolbarButtons[0].toolbar, 'controlStrip');
    assert.equal(recorded.toolbarButtons[0].button.before, '#slackmod-control-button',
      'without this anchor it would land under the SlackMod button');
  } finally {
    dom.cleanup();
  }
});

test('clicking the button toggles through the bridge', async () => {
  const dom = installDom();
  try {
    const { bridge, calls } = fakeBridge();
    globalThis.window.desktop = bridge;

    const { api, recorded } = createTestApi();
    await plugin.start(api);
    recorded.toolbarButtons[0].button.onClick();

    assert.deepEqual(calls.dispatched, [TOGGLE_ACTION]);
    assert.equal(recorded.toasts.length, 0, 'nothing to report when it works');
  } finally {
    dom.cleanup();
  }
});

test('reports a missing bridge instead of failing silently', async () => {
  const dom = installDom();
  try {
    delete globalThis.window.desktop;
    const { api, recorded } = createTestApi();
    await plugin.start(api);
    recorded.toolbarButtons[0].button.onClick();

    assert.ok(recorded.toasts.some((t) => t.variant === 'error'));
  } finally {
    dom.cleanup();
  }
});

test('builds no UI of its own', async () => {
  // The point of this mod is that it opens Slack's real DevTools; if it ever
  // starts rendering panels again, something has gone wrong.
  const { readFileSync } = await import('node:fs');
  const raw = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert.doesNotMatch(source, /api\.ui\.modal|api\.dom\.keepMounted|api\.css/);
});
