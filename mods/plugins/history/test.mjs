// What this mod has to get right is telling a change from a re-render, and
// then showing it. Most of the file drives the watchers and the store
// directly: no DOM, no timers, no Slack.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPluginShape, createTestApi, installDom, readModFiles, switchWorkspace } from '../../../tests/harness.mjs';
import plugin from './index.js';
import { add, foldReactions, group, GROUPS, sortRows, tally, view, without } from './store.js';
import { createNameWatcher, rosterChanges, statusChanges } from './watch-names.js';
import { catchUp, reactionDiff, snapshotOf } from './catch-up.js';
import { harvest, merge, namesFor } from './emoji.js';

/** The mod's own folder, so `api.assets.text` finds the stylesheet it ships. */
const FILES = readModFiles(path.dirname(fileURLToPath(import.meta.url)));

/** A screenful, in the order Slack draws it. */
const screen = (...pairs) => pairs.map(([ts, text, reactions]) => ({
  key: `C1:${ts}`, channelId: 'C1', ts, text, userId: 'U1', who: 'Ada', reactions: reactions ?? {},
}));

test('has the shape the runtime loads', () => assertPluginShape(assert, plugin));

/* -- messages ------------------------------------------------------------- */

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

test('a reaction nobody can be named for is not written down', () => {
  /*
   * Slack truncates `users` on a reaction with a great many of them, so the
   * ids can stay identical while the count moves. "Someone took a reaction
   * back" answers the only question it raises with a shrug, so it is not a
   * row -- and this is the rule the whole mod now follows, which is why the
   * screen-reading half hands its sightings here instead of recording them.
   */
  assert.deepEqual(reactionDiff(
    { tada: { count: 40, users: ['U1'] } },
    { tada: { count: 41, users: ['U1'] } },
  ), []);

  // And every event this does produce carries the person it belongs to.
  const events = reactionDiff(
    { tada: { count: 1, users: ['U1'] } },
    { tada: { count: 2, users: ['U2', 'U3'] } },
  );
  assert.equal(events.length, 3, 'one left, two arrived');
  assert.ok(events.every((event) => event.userId), 'and each one names somebody');
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

test('a message is drawn as Slack draws it, not as it came off the wire', () => {
  /*
   * The renderer is the runtime's -- the command palette draws its rows with
   * the same one -- so what this covers is that a card actually goes through
   * it: a mention as `<@U…>`, a link as `<url|label>` and an escaped ampersand
   * are what `conversations.history` sends, and a log of those is a log of
   * wire format.
   */
  const dom = installDom();
  const { api } = createTestApi({ files: FILES });
  try {
    const out = document.createElement('div');
    out.append(api.slack.renderMrkdwn(
      'joyeux anniversaire à <@U04ED8UPV> dans <#C01|tech> &amp; :tada: <https://x.test/a|le lien>',
      {
        userName: (id) => (id === 'U04ED8UPV' ? 'Ludo' : null),
        emojiUrl: () => 'https://e/1f389.png',
      },
    ));

    assert.match(out.textContent, /@Ludo/, 'the mention is a name');
    assert.match(out.textContent, /#tech/, 'and the channel is its name');
    assert.match(out.textContent, /&/, 'and the ampersand is an ampersand');
    assert.match(out.textContent, /le lien/, 'and the link is its label');
    assert.equal(out.querySelectorAll('img').length, 1, 'and the emoji is a picture');
    // Words are text nodes, never parsed as markup: they are somebody's message.
    assert.doesNotMatch(out.innerHTML, /&lt;@U04ED8UPV&gt;/);
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
    { kind: 'reaction-added', channelId: 'C1', ts: '9', emoji: ':tada:', userId: 'U1', subject: 'la grande poubelle' },
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
        { id: '3', kind: 'reaction-removed', at: 12, userId: 'U1' },
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

test('a deletion caught while you were away knows where it was', () => {
  // The screen-reading half learns the neighbours from the order it drew them
  // in; here they come from the conversation itself, so the line goes back
  // where the message was rather than nowhere at all.
  const before = snapshotOf([said('3', 'c'), said('2', 'gone'), said('1', 'a')]);
  const [change] = catchUp(before, [said('3', 'c'), said('1', 'a')],
    { channelId: 'C1', channelName: null });
  assert.equal(change.kind, 'deleted');
  assert.equal(change.previousTs, '1');
  assert.equal(change.nextTs, '3');
});

test('a deleted message leaves a line with the face and the name on it', async () => {
  /*
   * A struck-through sentence and nothing else is a sentence floating in a
   * conversation with no way to tell whose it was, which is the first thing
   * anybody asks. The author is known -- off the avatar when the screen caught
   * it, off `conversations.history` when the catch-up did -- so the line is
   * shaped like the message it replaces.
   */
  const dom = installDom();
  const { api, recorded } = createTestApi({
    files: FILES,
    settings: {
      entries: [{
        id: '1',
        kind: 'deleted',
        at: 10,
        channelId: 'C0BFQCYBRAB',
        ts: '1786386800.000000',
        nextTs: '1786386808.130969',
        before: 'the one that went :tada:',
        userId: 'U0EXAMPLE2',
      }],
    },
    web: {
      users: async () => new Map([['U0EXAMPLE2', {
        id: 'U0EXAMPLE2',
        profile: { display_name: 'Ludo', image_72: 'https://ca.slack-edge.com/T-U-abc.png' },
      }]]),
    },
  });
  try {
    await plugin.start(api);
    const stone = document.querySelector('.bsh-stone');
    assert.ok(stone, 'the line is where the message was');
    assert.equal(stone.nextElementSibling?.getAttribute('data-msg-ts'), '1786386808.130969',
      'in front of the message that followed it');

    // The name arrives with the answer to `users.info`, so it is not there on
    // the first frame and must not stay missing after it.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const redrawn = document.querySelector('.bsh-stone');
    assert.match(redrawn.querySelector('.bsh-stone__who').textContent, /Ludo/);
    assert.match(redrawn.querySelector('.bsh-stone__text').textContent, /the one that went/);

    /*
     * And it wears Slack's own message markup, because that is what a theme
     * styles the client through: Discord's rounds every avatar via
     * `.c-message_kit__avatar img`, and a square face in a column of circles
     * reads as broken rather than as a mod.
     */
    assert.ok(redrawn.querySelector('.c-message_kit__gutter'), 'Slack’s gutter');
    assert.ok(redrawn.querySelector('.c-message_kit__avatar img'), 'the avatar a theme reaches for');
    assert.ok(redrawn.querySelector('.c-message__sender'), 'and Slack’s sender');
    /*
     * But not its `data-qa`. That is what every mod here matches messages on,
     * this one included, so a headstone wearing it would be read back as a
     * message -- swept, compared, and reported as deleted when it came off.
     */
    assert.equal(redrawn.getAttribute('data-qa'), null);
    assert.equal(redrawn.querySelector('[data-qa]'), null);

    /*
     * And nothing this mod drew inside Slack's own markup outlives it. The
     * runtime's cleanup takes back the stylesheet, the poll and the tab, so a
     * headstone left behind would sit in the conversation as an unstyled
     * sentence with nothing able to remove it -- which is what a hot reload or
     * switching the mod off does every time.
     */
    await plugin.stop();
    assert.equal(document.querySelector('.bsh-stone'), null, 'the line goes with the mod');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('the last message in a conversation leaves its line at the bottom', async () => {
  /*
   * It has nothing after it, so it hangs under the one before and sits where it
   * was. Which message that is comes from what is drawn now, not from the
   * neighbours the deletion was recorded with: those were written from the
   * screen at the moment the message went and cannot be corrected afterwards,
   * and an anchor on the wrong side of the message puts the line in the middle
   * of the day before -- which reads as a bug in a way that a missing line
   * does not.
   */
  const dom = installDom();
  const { api, recorded } = createTestApi({
    files: FILES,
    settings: {
      entries: [{
        id: '1',
        kind: 'deleted',
        at: 10,
        channelId: 'C0BFQCYBRAB',
        // Newer than the one message the fixture draws, which is therefore the
        // one before it. The stored neighbours are both wrong, and both are
        // older than the message itself -- the shape a scrambled order leaves
        // behind, and the reason the placement does not read them.
        ts: '1786386900.000000',
        previousTs: '1786387000.000000',
        nextTs: '1786386700.000000',
        before: 'the last thing anybody said',
        userId: 'U0EXAMPLE2',
      }],
    },
  });
  try {
    await plugin.start(api);
    const stone = document.querySelector('.bsh-stone');
    assert.ok(stone, 'the line is on screen');
    assert.equal(stone.previousElementSibling?.getAttribute('data-msg-ts'), '1786386808.130969',
      'under the message it followed, not above one from before it');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('a conversation you never opened is recorded, from Slack’s own socket', async () => {
  /*
   * The mod's whole limit, lifted. Reading the screen only ever knew what was
   * drawn, and the catch-up only ever knew the channels you visited -- so
   * "why is this not in my history" was answered by "you were elsewhere".
   *
   * Slack keeps a socket per workspace and pushes a message, an edit, a
   * deletion and a reaction for every conversation you are in, open or not.
   * And listening marks nothing read: Slack marks a conversation read when its
   * client sends `conversations.mark`, and being told a message exists sends
   * nothing at all.
   */
  const dom = installDom();
  const { api, recorded } = createTestApi({ files: FILES, settings: { people: false } });
  try {
    await plugin.start(api);
    /*
     * What the loader is told to forward, which a reviewer should be able to
     * read off a mod's tests: asking for `message` is asking to be handed
     * every message in every conversation this account is in.
     */
    assert.deepEqual(recorded.watching, [
      'channel_archive', 'channel_created', 'channel_deleted', 'channel_rename',
      'channel_unarchive', 'group_archive', 'group_rename', 'group_unarchive',
      'member_joined_channel', 'member_left_channel', 'message',
      'reaction_added', 'reaction_removed', 'user_change',
    ]);

    // A channel in a workspace this window is not even showing.
    recorded.emitSlackEvent({
      type: 'message', channel: 'C0FARAWAY', ts: '100.000100', user: 'U1', text: 'the first wording',
    });
    recorded.emitSlackEvent({
      type: 'message',
      subtype: 'message_changed',
      channel: 'C0FARAWAY',
      previous_message: { ts: '100.000100', user: 'U1', text: 'the first wording' },
      message: { ts: '100.000100', user: 'U1', text: 'the second wording' },
    });
    recorded.emitSlackEvent({
      type: 'reaction_removed', channel: 'C0FARAWAY', user: 'U2',
      reaction: 'tada', item: { type: 'message', channel: 'C0FARAWAY', ts: '100.000100' },
    });
    recorded.emitSlackEvent({
      type: 'message',
      subtype: 'message_deleted',
      channel: 'C0FARAWAY',
      deleted_ts: '100.000100',
      previous_message: { ts: '100.000100', user: 'U1', text: 'the second wording' },
    });

    // The log is written through a debounce, which is what keeps a busy
    // channel from rewriting the settings file on every frame.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const log = api.settings.get('entries', []);
    const kinds = log.map((entry) => entry.kind).sort();
    assert.deepEqual(kinds, ['deleted', 'edited', 'reaction-removed']);

    const edit = log.find((entry) => entry.kind === 'edited');
    assert.equal(edit.before, 'the first wording', 'both wordings, which Slack sends');
    assert.equal(edit.after, 'the second wording');
    assert.equal(edit.channelId, 'C0FARAWAY');

    const took = log.find((entry) => entry.kind === 'reaction-removed');
    assert.equal(took.userId, 'U2', 'and the socket names who, which the screen never can');
    assert.equal(took.ts, '100.000100', 'about the message, not about the moment');

    assert.equal(log.find((entry) => entry.kind === 'deleted').before, 'the second wording');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('an unfurl arriving is not an edit', async () => {
  // Slack sends `message_changed` for things nobody edited -- a link preview
  // attaching is one -- so the words have to have actually moved.
  const dom = installDom();
  const { api, recorded } = createTestApi({ files: FILES, settings: { people: false } });
  try {
    await plugin.start(api);
    recorded.emitSlackEvent({
      type: 'message',
      subtype: 'message_changed',
      channel: 'C0FARAWAY',
      previous_message: { ts: '100.000100', user: 'U1', text: 'look: https://x.test' },
      message: { ts: '100.000100', user: 'U1', text: 'look: https://x.test', attachments: [{}] },
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.deepEqual(api.settings.get('entries', []), []);
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('what belongs to a workspace is dropped when the workspace changes', async () => {
  /*
   * Switching workspace does not reload the client: same page, same mod, same
   * objects, new team in the address. Two workspaces can use the same channel
   * id as well, so a member list or a snapshot kept across a switch is
   * compared against the wrong conversation -- which reads as everybody
   * leaving and a different everybody arriving.
   *
   * The log itself stays. It names the workspace's channels and is the whole
   * point of the mod.
   */
  const dom = installDom();
  const { api, recorded } = createTestApi({ files: FILES, settings: { people: false } });
  try {
    await plugin.start(api);
    assert.ok(recorded.teamListeners.length > 0, 'it asked to hear about the switch');

    recorded.emitSlackEvent({
      type: 'message', channel: 'C0SHARED', ts: '10.000100', user: 'U1', text: 'the first wording',
    });
    switchWorkspace(dom, 'T0OTHER');

    // The same channel id in the other workspace, deleted. What it said here
    // must not be handed over as what it said there.
    recorded.emitSlackEvent({
      type: 'message', subtype: 'message_deleted', channel: 'C0SHARED', deleted_ts: '10.000100',
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.deepEqual(api.settings.get('entries', []), [],
      'nothing invented from the workspace that was left');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('a sidebar section is told apart by Slack’s id for it, never by its place', async () => {
  /*
   * Keyed by position, anything that reorders the list reads as a rename --
   * dragging a section, collapsing one, and above all switching workspace,
   * where the sections are different sections entirely and every index lands
   * on somebody else's heading. Measured on a live sidebar: every heading
   * carries `data-qa-channel-sidebar-section-heading`, an `L…` for one you
   * made and `channels` / `direct_messages` / `recent_apps` for Slack's own.
   */
  const watcher = createNameWatcher();
  const sections = (...pairs) => pairs.map(([key, name]) => ({ scope: 'section', key, name }));

  const first = sections(['T1:channels', 'Canaux'], ['T1:L05', 'Tech'], ['T1:direct_messages', 'Messages directs']);
  watcher.sweep(first);
  watcher.sweep(first);

  // The same sections, drawn in another order: nothing was renamed.
  assert.deepEqual(watcher.sweep(sections(
    ['T1:direct_messages', 'Messages directs'], ['T1:channels', 'Canaux'], ['T1:L05', 'Tech'],
  )), []);

  // And another workspace's sections are not these ones under new names.
  assert.deepEqual(watcher.sweep(sections(['T2:channels', 'Channels'], ['T2:L99', 'Design'])), []);

  // What a rename actually is: the same section, called something else.
  const renamed = sections(['T1:L05', 'Tech'], ['T1:channels', 'Canaux'], ['T1:direct_messages', 'Messages directs']);
  watcher.sweep(renamed);
  const [change, ...rest] = watcher.sweep(sections(
    ['T1:L05', 'Engineering'], ['T1:channels', 'Canaux'], ['T1:direct_messages', 'Messages directs'],
  ));
  assert.equal(rest.length, 0);
  assert.equal(change.kind, 'section-renamed');
  assert.equal(change.before, 'Tech');
  assert.equal(change.after, 'Engineering');
});

test('a deleted message is its words with a tag, not a sentence about them', async () => {
  // "Deleted — this is what it said", printed above the words it was talking
  // about, is a caption for something already on screen. The conversation
  // marks one with a tag and a line through it; so does this.
  const dom = installDom();
  const { api, recorded } = createTestApi({
    files: FILES,
    settings: {
      people: false,
      entries: [{
        id: '1', kind: 'deleted', at: 10, channelId: 'C1', ts: '9',
        before: 'the words that went', subject: 'the words that went', userId: 'U1', subjectUser: 'U1',
      }],
    },
  });
  try {
    await plugin.start(api);
    recorded.commands.find((command) => command.id === 'open').run();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const card = document.querySelector('.bsh-card');
    assert.ok(card, 'the card is drawn');
    assert.match(card.querySelector('.bsh-tag--gone').textContent, /supprim|deleted/i);
    assert.ok(card.querySelector('.bsh-said--gone'), 'and the words carry the line through');
    assert.match(card.textContent, /the words that went/);
    assert.doesNotMatch(card.textContent, /voici ce qu|this is what it said/i);
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('an app rewriting its own message is not somebody taking something back', async () => {
  /*
   * The loudest thing on Slack's socket: a deploy status moving through its
   * stages, an alert resolving, a bot rewriting the same line six times a
   * minute. Every one is an edit and none of them is news, and they arrive far
   * faster than anything a person does -- so a log that keeps them is a log
   * with nothing else visible in it.
   *
   * Only an app's own changes. A person reacting to an alert is still a person.
   */
  const dom = installDom();
  const { api, recorded } = createTestApi({ files: FILES, settings: { people: false } });
  try {
    await plugin.start(api);
    recorded.emitSlackEvent({
      type: 'message', subtype: 'bot_message', channel: 'C1', ts: '1.000100',
      bot_id: 'B0DEPLOY', username: 'Deploy', text: 'building',
    });
    recorded.emitSlackEvent({
      type: 'message', subtype: 'message_changed', channel: 'C1',
      previous_message: { ts: '1.000100', bot_id: 'B0DEPLOY', text: 'building' },
      message: { ts: '1.000100', bot_id: 'B0DEPLOY', text: 'deployed' },
    });
    recorded.emitSlackEvent({
      type: 'message', subtype: 'message_deleted', channel: 'C1', deleted_ts: '1.000100',
      previous_message: { ts: '1.000100', bot_id: 'B0DEPLOY', text: 'deployed' },
    });
    // A person reacting to what an app posted is a person.
    recorded.emitSlackEvent({
      type: 'reaction_added', user: 'U1', reaction: 'tada',
      item: { type: 'message', channel: 'C1', ts: '1.000100' },
    });
    // And a person's own message still counts for everything.
    recorded.emitSlackEvent({
      type: 'message', channel: 'C1', ts: '2.000100', user: 'U1', text: 'first',
    });
    recorded.emitSlackEvent({
      type: 'message', subtype: 'message_changed', channel: 'C1',
      previous_message: { ts: '2.000100', user: 'U1', text: 'first' },
      message: { ts: '2.000100', user: 'U1', text: 'second' },
    });

    await new Promise((resolve) => setTimeout(resolve, 500));
    const log = api.settings.get('entries', []);
    assert.deepEqual(log.map((entry) => entry.kind).sort(), ['edited', 'reaction-added']);
    assert.equal(log.find((entry) => entry.kind === 'edited').ts, '2.000100',
      'the person’s message, not the app’s');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('a catch-up skips what an app did to its own messages, and nothing else', () => {
  const was = snapshotOf([
    said('3', 'alerting', { bot_id: 'B0ALERT' }),
    said('2', 'kept'),
    said('1', 'mine'),
  ]);
  const now = [said('3', 'resolved', { bot_id: 'B0ALERT' }), said('1', 'edited')];

  assert.deepEqual(
    catchUp(was, now, { channelId: 'C1', channelName: null }).map((e) => [e.kind, e.ts]),
    // Oldest first, which is the order a run of them happened in.
    [['edited', '1'], ['deleted', '2']],
    'the app’s edit and nothing about it; the person’s edit and the deletion stay',
  );

  // And the setting opens it back up.
  assert.deepEqual(
    catchUp(was, now, { channelId: 'C1', channelName: null }, { apps: true }).map((e) => e.ts).sort(),
    ['1', '2', '3'],
  );
});

test('a message that is on screen was never deleted, and the entry saying so goes', async () => {
  /*
   * Whatever wrote such an entry was wrong, and one thing did: working a
   * deletion out from the screen turned every edit into a deletion, because
   * Slack takes the message out of the document while you type. The line it
   * drew then sat beside the message it claimed was gone, with the same words
   * in it, which reads as the message having been posted twice.
   *
   * Provably wrong is worth more than not drawn: the entry is on the page as
   * well, saying the same untrue thing.
   */
  const dom = installDom();
  const { api, recorded } = createTestApi({
    files: FILES,
    settings: {
      people: false,
      entries: [
        {
          id: '1', kind: 'deleted', at: 10,
          channelId: 'C0BFQCYBRAB', ts: '1786386808.130969',
          before: 'still very much here', userId: 'U0EXAMPLE2',
        },
        { id: '2', kind: 'edited', at: 11, channelId: 'C0BFQCYBRAB', ts: '7', before: 'a', after: 'b' },
      ],
    },
  });
  try {
    await plugin.start(api);
    assert.equal(document.querySelector('.bsh-stone'), null, 'no line beside a message that is there');

    await new Promise((resolve) => setTimeout(resolve, 500));
    const log = api.settings.get('entries', []);
    assert.deepEqual(log.map((entry) => entry.id), ['2'],
      'and the entry goes, since the page was saying the same untrue thing');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('Slack’s own “(edited)” is the way in, and only where there is something to show', async () => {
  /*
   * Slack already marks an edited message and already puts the mark exactly
   * where the question is asked -- it just does not answer it. So the label
   * becomes the control rather than a fourth button beside three of Slack's
   * own, and what it opens unfolds under the message: a dialog would cover the
   * conversation the wording belongs to.
   *
   * Slack marks every edit, including ones made before this mod existed, so a
   * label with nothing behind it is left exactly as Slack drew it.
   */
  const dom = installDom();
  const message = document.querySelector('[data-qa="message_container"]');
  const label = document.createElement('span');
  label.className = 'c-message__edited_label';
  label.textContent = '(edited)';
  message.querySelector('[data-qa="message-text"]').after(label);

  const { api, recorded } = createTestApi({
    files: FILES,
    settings: {
      people: false,
      entries: [
        { id: '1', kind: 'edited', at: 20, channelId: 'C0BFQCYBRAB', ts: '1786386808.130969', before: 'second', after: 'third' },
        { id: '2', kind: 'edited', at: 10, channelId: 'C0BFQCYBRAB', ts: '1786386808.130969', before: 'first', after: 'second' },
      ],
    },
  });
  try {
    await plugin.start(api);
    assert.ok(label.classList.contains('bsh-edited'), 'the label became a control');
    assert.equal(label.getAttribute('aria-expanded'), 'false');
    assert.equal(document.querySelector('.bsh-fold'), null, 'and nothing is unfolded yet');

    label.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const fold = document.querySelector('.bsh-fold');
    assert.ok(fold, 'it unfolded');
    assert.ok(message.contains(fold), 'under the message, not over it');
    /*
     * A chain, not a list of changes. Two edits of one message share a wording
     * -- the second one's `before` is the first one's `after` -- and printing
     * it twice would read as an edit that changed nothing.
     */
    assert.deepEqual([...fold.querySelectorAll('.bsh-wording__text')].map((n) => n.textContent),
      ['first', 'second', 'third']);
    assert.equal(fold.querySelector('.bsh-wording--now .bsh-wording__text').textContent, 'third');
    /*
     * A time on every row, the first one being the message's own -- `ts` is
     * when it was posted. Two wordings a minute apart then read as a minute
     * apart rather than as the same thing written twice, which is what a
     * heading and a rule between them made of them.
     */
    assert.equal(fold.querySelectorAll('.bsh-wording__when').length, 3);
    assert.ok([...fold.querySelectorAll('.bsh-wording__when')].every((n) => /\d/.test(n.textContent)));

    label.click();
    assert.equal(document.querySelector('.bsh-fold'), null, 'and folds away again');
    assert.equal(label.getAttribute('aria-expanded'), 'false');

    /*
     * And it still closes after Slack has rebuilt the label.
     *
     * Putting a panel into the message makes React reconcile that subtree and
     * build a fresh label, so a listener bound to the node works exactly once
     * -- the second click lands on a node that never had one. Delegated from
     * the document, it never depended on the node at all.
     */
    label.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(document.querySelector('.bsh-fold'), 'open again');

    const fresh = document.createElement('span');
    fresh.className = 'c-message__edited_label';
    fresh.textContent = '(edited)';
    label.replaceWith(fresh);
    fresh.click();
    assert.equal(document.querySelector('.bsh-fold'), null, 'a label Slack rebuilt still closes it');

    // Nothing of ours is left on Slack's own label when the mod stops.
    fresh.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await plugin.stop();
    assert.equal(document.querySelector('.bsh-fold'), null);
    assert.equal(fresh.className, 'c-message__edited_label');
    assert.equal(fresh.getAttribute('role'), null);
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('a label Slack drew for an edit this never saw is left alone', async () => {
  const dom = installDom();
  const message = document.querySelector('[data-qa="message_container"]');
  const label = document.createElement('span');
  label.className = 'c-message__edited_label';
  label.textContent = '(edited)';
  message.querySelector('[data-qa="message-text"]').after(label);

  const { api, recorded } = createTestApi({ files: FILES, settings: { people: false } });
  try {
    await plugin.start(api);
    assert.equal(label.className, 'c-message__edited_label', 'exactly as Slack drew it');
    label.click();
    assert.equal(document.querySelector('.bsh-fold'), null);
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('two wordings that say the same thing are one wording', async () => {
  // A run that repeats reads as an edit that changed nothing. One entry cannot
  // produce that; two halves both catching the same edit can.
  const dom = installDom();
  const message = document.querySelector('[data-qa="message_container"]');
  const label = document.createElement('span');
  label.className = 'c-message__edited_label';
  label.textContent = '(edited)';
  message.querySelector('[data-qa="message-text"]').after(label);

  const { api, recorded } = createTestApi({
    files: FILES,
    settings: {
      people: false,
      entries: [
        { id: '1', kind: 'edited', at: 10, channelId: 'C0BFQCYBRAB', ts: '1786386808.130969', before: 'first', after: 'second' },
        { id: '2', kind: 'edited', at: 20, channelId: 'C0BFQCYBRAB', ts: '1786386808.130969', before: 'second', after: 'second' },
        { id: '3', kind: 'edited', at: 30, channelId: 'C0BFQCYBRAB', ts: '1786386808.130969', before: 'second', after: 'third' },
      ],
    },
  });
  try {
    await plugin.start(api);
    label.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(
      [...document.querySelectorAll('.bsh-wording__text')].map((n) => n.textContent),
      ['first', 'second', 'third'],
    );
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});
