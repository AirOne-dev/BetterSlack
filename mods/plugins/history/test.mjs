// What this mod has to get right is telling a change from a re-render, and
// then showing it. Most of the file drives the watchers and the store
// directly: no DOM, no timers, no Slack.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPluginShape, createTestApi, installDom, readModFiles } from '../../../tests/harness.mjs';
import plugin from './index.js';
import { add, GROUPS, sortRows, tally, view } from './store.js';
import { createMessageWatcher, reactionChanges } from './watch-messages.js';
import { createNameWatcher, rosterChanges, statusChanges } from './watch-names.js';

/** The mod's own folder, so `api.assets.text` finds the stylesheet it ships. */
const FILES = readModFiles(path.dirname(fileURLToPath(import.meta.url)));

/** A screenful, in the order Slack draws it. */
const screen = (...pairs) => pairs.map(([ts, text, reactions]) => ({
  key: `C1:${ts}`, channelId: 'C1', ts, text, userId: 'U1', who: 'Ada', reactions: reactions ?? {},
}));

test('has the shape the runtime loads', () => assertPluginShape(assert, plugin));

/* -- messages ------------------------------------------------------------- */

test('a first sighting is never a change', () => {
  const watcher = createMessageWatcher();
  assert.deepEqual(watcher.sweep(screen(['1', 'hello'], ['2', 'there'])), []);
  assert.equal(watcher.watching(), 2);
});

test('text that moves before it has settled is not an edit', () => {
  /*
   * Full Links replaces a truncated link's label with the whole URL moments
   * after the message is drawn. Read once and compared on the next sweep, that
   * is somebody editing their message, which they did not do.
   */
  const watcher = createMessageWatcher();
  watcher.sweep(screen(['1', 'see example.com/a…']));
  assert.deepEqual(watcher.sweep(screen(['1', 'see https://example.com/a/b/c'])), []);
});

test('a change after two identical readings is an edit, with both wordings', () => {
  const watcher = createMessageWatcher();
  watcher.sweep(screen(['1', 'ship it']));
  watcher.sweep(screen(['1', 'ship it']));
  const [change, ...rest] = watcher.sweep(screen(['1', 'ship it tomorrow']));
  assert.equal(rest.length, 0);
  assert.equal(change.kind, 'edited');
  assert.equal(change.before, 'ship it');
  assert.equal(change.after, 'ship it tomorrow');
  assert.equal(change.who, 'Ada');
});

test('scrolling is not a massacre', () => {
  /*
   * Slack's list is virtual: thirteen messages out of thousands are in the
   * document, and scrolling drops some at one end. Everything that leaves that
   * way has a missing neighbour, which is what tells it apart from a deletion.
   */
  const watcher = createMessageWatcher();
  const first = screen(['1', 'a'], ['2', 'b'], ['3', 'c'], ['4', 'd']);
  watcher.sweep(first);
  watcher.sweep(first);
  const scrolled = screen(['3', 'c'], ['4', 'd'], ['5', 'e'], ['6', 'f']);
  assert.deepEqual(watcher.sweep(scrolled), []);
  assert.deepEqual(watcher.sweep(scrolled), []);
});

test('a gap with both neighbours still there is a deletion', () => {
  const watcher = createMessageWatcher();
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
  // The two it sat between, so the headstone goes back where the message was.
  assert.equal(change.previousTs, '1');
  assert.equal(change.nextTs, '3');
});

test('a message that comes straight back was a re-render, not a deletion', () => {
  const watcher = createMessageWatcher();
  const full = screen(['1', 'a'], ['2', 'b'], ['3', 'c']);
  watcher.sweep(full);
  watcher.sweep(full);
  watcher.sweep(screen(['1', 'a'], ['3', 'c']));
  assert.deepEqual(watcher.sweep(full), []);
  assert.deepEqual(watcher.sweep(full), []);
});

test('changing channel does not read as everybody deleting everything', () => {
  const watcher = createMessageWatcher();
  const here = screen(['1', 'a'], ['2', 'b'], ['3', 'c']);
  watcher.sweep(here);
  watcher.sweep(here);
  const elsewhere = [{ key: 'C2:9', channelId: 'C2', ts: '9', text: 'x', reactions: {} }];
  assert.deepEqual(watcher.sweep(elsewhere), []);
  assert.deepEqual(watcher.sweep(elsewhere), []);
});

/* -- reactions ------------------------------------------------------------ */

