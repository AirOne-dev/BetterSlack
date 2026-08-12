import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPluginShape, createTestApi, installDom } from '../../../tests/harness.mjs';
import plugin, { describeElement, isHashedClass, stableSelectorFor } from './index.js';

const PANEL = '#slackmod-inspector-panel';

async function mount(overrides = {}) {
  const dom = installDom();
  const harness = createTestApi();
  harness.api.devtools = { evaluate: async () => ({ value: 42 }), ...overrides };
  await plugin.start(harness.api);
  return { dom, ...harness };
}

const button = (recorded) => recorded.toolbarButtons[0].button;
const panel = () => document.querySelector(PANEL);

test('exports a plugin', () => {
  assertPluginShape(assert, plugin);
});

test('tells CSS-module output apart from Slack’s BEM names', () => {
  assert.equal(isHashedClass('circleButton__cMiUK'), true);
  assert.equal(isHashedClass('tooltipSubtitle__jCgLZ'), true);
  assert.equal(isHashedClass('p-channel_sidebar__channel'), false);
  assert.equal(isHashedClass('c-message_kit__background'), false);
});

test('prefers data-qa, then a stable class, then the role', () => {
  const dom = installDom();
  try {
    const make = (html) => {
      const host = document.createElement('div');
      host.innerHTML = html;
      return host.firstElementChild;
    };
    assert.equal(stableSelectorFor(make('<div data-qa="message_input" class="x"></div>')),
      '[data-qa="message_input"]');
    assert.equal(stableSelectorFor(make('<div class="p-channel_sidebar__channel"></div>')),
      '.p-channel_sidebar__channel');
    assert.equal(stableSelectorFor(make('<div class="circleButton__cMiUK"></div>')), 'div');
    assert.equal(stableSelectorFor(make('<div role="toolbar"></div>')), 'div[role="toolbar"]');
    assert.equal(stableSelectorFor(null), null);
  } finally {
    dom.cleanup();
  }
});

test('never suggests a hashed class as the selector', () => {
  const dom = installDom();
  try {
    const host = document.createElement('div');
    host.innerHTML = '<div class="someThing__aBcDe another__XyZ12"></div>';
    assert.equal(stableSelectorFor(host.firstElementChild), 'div');
  } finally {
    dom.cleanup();
  }
});

test('describes the ancestor chain', () => {
  const dom = installDom();
  try {
    const target = document.querySelector('[data-qa="message-text"]');
    const chain = describeElement(target);
    assert.equal(chain[0].selector, '[data-qa="message-text"]');
    assert.ok(chain.length > 1, 'includes ancestors');
    assert.ok(chain.some((s) => s.selector === '[data-qa="message_container"]'));
  } finally {
    dom.cleanup();
  }
});

test('sits above the SlackMod button in the control strip', async () => {
  const { dom, recorded } = await mount();
  try {
    assert.equal(recorded.toolbarButtons.length, 1);
    assert.equal(recorded.toolbarButtons[0].toolbar, 'controlStrip');
    assert.equal(button(recorded).before, '#slackmod-control-button',
      'without this anchor it would land under the SlackMod button');
  } finally {
    dom.cleanup();
  }
});

test('opens and closes the panel', async () => {
  const { dom, recorded } = await mount();
  try {
    assert.equal(panel(), null);
    button(recorded).onClick();
    assert.ok(panel(), 'opened');
    button(recorded).onClick();
    assert.equal(panel(), null, 'closed');
  } finally {
    dom.cleanup();
  }
});

test('captures console output, including what was printed before opening', async () => {
  const { dom, recorded } = await mount();
  try {
    console.log('hello from a mod');
    console.error('something broke');
    button(recorded).onClick();

    const text = panel().querySelector('.sm-body').textContent;
    assert.match(text, /hello from a mod/);
    assert.match(text, /something broke/);
    assert.ok(panel().querySelector('.sm-log--error'), 'errors are marked');
  } finally {
    dom.cleanup();
  }
});

test('evaluates through the loader, not through the page', async () => {
  // Slack's CSP has no 'unsafe-eval', so the page cannot evaluate a string.
  const calls = [];
  const { dom, recorded } = await mount({
    evaluate: async (expression) => {
      calls.push(expression);
      return { value: 'ok' };
    },
  });
  try {
    button(recorded).onClick();
    const input = panel().querySelector('.sm-input input');
    input.value = '1 + 1';
    input.dispatchEvent(new dom.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((r) => setTimeout(r, 10));

    assert.deepEqual(calls, ['1 + 1']);
    assert.match(panel().querySelector('.sm-body').textContent, /ok/);
  } finally {
    dom.cleanup();
  }
});

test('shows an evaluation error rather than swallowing it', async () => {
  const { dom, recorded } = await mount({ evaluate: async () => ({ error: 'ReferenceError: nope' }) });
  try {
    button(recorded).onClick();
    const input = panel().querySelector('.sm-input input');
    input.value = 'nope';
    input.dispatchEvent(new dom.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((r) => setTimeout(r, 10));
    assert.match(panel().querySelector('.sm-body').textContent, /ReferenceError/);
  } finally {
    dom.cleanup();
  }
});

test('restores the console and removes the panel when disabled', async () => {
  const { dom, recorded } = await mount();
  try {
    const patched = console.log;
    button(recorded).onClick();
    assert.ok(panel());

    for (const dispose of recorded.disposers) dispose();

    assert.equal(panel(), null, 'panel removed');
    assert.notEqual(console.log, patched, 'console.log put back');
  } finally {
    dom.cleanup();
  }
});
