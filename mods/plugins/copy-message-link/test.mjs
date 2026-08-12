import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPluginShape, createTestApi, installDom } from '../../../tests/harness.mjs';
import plugin from './index.js';

const PERMALINK = 'https://acme.slack.com/archives/C0BFQCYBRAB/p1786386808130969';

test('exports a plugin', () => {
  assertPluginShape(assert, plugin);
});

test('registers one message action', async () => {
  const dom = installDom();
  try {
    const { api, recorded } = createTestApi();
    await plugin.start(api);
    assert.equal(recorded.messageActions.length, 1);
    assert.equal(recorded.messageActions[0].id, 'copy-link');
  } finally {
    dom.cleanup();
  }
});

test('copies the permalink and confirms', async () => {
  const dom = installDom();
  try {
    const { api, recorded } = createTestApi();
    await plugin.start(api);
    await recorded.messageActions[0].onClick({ permalink: PERMALINK });

    assert.deepEqual(dom.recorded.clipboard, [PERMALINK]);
    assert.ok(recorded.toasts.some((t) => t.variant === 'success'));
  } finally {
    dom.cleanup();
  }
});

test('says so when there is no permalink', async () => {
  const dom = installDom();
  try {
    const { api, recorded } = createTestApi();
    await plugin.start(api);
    await recorded.messageActions[0].onClick({ permalink: null });

    assert.equal(dom.recorded.clipboard.length, 0);
    assert.ok(recorded.toasts.some((t) => t.variant === 'error'));
  } finally {
    dom.cleanup();
  }
});

test('reports a clipboard failure rather than pretending it worked', async () => {
  const dom = installDom();
  try {
    globalThis.navigator.clipboard.writeText = async () => {
      throw new Error('denied');
    };
    const { api, recorded } = createTestApi();
    await plugin.start(api);
    await recorded.messageActions[0].onClick({ permalink: PERMALINK });

    assert.ok(recorded.toasts.some((t) => t.variant === 'error'));
  } finally {
    dom.cleanup();
  }
});