test('a reaction is a count, and never a guess about who', () => {
  assert.deepEqual(reactionChanges({}, { ':tada:': 1 }).map((c) => c.kind), ['reaction-added']);
  assert.deepEqual(reactionChanges({ ':tada:': 2 }, { ':tada:': 1 }).map((c) => c.kind), ['reaction-removed']);
  assert.deepEqual(reactionChanges({ ':tada:': 1 }, {}).map((c) => c.kind), ['reaction-removed']);
  assert.deepEqual(reactionChanges({ ':tada:': 1 }, { ':tada:': 1 }), []);

  const [taken] = reactionChanges({ ':eyes:': 3 }, { ':eyes:': 1 });
  assert.equal(taken.emoji, ':eyes:');
  assert.equal(taken.before, '3');
  assert.equal(taken.after, '1');
  assert.equal(taken.who, undefined, 'Slack never says who, so neither does this');
});

test('a reaction on a message that has not settled is not reported', () => {
  const watcher = createMessageWatcher();
  watcher.sweep(screen(['1', 'a', { ':tada:': 1 }]));
  assert.deepEqual(watcher.sweep(screen(['1', 'a', { ':tada:': 2 }])).map((c) => c.kind), []);
  const [change] = watcher.sweep(screen(['1', 'a', { ':tada:': 3 }]));
  assert.equal(change.kind, 'reaction-added');
});

/* -- names and people ----------------------------------------------------- */

test('a name is only a rename once it has been read twice unchanged', () => {
  const watcher = createNameWatcher();
  const one = [{ scope: 'channel', key: 'C1', name: 'general' }];
  watcher.sweep(one);
  assert.deepEqual(watcher.sweep([{ scope: 'channel', key: 'C1', name: 'general-old' }]), []);
  watcher.sweep([{ scope: 'channel', key: 'C1', name: 'general-old' }]);
  const [change] = watcher.sweep([{ scope: 'channel', key: 'C1', name: 'announcements' }]);
  assert.equal(change.kind, 'channel-renamed');
  assert.equal(change.before, 'general-old');
  assert.equal(change.after, 'announcements');
  assert.equal(change.channelId, 'C1');
});

test('each scope reports its own kind', () => {
  const watcher = createNameWatcher();
  const settle = (scope, key, name) => {
    watcher.sweep([{ scope, key, name }]);
    watcher.sweep([{ scope, key, name }]);
  };
  settle('section', '0', 'Projets');
  settle('person', 'U9', 'jsmith');
  assert.equal(watcher.sweep([{ scope: 'section', key: '0', name: 'Produit' }])[0].kind, 'section-renamed');
  assert.equal(watcher.sweep([{ scope: 'person', key: 'U9', name: 'Julie' }])[0].kind, 'name-changed');
});

test('a roster is a difference, and the first reading is not one', () => {
  assert.deepEqual(rosterChanges('C1', 'general', undefined, ['U1', 'U2']), []);
  const changes = rosterChanges('C1', 'general', ['U1', 'U2'], ['U2', 'U3']);
  assert.deepEqual(changes.map((c) => [c.kind, c.userId]), [['joined', 'U3'], ['left', 'U1']]);
  assert.equal(changes[0].channelName, 'general');
});

test('a status nobody had before is not a change', () => {
  assert.deepEqual(statusChanges(new Map(), new Map([['U1', 'On holiday']])), []);
  const [change] = statusChanges(new Map([['U1', '']]), new Map([['U1', 'On holiday']]));
  assert.equal(change.kind, 'status-changed');
  assert.equal(change.before, '');
  assert.equal(change.after, 'On holiday');
});

/* -- the log and the page ------------------------------------------------- */

test('the log is newest first and never past its cap', () => {
  const log = add([], [{ kind: 'edited' }, { kind: 'deleted' }], 200, 1000);
  assert.deepEqual(log.map((entry) => entry.kind), ['deleted', 'edited'], 'the last change is at the top');
  assert.equal(log[0].at, 1000, 'and each carries when it was noticed');
  assert.equal(new Set(log.map((entry) => entry.id)).size, 2, 'each row can be keyed');

  const capped = add(log, [{ kind: 'joined' }], 2, 2000);
  assert.equal(capped.length, 2);
  assert.deepEqual(capped.map((entry) => entry.kind), ['joined', 'deleted']);
});

