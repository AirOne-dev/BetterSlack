import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPluginShape, createTestApi, installDom } from '../../../tests/harness.mjs';

const PERMALINK = 'https://acme.slack.com/archives/C0BFQCYBRAB/p1786386808130969';

async function load() {
  const dom = installDom();
  const { api, recorded } = createTestApi();
  const plugin = (await import('./index.js')).default;
  await plugin.start(api);
  return { dom, api, recorded, plugin };
}

test('exports a plugin', async () => {
  const plugin = (await import('./index.js')).default;
  assertPluginShape(assert, plugin);
});

test('registers a reply action on messages', async () => {
  const { dom, recorded } = await load();
  try {
    assert.equal(recorded.messageActions.length, 1);
    const action = recorded.messageActions[0];
    assert.equal(action.id, 'reply');
    assert.match(action.label, /repl/i);
    assert.match(action.icon, /^<svg/i);
  } finally {
    dom.cleanup();
  }
});

test('inserts the permalink as a "." link and leaves the caret clear of it', async () => {
  const { dom, api, recorded } = await load();
  try {
    const message = api.slack.describeMessage(document.querySelector('[data-qa="message_container"]'));
    recorded.messageActions[0].onClick(message);

    assert.deepEqual(recorded.composerLink, { url: PERMALINK, text: '.' });
    // A trailing space is what stops the next typed character extending the
    // anchor, so the sent message reads ". your answer".
    assert.equal(recorded.composerText, ' ');
  } finally {
    dom.cleanup();
  }
});

test('does nothing useful, and says so, when the message has no permalink', async () => {
  const { dom, recorded } = await load();
  try {
    recorded.messageActions[0].onClick({
      element: document.createElement('div'),
      permalink: null,
      channelId: null,
      ts: null,
      text: '',
    });
    assert.equal(recorded.composerLink, undefined);
    assert.ok(
      recorded.logs.some(([level]) => level === 'warn'),
      'should warn rather than fail silently',
    );
  } finally {
    dom.cleanup();
  }
});
