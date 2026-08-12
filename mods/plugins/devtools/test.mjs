import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPluginShape, createTestApi, installDom } from '../../../tests/harness.mjs';
import plugin, { enableDevTools, PREFERENCE, toggleDevTools } from './index.js';

/** A stand-in for Slack's preload bridge, recording what it is asked to do. */
function fakeBridge({ withToggle = true, enabled = false } = {}) {
  const calls = { toggled: 0, preferences: [] };
  let value = enabled;
  const app = {
    getPreference: (name) => (name === PREFERENCE ? value : undefined),
    setPreference: ({ name, value: next }) => {
      calls.preferences.push({ name, value: next });
      if (name === PREFERENCE) value = next;
    },
  };
  if (withToggle) app.toggleDevTools = () => { calls.toggled++; };
  return { calls, bridge: { app } };
}

test('exports a plugin', () => {
  assertPluginShape(assert, plugin);
});

test('calls Slack’s own bridge method', async () => {
  const { bridge, calls } = fakeBridge({ enabled: true });
  await toggleDevTools(bridge);
  assert.equal(calls.toggled, 1);
});

test('toggling twice calls it twice, which is what closes DevTools', async () => {
  const { bridge, calls } = fakeBridge({ enabled: true });
  await toggleDevTools(bridge);
  await toggleDevTools(bridge);
  assert.equal(calls.toggled, 2);
});

test('enables the preference the toggle is gated behind', () => {
  // Without this the toggle never reaches the main process at all: no IPC,
  // nothing in Slack's log, and a button that appears to do nothing.
  const { bridge, calls } = fakeBridge();
  enableDevTools(bridge);
  assert.deepEqual(calls.preferences, [{ name: PREFERENCE, value: true }]);
});

test('does not rewrite the preference once it is on', () => {
  const { bridge, calls } = fakeBridge({ enabled: true });
  enableDevTools(bridge);
  assert.deepEqual(calls.preferences, []);
});

test('sets the preference before toggling if it is somehow off', async () => {
  const { bridge, calls } = fakeBridge({ enabled: false });
  await toggleDevTools(bridge);
  assert.deepEqual(calls.preferences, [{ name: PREFERENCE, value: true }]);
  assert.equal(calls.toggled, 1, 'and still toggles');
});

test('explains itself when the desktop bridge is missing', async () => {
  await assert.rejects(() => toggleDevTools(undefined), /bridge is not available/);
  await assert.rejects(
    () => toggleDevTools(fakeBridge({ withToggle: false }).bridge),
    /bridge is not available/,
  );
});

test('never goes through redux.dispatchUpdate', async () => {
  // That path looks like a generic action forwarder but wraps the argument as
  // the payload of REDUX_UPDATE_FROM_WEBAPP, whose reducer only reads
  // payload.teams — so the toggle is silently dropped. This caught it once.
  const { readFileSync } = await import('node:fs');
  const raw = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert.doesNotMatch(source, /dispatchUpdate/);
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
    const { bridge, calls } = fakeBridge({ enabled: true });
    globalThis.window.desktop = bridge;

    const { api, recorded } = createTestApi();
    await plugin.start(api);
    recorded.toolbarButtons[0].button.onClick();
    await new Promise((r) => setTimeout(r, 400));

    assert.equal(calls.toggled, 1);
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
    await new Promise((r) => setTimeout(r, 200));

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