test('the search runs over everything a row draws, not one field', () => {
  const log = add([], [
    { kind: 'edited', who: 'Ada', channelName: 'general', before: 'ship it', after: 'ship it later' },
    { kind: 'joined', who: 'Bea', channelName: 'design' },
  ], 100, 1000);

  assert.equal(view(log, { query: 'ada' }).length, 1, 'by who');
  assert.equal(view(log, { query: 'design' }).length, 1, 'by where');
  assert.equal(view(log, { query: 'ship' }).length, 1, 'by what changed');
  assert.equal(view(log, { query: 'nothing here' }).length, 0);
});

test('the filters are families, and none of them means everything', () => {
  const log = add([], [{ kind: 'edited' }, { kind: 'joined' }, { kind: 'reaction-added' }], 100, 1000);
  assert.equal(view(log, { groups: [] }).length, 3);
  assert.equal(view(log, { groups: ['messages'] }).length, 1);
  assert.equal(view(log, { groups: ['messages', 'people'] }).length, 2);
  assert.deepEqual(Object.keys(GROUPS), ['messages', 'reactions', 'names', 'people']);
});

test('names sort by locale, so an accent does not file somebody after Z', () => {
  const rows = [
    { at: 3, who: 'Zoe' }, { at: 2, who: 'Élodie' }, { at: 1, who: 'Ada' },
  ];
  assert.deepEqual(sortRows(rows, 'who').map((r) => r.who), ['Ada', 'Élodie', 'Zoe']);
  assert.deepEqual(sortRows(rows, 'newest').map((r) => r.at), [3, 2, 1]);
  assert.deepEqual(sortRows(rows, 'oldest').map((r) => r.at), [1, 2, 3]);
});

test('sorting never mutates the list it was given', () => {
  const rows = [{ at: 1 }, { at: 2 }];
  sortRows(rows, 'newest');
  assert.deepEqual(rows.map((r) => r.at), [1, 2]);
});

test('the tally counts every family, for the chips', () => {
  const log = add([], [{ kind: 'edited' }, { kind: 'left' }, { kind: 'channel-renamed' }], 100, 1000);
  assert.deepEqual(tally(log), { all: 3, messages: 1, reactions: 0, names: 1, people: 1 });
});

/* -- the client ----------------------------------------------------------- */

test('puts its button in the left rail, with a shortcut and a command', async () => {
  const dom = installDom();
  const { api, recorded } = createTestApi({ files: FILES });
  try {
    await plugin.start(api);

    const button = recorded.toolbarButtons.find((entry) => entry.button.id === 'open');
    assert.ok(button, 'the button is registered');
    assert.equal(button.toolbar, 'controlStrip', 'in the rail, not on the conversation');
    assert.ok(recorded.commands.some((command) => command.id === 'open'), 'and it is in the palette');

    // The real `helpers.hotkey`, so the assertion is that the key works rather
    // than that a call was made: it registers its own listener on the document
    // and never goes through the recorded `dom.onShortcut`.
    document.dispatchEvent(new window.KeyboardEvent('keydown', {
      key: 'h', code: 'KeyH', metaKey: true, shiftKey: true, bubbles: true,
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(document.querySelector('.bsh-panel'), 'and the shortcut opens the page');
  } finally {
    document.querySelector('.bsh-scrim')?.remove();
    // The sweeps are intervals; left running they hold the test process open.
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('the page opens with its search, its filters and a way to empty it', async () => {
  const dom = installDom();
  const { api, recorded } = createTestApi({ files: FILES });
  try {
    await plugin.start(api);
    recorded.commands.find((command) => command.id === 'open').run();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const page = document.querySelector('.bsh-panel');
    assert.ok(page, 'the page is on screen');
    assert.ok(page.querySelector('input.c-input_text'), 'it wears Slack’s own field');
    assert.equal(page.querySelectorAll('.bsh-chip').length, 5, 'everything, and one chip per family');
    assert.match(page.textContent, /machine/i, 'and it says where the log lives');

    const scrim = document.querySelector('.bsh-scrim');
    assert.ok(scrim, 'behind a scrim of its own');
    // Slack ships .c-dialog at opacity 0 and fades it in itself. This is not
    // that class precisely so it cannot inherit that animation.
    assert.equal(scrim.classList.contains('c-dialog'), false);
  } finally {
    for (const dispose of recorded.disposers) dispose();
    document.querySelector('.bsh-scrim')?.remove();
    dom.cleanup();
  }
});

test('nothing is recorded while Demo Mode is rewriting the screen', async () => {
  const dom = installDom();
  const { api, recorded } = createTestApi({ files: FILES });
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
