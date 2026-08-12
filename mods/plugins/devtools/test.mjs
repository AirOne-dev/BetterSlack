import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPluginShape, createTestApi, installDom } from '../../../tests/harness.mjs';
import plugin, { toggleDevTools } from './index.js';

/** A stand-in for Slack's preload bridge, recording what it is asked to do. */
function fakeBridge({ withToggle = true } = {}) {
  const calls = { toggled: 0 };
  return {
    calls,
    bridge: { app: withToggle ? { toggleDevTools: () => { calls.toggled++; } } : {} },
  };
}

test('exports a plugin', () => {
  assertPluginShape(assert, plugin);
});

test('calls Slack’s own bridge method', () => {
  const { bridge, calls } = fakeBridge();
  toggleDevTools(bridge);
  assert.equal(calls.toggled, 1);
});

test('toggling twice calls it twice, which is what closes DevTools', () => {
  const { bridge, calls } = fakeBridge();
  toggleDevTools(bridge);
  toggleDevTools(bridge);
  assert.equal(calls.toggled, 2);
});

test('explains itself when the desktop bridge is missing', () => {
  assert.throws(() => toggleDevTools(undefined), /bridge is not available/);
  assert.throws(() => toggleDevTools(fakeBridge({ withToggle: false }).bridge), /bridge is not available/);
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
    const { bridge, calls } = fakeBridge();
    globalThis.window.desktop = bridge;

    const { api, recorded } = createTestApi();
    await plugin.start(api);
    recorded.toolbarButtons[0].button.onClick();

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
