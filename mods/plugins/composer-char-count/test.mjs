import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPluginShape, createTestApi, installDom } from '../../../tests/harness.mjs';
import plugin from './index.js';

const NODE_ID = 'betterslack-char-count';

function typeInComposer(text) {
  const editor = document.querySelector('.ql-editor');
  editor.innerHTML = `<p>${text}</p>`;
  // jsdom has no layout, so innerText is not populated for us.
  Object.defineProperty(editor, 'innerText', { value: text, configurable: true });
  return editor;
}

async function mount(settings = {}) {
  const dom = installDom();
  const { api, recorded } = createTestApi({ settings });
  await plugin.start(api);
  return { dom, api, recorded };
}

test('exports a plugin', () => {
  assertPluginShape(assert, plugin);
});

test('mounts a counter into the composer', async () => {
  const { dom } = await mount();
  try {
    assert.ok(document.getElementById(NODE_ID), 'counter node exists');
  } finally {
    dom.cleanup();
  }
});

test('counts characters and hides itself when empty', async () => {
  const { dom } = await mount();
  try {
    const node = document.getElementById(NODE_ID);

    typeInComposer('');
    node.textContent = '';
    // The plugin recounts on mutation; drive it the same way the observer would.
    document.querySelector('.ql-editor').dispatchEvent(new dom.dom.window.Event('input'));

    typeInComposer('hello');
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(document.getElementById(NODE_ID).textContent, '5');
    assert.equal(document.getElementById(NODE_ID).dataset.state, 'visible');
  } finally {
    dom.cleanup();
  }
});

test('warns as the message approaches Slack’s limit', async () => {
  const { dom } = await mount({ warnAt: 10 });
  try {
    typeInComposer('x'.repeat(12));
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(document.getElementById(NODE_ID).dataset.state, 'warn');
  } finally {
    dom.cleanup();
  }
});

test('flags a message that Slack would split', async () => {
  const { dom } = await mount();
  try {
    typeInComposer('x'.repeat(4001));
    await new Promise((r) => setTimeout(r, 30));
    const node = document.getElementById(NODE_ID);
    assert.equal(node.dataset.state, 'over');
    assert.match(node.textContent, /4001 \/ 4000/);
    assert.match(node.textContent, /split/i);
  } finally {
    dom.cleanup();
  }
});

test('does not count the trailing newline the editor keeps', async () => {
  const { dom } = await mount();
  try {
    typeInComposer('abc\n');
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(document.getElementById(NODE_ID).textContent, '3');
  } finally {
    dom.cleanup();
  }
});

test('cleans up after itself', async () => {
  const { dom, recorded } = await mount();
  try {
    for (const dispose of recorded.disposers) dispose();
    assert.equal(document.getElementById(NODE_ID), null);
  } finally {
    dom.cleanup();
  }
});
