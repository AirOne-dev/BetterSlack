// What this mod has to get right is telling a change from a re-render, and
// then showing it. Most of the file drives the watchers and the store
// directly: no DOM, no timers, no Slack.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPluginShape, createTestApi, installDom, readModFiles } from '../../../tests/harness.mjs';
import plugin from './index.js';
import { add, foldReactions, group, GROUPS, sortRows, tally, view, without } from './store.js';
import { createMessageWatcher, reactionChanges } from './watch-messages.js';
import { createNameWatcher, rosterChanges, statusChanges } from './watch-names.js';
import { catchUp, reactionDiff, snapshotOf } from './catch-up.js';
import { harvest, merge, namesFor, renderText } from './emoji.js';

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

test('the message you just wrote, deleted, is the common case and is caught', () => {
  /*
   * It is the last one in the conversation, so it has nothing after it. Asking
   * for a neighbour on both sides means never seeing the thing people actually
   * do, which is exactly what happened.
   */
  const watcher = createMessageWatcher();
  const before = screen(['1', 'a'], ['2', 'b'], ['3', 'oops']);
  watcher.sweep(before);
  watcher.sweep(before);

  const after = screen(['1', 'a'], ['2', 'b']);
  assert.deepEqual(watcher.sweep(after), [], 'not on the first sweep: Slack re-renders');

  const [change, ...rest] = watcher.sweep(after);
  assert.equal(rest.length, 0);
  assert.equal(change.kind, 'deleted');
  assert.equal(change.before, 'oops');
  assert.equal(change.previousTs, '2');
  assert.equal(change.nextTs, null, 'nothing followed it, so there is nowhere to put a headstone');
});

test('scrolling up drops from the bottom too, and is not a deletion', () => {
  // The one case that looks identical until you notice what came *in*: scrolling
  // up takes messages off the end and brings older ones in at the top.
  const watcher = createMessageWatcher();
  const first = screen(['3', 'c'], ['4', 'd'], ['5', 'e']);
  watcher.sweep(first);
  watcher.sweep(first);
  const scrolledUp = screen(['1', 'a'], ['2', 'b'], ['3', 'c']);
  assert.deepEqual(watcher.sweep(scrolledUp), []);
  assert.deepEqual(watcher.sweep(scrolledUp), []);
});

