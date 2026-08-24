// What this mod has to get right is telling a change from a re-render, so most
// of the file is `watch.js` driven directly: no DOM, no timers, no Slack.

import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPluginShape, createTestApi, installDom } from '../../../tests/harness.mjs';
import plugin from './index.js';
import { addToLog, createWatcher } from './watch.js';

/** A screenful, in the order Slack draws it. */
const screen = (...pairs) => pairs.map(([ts, text]) => ({
  key: `C1:${ts}`, channelId: 'C1', ts, text, userId: 'U1',
}));

test('has the shape the runtime loads', () => assertPluginShape(assert, plugin));

test('a first sighting is never a change', () => {
  const watcher = createWatcher();
  assert.deepEqual(watcher.sweep(screen(['1', 'hello'], ['2', 'there'])), []);
  assert.equal(watcher.watching(), 2);
});

test('text that moves before it has settled is not an edit', () => {
  /*
   * Full Links replaces a truncated link's label with the whole URL moments
   * after the message is drawn. Read once and compared on the next sweep, that
   * is somebody editing their message, which they did not do.
   */
  const watcher = createWatcher();
  watcher.sweep(screen(['1', 'see example.com/a…']));
  assert.deepEqual(watcher.sweep(screen(['1', 'see https://example.com/a/b/c'])), []);
});

test('a change after two identical readings is an edit, with both wordings', () => {
  const watcher = createWatcher();
  watcher.sweep(screen(['1', 'ship it']));
  watcher.sweep(screen(['1', 'ship it']));
  const [change, ...rest] = watcher.sweep(screen(['1', 'ship it tomorrow']));
  assert.equal(rest.length, 0);
  assert.equal(change.kind, 'edited');
  assert.equal(change.before, 'ship it');
  assert.equal(change.after, 'ship it tomorrow');
  assert.equal(change.userId, 'U1');
});

test('an author that arrives late is taken, not lost', () => {
  // Slack draws no avatar on a follow-up message, and the one it does draw may
  // not have loaded when the first sweep reads it.
  const watcher = createWatcher();
  watcher.sweep([{ key: 'C1:1', channelId: 'C1', ts: '1', text: 'a', userId: null }]);
  watcher.sweep([{ key: 'C1:1', channelId: 'C1', ts: '1', text: 'a', userId: 'U7' }]);
  const [change] = watcher.sweep([{ key: 'C1:1', channelId: 'C1', ts: '1', text: 'b', userId: 'U7' }]);
  assert.equal(change.userId, 'U7');
});

test('scrolling is not a massacre', () => {
  /*
   * Slack's list is virtual: thirteen messages out of thousands are in the
   * document, and scrolling drops some at one end. Everything that leaves that
   * way has a missing neighbour, which is what tells it apart from a deletion.
   */
  const watcher = createWatcher();
  const first = screen(['1', 'a'], ['2', 'b'], ['3', 'c'], ['4', 'd']);
  watcher.sweep(first);
  watcher.sweep(first);
  const scrolled = screen(['3', 'c'], ['4', 'd'], ['5', 'e'], ['6', 'f']);
  assert.deepEqual(watcher.sweep(scrolled), []);
  assert.deepEqual(watcher.sweep(scrolled), []);
});

test('a gap with both neighbours still there is a deletion', () => {
  const watcher = createWatcher();
  const before = screen(['1', 'a'], ['2', 'oops'], ['3', 'c']);
  watcher.sweep(before);
  watcher.sweep(before);

  const after = screen(['1', 'a'], ['3', 'c']);
  // Once is not enough: Slack re-renders, and a message can come back.
  assert.deepEqual(watcher.sweep(after), []);

  const [change, ...rest] = watcher.sweep(after);
  assert.equal(rest.length, 0);
  assert.equal(change.kind, 'deleted');
  assert.equal(change.before, 'oops');
  assert.equal(change.ts, '2');
  // The two it sat between, so the headstone goes back where the message was.
  assert.equal(change.previousTs, '1');
  assert.equal(change.nextTs, '3');
});

test('a message that comes straight back was a re-render, not a deletion', () => {
  const watcher = createWatcher();
  const full = screen(['1', 'a'], ['2', 'b'], ['3', 'c']);
  watcher.sweep(full);
  watcher.sweep(full);
  watcher.sweep(screen(['1', 'a'], ['3', 'c']));
  assert.deepEqual(watcher.sweep(full), []);
  assert.deepEqual(watcher.sweep(full), []);
});

test('changing channel does not read as everybody deleting everything', () => {
  const watcher = createWatcher();
  const here = screen(['1', 'a'], ['2', 'b'], ['3', 'c']);
  watcher.sweep(here);
  watcher.sweep(here);
  const elsewhere = [
    { key: 'C2:9', channelId: 'C2', ts: '9', text: 'x', userId: 'U1' },
    { key: 'C2:10', channelId: 'C2', ts: '10', text: 'y', userId: 'U1' },
  ];
  assert.deepEqual(watcher.sweep(elsewhere), []);
  assert.deepEqual(watcher.sweep(elsewhere), []);
});

test('the log is newest first and never past its cap', () => {
  const log = addToLog([], [{ kind: 'edited', ts: '1' }, { kind: 'edited', ts: '2' }], 200, 1000);
  assert.deepEqual(log.map((entry) => entry.ts), ['2', '1'], 'the last change is at the top');
  assert.equal(log[0].at, 1000, 'and each carries when it was noticed');

  const capped = addToLog(log, [{ kind: 'deleted', ts: '3' }], 2, 2000);
  assert.equal(capped.length, 2);
  assert.deepEqual(capped.map((entry) => entry.ts), ['3', '2']);
});

test('puts its button in the channel header and a command in the palette', async () => {
  const dom = installDom();
  const { api, recorded } = createTestApi();
  try {
    await plugin.start(api);

    const button = recorded.toolbarButtons.find((entry) => entry.button.id === 'log');
    assert.ok(button, 'the button is registered');
    assert.equal(button.toolbar, 'channelHeader');
    assert.ok(recorded.commands.some((command) => command.id === 'open'), 'and it is in the palette');
  } finally {
    // The sweep is an interval; left running it holds the test process open.
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('the dialog says where the log lives, and offers to empty it', async () => {
  const dom = installDom();
  const { api, recorded } = createTestApi();
  try {
    await plugin.start(api);

    recorded.commands.find((command) => command.id === 'open').run();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const dialog = recorded.modals.at(-1);
    assert.ok(dialog, 'a dialog opened');
    assert.match(dialog.options.subtitle ?? '', /machine/i, 'and it says the log is local');
    assert.ok(dialog.options.actions.some((action) => action.variant === 'danger'),
      'clearing is destructive');
    assert.match(dialog.body.textContent ?? '', /nothing/i, 'and an empty log says so');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('nothing is recorded while Demo Mode is rewriting the screen', async () => {
  const dom = installDom();
  const { api, recorded } = createTestApi();
  try {
    document.documentElement.classList.add('betterslack-demo-on');
    await plugin.start(api);
    // The sweep runs once on start. With Demo Mode on it must read nothing at
    // all: every name and message on screen is invented while it is running.
    assert.equal(api.settings.get('entries', null), null);
  } finally {
    for (const dispose of recorded.disposers) dispose();
    document.documentElement.classList.remove('betterslack-demo-on');
    dom.cleanup();
  }
});