test('the oldest message leaving the top is never a deletion on its own', () => {
  // Scrolling down does this constantly, so the top of the window keeps the
  // strict rule: both neighbours, or nothing.
  const watcher = createMessageWatcher();
  const first = screen(['1', 'a'], ['2', 'b'], ['3', 'c']);
  watcher.sweep(first);
  watcher.sweep(first);
  const trimmed = screen(['2', 'b'], ['3', 'c']);
  assert.deepEqual(watcher.sweep(trimmed), []);
  assert.deepEqual(watcher.sweep(trimmed), []);
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

/** A tally as the sweep reads it: the count, and the picture Slack drew. */
const pills = (entries) => Object.fromEntries(
  Object.entries(entries).map(([emoji, count]) => [emoji, { count, url: `https://e/${emoji}.png` }]),
);

test('a reaction is a count, and never a guess about who', () => {
  assert.deepEqual(reactionChanges(pills({}), pills({ ':tada:': 1 })).map((c) => c.kind), ['reaction-added']);
  assert.deepEqual(reactionChanges(pills({ ':tada:': 2 }), pills({ ':tada:': 1 })).map((c) => c.kind), ['reaction-removed']);
  assert.deepEqual(reactionChanges(pills({ ':tada:': 1 }), pills({})).map((c) => c.kind), ['reaction-removed']);
  assert.deepEqual(reactionChanges(pills({ ':tada:': 1 }), pills({ ':tada:': 1 })), []);

  const [taken] = reactionChanges(pills({ ':eyes:': 3 }), pills({ ':eyes:': 1 }));
  assert.equal(taken.emoji, ':eyes:');
  assert.equal(taken.before, '3');
  assert.equal(taken.after, '1');
  assert.equal(taken.who, undefined, 'Slack never says who, so neither does this');
});

test('the picture travels with the reaction, because the name cannot be turned back into one', () => {
  /*
   * `:raised_hands::skin-tone-2:` is two shortcodes run together, and a custom
   * emoji is a name only one workspace knows. Printed as its name the row read
   * exactly that, which is a rendering that failed.
   */
  const [gone] = reactionChanges(pills({ ':raised_hands::skin-tone-2:': 1 }), pills({}));
  assert.equal(gone.emojiUrl, 'https://e/:raised_hands::skin-tone-2:.png',
    'the one Slack had already drawn, kept even though the reaction is gone');
});

test('a reaction on a message that has not settled is not reported', () => {
  const watcher = createMessageWatcher();
  watcher.sweep(screen(['1', 'a', pills({ ':tada:': 1 })]));
  assert.deepEqual(watcher.sweep(screen(['1', 'a', pills({ ':tada:': 2 })])).map((c) => c.kind), []);
  const [change] = watcher.sweep(screen(['1', 'a', pills({ ':tada:': 3 })]));
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

/* -- what changed while nobody was looking --------------------------------- */

/** What `conversations.history` answers, measured against a live workspace. */
const said = (ts, text, extra = {}) => ({ ts, user: 'U1', text, ...extra });

test('a first visit is the baseline, never a hundred events', () => {
  // Opening a busy channel for the first time would otherwise write a row for
  // everything that happened before this mod existed.
  assert.deepEqual(catchUp(null, [said('3', 'a'), said('2', 'b')], { channelId: 'C1', channelName: 'general' }), []);
});

test('an edit made while you were elsewhere is caught, with both wordings', () => {
  const before = snapshotOf([said('2', 'ship it'), said('1', 'hello')]);
  const [change, ...rest] = catchUp(before, [said('2', 'ship it tomorrow'), said('1', 'hello')],
    { channelId: 'C1', channelName: 'general' });
  assert.equal(rest.length, 0);
  assert.equal(change.kind, 'edited');
  assert.equal(change.before, 'ship it');
  assert.equal(change.after, 'ship it tomorrow');
  assert.equal(change.channelName, 'general');
});

test('a message that is gone from a page that reaches it was deleted', () => {
  const before = snapshotOf([said('3', 'c'), said('2', 'oops'), said('1', 'a')]);
  const [change] = catchUp(before, [said('3', 'c'), said('1', 'a')], { channelId: 'C1', channelName: null });
  assert.equal(change.kind, 'deleted');
  assert.equal(change.before, 'oops');
});

test('a message older than the page is out of the window, not deleted', () => {
  /*
   * `conversations.history` answers one page. Everything before it is missing
   * from the answer and present in the channel, and calling that a deletion
   * empties somebody's history into the log every time they open it.
   */
  const before = snapshotOf([said('9', 'recent'), said('1', 'ancient')]);
  assert.deepEqual(catchUp(before, [said('9', 'recent')], { channelId: 'C1', channelName: null }), []);
});

test('Slack says who reacted here, so the log says it too', () => {
  // The one thing the screen-reading half refuses to claim: Slack only says it
  // there in a tooltip, in the reader's language, with names rather than ids.
  const before = snapshotOf([said('1', 'a', { reactions: [{ name: 'tada', users: ['U1', 'U2'], count: 2 }] })]);
  const [change] = catchUp(before, [said('1', 'a', { reactions: [{ name: 'tada', users: ['U1'], count: 1 }] })],
    { channelId: 'C1', channelName: null });
  assert.equal(change.kind, 'reaction-removed');
  assert.equal(change.emoji, ':tada:');
  assert.equal(change.userId, 'U2', 'and names the person who took it back');
});

test('a count that moves with nobody named is still recorded', () => {
  // Slack truncates `users` on a reaction with a great many of them.
  const [change, ...rest] = reactionDiff(
    { tada: { count: 40, users: ['U1'] } },
    { tada: { count: 41, users: ['U1'] } },
  );
  assert.equal(rest.length, 0);
  assert.equal(change.kind, 'reaction-added');
  assert.equal(change.userId, undefined, 'nobody to attribute it to, and it does not invent one');
});

test('the same event seen by both halves is written once', () => {
  const seen = { kind: 'reaction-removed', channelId: 'C1', ts: '1', emoji: ':tada:', userId: 'U2', after: '1' };
  const log = add([], [seen], 100, 1000);
  assert.equal(log.length, 1);
  // The screen catches it live; the next catch-up compares against a snapshot
  // from before it happened and finds it again.
  assert.equal(add(log, [{ ...seen }], 100, 2000).length, 1);
  assert.equal(add(log, [{ ...seen, ts: '2' }], 100, 2000).length, 2, 'a different message is a different event');
});

/* -- emoji ----------------------------------------------------------------- */

test('the name-to-picture table is harvested from what Slack drew', () => {
  /*
   * A shortcode cannot be drawn from its name: Slack serves a standard emoji by
   * codepoint, and `emoji.list` answers with the workspace's custom ones only.
   * Its own DOM is the table nobody publishes.
   */
  const dom = installDom();
  try {
    const host = document.createElement('div');
    host.innerHTML = '<img data-stringify-emoji=":tada:" src="https://e/1f389.png">'
      + '<span data-stringify-emoji="rocket"><img src="https://e/1f680.png"></span>'
      + '<img data-stringify-emoji="broken">';
    assert.deepEqual(harvest(host), { tada: 'https://e/1f389.png', rocket: 'https://e/1f680.png' },
      'colons trimmed, a nested image found, one with no source left out');
  } finally {
    dom.cleanup();
  }
});

test('the table keeps what you use and drops what you met once', () => {
  const full = merge({}, { a: '1', b: '2', c: '3' }, 3);
  // Seeing `a` again moves it to the end, so the cap takes `b` rather than it.
  const again = merge(full, { a: '1', d: '4' }, 3);
  assert.deepEqual(Object.keys(again), ['c', 'a', 'd']);
});

test('a skin tone is tried whole, then without', () => {
  assert.deepEqual(namesFor(':raised_hands::skin-tone-2:'), ['raised_hands::skin-tone-2', 'raised_hands']);
  assert.deepEqual(namesFor('tada'), ['tada']);
  assert.deepEqual(namesFor(''), []);
});

test('a message keeps its words and gains its pictures', () => {
  const dom = installDom();
  try {
    const known = (name) => (name === 'slightly_smiling_face' ? 'https://e/1f642.png' : null);
    const out = document.createElement('div');
    out.append(renderText(document, 'merci :slightly_smiling_face: et :inconnu: aussi', known));

    assert.equal(out.querySelectorAll('img').length, 1);
    assert.equal(out.querySelector('img').src, 'https://e/1f642.png');
    // Words are text nodes, never parsed as markup: they are somebody's message.
    assert.equal(out.textContent, 'merci  et :inconnu: aussi');
    assert.match(out.innerHTML, /merci/, 'and a shortcode nothing can draw is left as written');
  } finally {
    dom.cleanup();
  }
});

test('a message that is only an emoji is not left empty', () => {
  const dom = installDom();
  try {
    const out = document.createElement('div');
    out.append(renderText(document, ':tada:', () => 'https://e/1f389.png'));
    assert.equal(out.querySelectorAll('img').length, 1);
    assert.equal(out.childNodes.length, 1);
  } finally {
    dom.cleanup();
  }
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

test('ten reactions on one message are one card, not ten rows', () => {
  /*
   * The shape that made the view unreadable: a message picking up reactions was
   * a row per person, each repeating the time, the channel and a count, and
   * none of them saying which message.
   */
  const log = add([], [
    { kind: 'reaction-added', channelId: 'C1', ts: '9', emoji: ':tada:', userId: 'U1', subject: 'ship it', subjectUser: 'U9' },
    { kind: 'reaction-added', channelId: 'C1', ts: '9', emoji: ':tada:', userId: 'U2', subject: 'ship it', subjectUser: 'U9' },
    { kind: 'reaction-removed', channelId: 'C1', ts: '9', emoji: ':eyes:', userId: 'U3', subject: 'ship it', subjectUser: 'U9' },
    { kind: 'channel-renamed', before: 'a', after: 'b' },
  ], 100, 1000);

  const cards = group(log);
  assert.equal(cards.length, 2, 'one card for the message, one for the rename');

  const message = cards.find((card) => card.ts === '9');
  assert.equal(message.events.length, 3);
  assert.equal(message.subject, 'ship it', 'and the card knows which message it is about');
  assert.equal(message.subjectUser, 'U9', 'whose author is not whoever reacted');

  const { reactions, rest } = foldReactions(message.events);
  assert.equal(rest.length, 0);
  assert.equal(reactions.length, 2, 'one line per emoji and direction');
  assert.deepEqual(
    reactions.find((r) => r.kind === 'reaction-added').people.map((p) => p.id).sort(),
    ['U1', 'U2'],
    'with the people listed rather than repeated');
});

test('a rename and a status never share a card', () => {
  // Neither has a message behind it, so gathering them together would file
  // unrelated things under one heading.
  const log = add([], [
    { kind: 'status-changed', userId: 'U1', after: 'away' },
    { kind: 'status-changed', userId: 'U2', after: 'lunch' },
  ], 100, 1000);
  assert.equal(group(log).length, 2);
});

test('the search reaches the message a reaction was about', () => {
  const log = add([], [
    { kind: 'reaction-added', channelId: 'C1', ts: '9', emoji: ':tada:', subject: 'la grande poubelle' },
  ], 100, 1000);
  assert.equal(view(log, { query: 'poubelle' }).length, 1);
});

test('forgetting one card takes its whole run out and leaves the rest', () => {
  // A card is several events, so forgetting it is forgetting the run of them
  // that belong to the same message -- not the one line under the pointer.
  const log = add([], [
    { kind: 'reaction-added', channelId: 'C1', ts: '9', emoji: ':tada:', userId: 'U1' },
    { kind: 'reaction-removed', channelId: 'C1', ts: '9', emoji: ':tada:', userId: 'U2' },
    { kind: 'edited', channelId: 'C1', ts: '4', before: 'a', after: 'b' },
    { kind: 'channel-renamed', before: 'x', after: 'y' },
  ], 100, 1000);

  const cards = group(log);
  const busy = cards.find((card) => card.ts === '9');
  const left = without(log, busy);

  assert.equal(left.length, 2, 'both of that message’s events go');
  assert.equal(group(left).length, 2, 'and the other two cards stay');
  assert.deepEqual(without(left, null), left, 'nothing to forget changes nothing');
});

/* -- the client ----------------------------------------------------------- */

test('takes a tab in Slack’s rail, beside Slack’s own', async () => {
  const dom = installDom();
  const { api, recorded } = createTestApi({ files: FILES });
  try {
    await plugin.start(api);

    const tab = document.querySelector('.betterslack-view-tab');
    assert.ok(tab, 'the tab is in the rail');
    assert.ok(tab.closest('.p-tab_rail__tab_menu'), 'beside Slack’s own tabs, not somewhere else');
    assert.ok(tab.classList.contains('p-tab_rail__button'), 'wearing Slack’s class, so it follows every theme');
    assert.equal(tab.getAttribute('aria-selected'), 'false', 'and lit only when you are on it');
    assert.ok(recorded.commands.some((command) => command.id === 'open'), 'and it is in the palette');

    // The real `helpers.hotkey`, so the assertion is that the key works rather
    // than that a call was made: it registers its own listener on the document
    // and never goes through the recorded `dom.onShortcut`.
    document.dispatchEvent(new window.KeyboardEvent('keydown', {
      key: 'h', code: 'KeyH', metaKey: true, shiftKey: true, bubbles: true,
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(document.querySelector('.betterslack-view'), 'and the shortcut opens the view');
  } finally {
    // The sweeps are intervals; left running they hold the test process open.
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('one tab is lit at a time, and Slack’s goes out while you are here', async () => {
  const dom = installDom();
  const { api, recorded } = createTestApi({ files: FILES });
  try {
    await plugin.start(api);
    const mine = document.querySelector('.betterslack-view-tab');
    const slacks = document.querySelector('[data-qa="tab_rail_home_button"]');
    assert.equal(slacks.classList.contains('p-tab_rail__button--active'), true, 'Slack starts on Home');

    mine.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(mine.getAttribute('aria-selected'), 'true', 'mine lights up');
    assert.equal(slacks.classList.contains('p-tab_rail__button--active'), false, 'and Slack’s goes out');

    // Slack's tabs do not toggle: clicking the one you are on does nothing,
    // and leaving is choosing somewhere else.
    mine.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(mine.getAttribute('aria-selected'), 'true', 'clicking it again does not close it');

    /*
     * Leaving is clicking one of Slack's, and that has to work with no route
     * change behind it: clicking Accueil while you are already on a channel
     * navigates nowhere, and a view that only listened for navigation stayed
     * over the thing you had just asked to see.
     */
    slacks.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(mine.getAttribute('aria-selected'), 'false');
    assert.equal(slacks.classList.contains('p-tab_rail__button--active'), true, 'and Slack’s comes back exactly as it was');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('the view opens where Slack renders its own views, not over the middle', async () => {
  const dom = installDom();
  const { api, recorded } = createTestApi({ files: FILES });
  try {
    await plugin.start(api);
    recorded.commands.find((command) => command.id === 'open').run();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const view = document.querySelector('.betterslack-view');
    assert.ok(view, 'the view is on screen');
    /*
     * The whole tab panel, channel sidebar included, which is what Activité and
     * Fichiers take. Over the conversation alone it is a page with Slack's
     * channel list still down its left-hand side.
     */
    const panel = view.closest('.p-client_workspace__tabpanel');
    assert.ok(panel, 'inside Slack’s own tab panel');
    assert.ok(panel.querySelector('[data-qa="channel-sidebar"]'), 'which is what holds the channel list');
    assert.ok(view.querySelector('input.c-input_text'), 'it wears Slack’s own field');
    assert.equal(view.querySelectorAll('.bsh-tab').length, 5, 'everything, and one tab per family');
    assert.match(view.textContent, /machine/i, 'and it says where the log lives');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('the sort menu hands api.ui.menu an onSelect, which is what it reads', async () => {
  const dom = installDom();
  const { api, recorded } = createTestApi({ files: FILES });
  try {
    await plugin.start(api);
    recorded.commands.find((command) => command.id === 'open').run();
    await new Promise((resolve) => setTimeout(resolve, 0));

    document.querySelector('.bsh-sort').click();
    const menu = recorded.menus.at(-1);
    assert.ok(menu, 'a menu opened');
    // Three, not five. Grouping by message made "by kind" and "by who" answer a
    // question the cards no longer ask -- a card is several kinds and several
    // people at once.
    assert.equal(menu.items.length, 3, 'one entry per sort');
    // `onClick` here parses, renders, and silently does nothing: the runtime's
    // menu calls `onSelect`. That was a real bug, and this is why it stays.
    for (const item of menu.items) {
      assert.equal(typeof item.onSelect, 'function', `"${item.label}" must be selectable`);
    }

    menu.items.find((item) => item.label.match(/ancien|oldest/i)).onSelect();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(document.querySelector('.bsh-sort').textContent, /ancien|oldest/i,
      'and the button says what it is sorted by');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('the badge counts what somebody took back, not everything that moved', async () => {
  const dom = installDom();
  const { api, recorded } = createTestApi({
    files: FILES,
    settings: {
      openedAt: 1,
      entries: [
        { id: '1', kind: 'edited', at: 10 },
        { id: '2', kind: 'deleted', at: 11 },
        { id: '3', kind: 'reaction-removed', at: 12 },
        { id: '4', kind: 'joined', at: 13 },
        { id: '5', kind: 'section-renamed', at: 14 },
        { id: '6', kind: 'status-changed', at: 15 },
      ],
    },
  });
  try {
    await plugin.start(api);
    // The harness registers a view under its own plugin id, so the badge's own
    // id carries that rather than "history". What matters is that it is there,
    // on the tab, saying the right number.
    const badge = document.querySelector('[id^="betterslack-badge-"]');
    assert.ok(badge, 'the badge is on the tab');
    assert.ok(badge.closest('.betterslack-view-tab'), 'on the tab in the rail');
    // Three of the six: a workspace renames and greets all day, and a tab
    // wearing a permanent number is a tab nobody reads.
    assert.equal(badge.textContent, '3');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('and counts nothing at all when it is told to', async () => {
  const dom = installDom();
  const { api, recorded } = createTestApi({
    files: FILES,
    settings: { badgeFor: 'none', openedAt: 1, entries: [{ id: '1', kind: 'deleted', at: 10 }] },
  });
  try {
    await plugin.start(api);
    const badge = document.querySelector('[id^="betterslack-badge-"]');
    assert.equal(badge?.hasAttribute('hidden'), true);
  } finally {
    for (const dispose of recorded.disposers) dispose();
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
