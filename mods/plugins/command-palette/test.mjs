import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPluginShape, createTestApi, installDom, readModFiles } from '../../../tests/harness.mjs';
import plugin from './index.js';

const here = path.dirname(fileURLToPath(import.meta.url));

test('has the shape the runtime loads', () => assertPluginShape(assert, plugin));

/** ⌘K, or Ctrl+K off a Mac: whichever this platform's `mod` means. */
function press() {
  const mac = /mac/i.test(globalThis.navigator?.platform ?? '');
  globalThis.window.dispatchEvent(new globalThis.window.KeyboardEvent('keydown', {
    code: 'KeyK',
    key: 'k',
    metaKey: mac,
    ctrlKey: !mac,
    bubbles: true,
  }));
}

const settle = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));
/** Past the search debounce, which is what keeps typing to one request. */
const SEARCHED = 260;

/**
 * The api the palette needs: Slack's conversations, Slack's search, and the
 * catalogue. `search` is what a real workspace answers for a query nobody in
 * your DMs matches -- the case the first version got wrong.
 */
function mount({ conversations = [], mods = [], search = {}, counts = {} } = {}) {
  const dom = installDom();
  const calls = [];
  const { api, recorded } = createTestApi({
    mods,
    web: {
      call: async (method, params) => {
        calls.push({ method, params });
        if (method === 'users.conversations') return { channels: conversations };
        if (method === 'search.modules.people') return { items: search.people ?? [] };
        if (method === 'search.modules.channels') return { items: search.channels ?? [] };
        if (method === 'search.modules.messages') return { items: search.messages ?? [] };
        if (method === 'client.counts') return counts;
        return { ok: true };
      },
      users: async (ids) => new Map(ids.map((id) => [id, {
        id,
        name: id === 'U000SELF' ? 'erwan.martin' : `handle-${id}`,
        profile: { display_name: `Person ${id}`, image_48: `https://ca.slack-edge.com/${id}-48` },
      }])),
    },
  });
  recorded.calls = calls;
  return { api, recorded, dom };
}

/** What the open palette would show for a query, in a mode. */
const shown = (recorded, query = '', mode = null) => recorded.palettes.at(-1).entries(query, mode);

test('⌘K opens on where you were going, with faces and glyphs to scan by', async () => {
  const { api, recorded, dom } = mount({
    conversations: [
      { id: 'C1', name: 'general', is_private: false, purpose: { value: 'Everything' } },
      { id: 'C2', name: 'secrets', is_private: true },
      { id: 'D1', is_im: true, user: 'U9' },
    ],
  });
  try {
    await plugin.start(api);
    await settle();

    // A real key event, so the combo parser is exercised rather than trusted:
    // `mod` is ⌘ on a Mac and Ctrl elsewhere, and the test should not care.
    press();
    const entries = shown(recorded);

    const general = entries.find((entry) => entry.title === 'general');
    assert.equal(general.icon, '#', 'a glyph rather than a prefix in the name');
    assert.equal(entries.find((entry) => entry.title === 'secrets').icon, '🔒', 'a private channel says so');

    const person = entries.find((entry) => entry.title === 'Person U9');
    assert.match(person.icon, /^https?:/, 'their face, which is what makes a list of people scannable');
    assert.notEqual(person.section, general.section, 'people and channels are separate headings now');

    general.run();
    assert.deepEqual(recorded.navigations.at(-1), { kind: 'channel', id: 'C1' },
      'opening one navigates in place, the way Slack does');
  } finally {
    dom.cleanup();
  }
});

test('someone you have never written to is found anyway', async () => {
  const { api, recorded, dom } = mount({
    conversations: [{ id: 'D1', is_im: true, user: 'U9' }],
    search: {
      people: [{
        id: 'U404',
        username: 'etienne',
        profile: { display_name: 'Étienne', image_48: 'https://ca.slack-edge.com/U404-48', title: 'Design' },
      }],
    },
  });
  try {
    await plugin.start(api);
    await settle();
    press();

    // Typing asks Slack's own index; nothing is awaited, so the first answer is
    // the local one and the search lands behind it.
    shown(recorded, 'etienne');
    await settle(SEARCHED);

    const found = shown(recorded, 'etienne').find((entry) => entry.title === 'Étienne');
    assert.ok(found, 'the whole directory, not just the DMs you have open');
    assert.equal(found.always, true, 'and ranking cannot filter out what Slack matched server-side');
    assert.match(found.subtitle, /@etienne/, 'with the handle, so two people with one name are told apart');

    const asked = recorded.calls.find((call) => call.method === 'search.modules.people');
    assert.equal(asked.params.module, 'people',
      'Slack requires `module` as an argument as well as in the path');

    found.run();
    assert.deepEqual(recorded.navigations.at(-1), { kind: 'dm', id: 'U404' },
      'and it opens the DM, creating it if there is not one yet');
  } finally {
    dom.cleanup();
  }
});

test('one letter is not a search', async () => {
  const { api, recorded, dom } = mount({ conversations: [] });
  try {
    await plugin.start(api);
    await settle();
    press();
    shown(recorded, 'e');
    await settle(SEARCHED);

    assert.equal(recorded.calls.filter((call) => call.method.startsWith('search.')).length, 0,
      'a query that matches half the workspace is not worth the round trip');
  } finally {
    dom.cleanup();
  }
});

test('/ is actions, @ is people, # is channels, > is messages', async () => {
  const { api, recorded, dom } = mount({
    conversations: [
      { id: 'C1', name: 'general' },
      { id: 'D1', is_im: true, user: 'U9' },
    ],
    mods: [{ id: 'midnight', name: 'Midnight', description: 'A dark theme', type: 'theme', installed: true, enabled: true }],
  });
  try {
    await plugin.start(api);
    await settle();
    press();

    const actions = shown(recorded, '', 'actions');
    assert.ok(actions.every((entry) => !/^general$/.test(entry.title)), 'no conversations in the actions mode');
    assert.ok(actions.some((entry) => /Open BetterSlack/.test(entry.title)));

    const people = shown(recorded, '', 'people');
    assert.deepEqual(people.map((entry) => entry.title), ['Person U9']);

    const channels = shown(recorded, '', 'channels');
    assert.deepEqual(channels.map((entry) => entry.title), ['general']);

    // The modes are declared, so the palette can show them rather than expect
    // them to be known.
    const prefixes = recorded.palettes.at(-1).labels.modes.map((mode) => mode.prefix);
    assert.deepEqual(prefixes, ['/', '@', '#', '>']);
  } finally {
    dom.cleanup();
  }
});

test('a mod can be switched, and configured when there is something to configure', async () => {
  const { api, recorded, dom } = mount({
    mods: [
      { id: 'quiet', name: 'Quiet', description: 'No settings', type: 'plugin', installed: true, enabled: true, settings: 0 },
      { id: 'notes', name: 'Notes', description: 'Two knobs', type: 'plugin', installed: true, enabled: true, settings: 2 },
      { id: 'off', name: 'Off', description: 'Not running', type: 'plugin', installed: true, enabled: false, settings: 2 },
      { id: 'aurora', name: 'Aurora', description: 'Gradients', type: 'theme', installed: false, enabled: false },
    ],
  });
  try {
    await plugin.start(api);
    await settle();
    press();
    const titles = shown(recorded, 'a').map((entry) => entry.title);

    assert.ok(titles.includes('Configure Notes'), 'a mod that declared settings');
    assert.ok(!titles.includes('Configure Quiet'), 'and never one that declared none');
    assert.ok(!titles.includes('Configure Off'),
      'nor one that is switched off — the panel hides its controls, so the row would lead nowhere');
    assert.ok(titles.includes('Install Aurora'), 'the whole catalogue, once you type');

    shown(recorded, 'a').find((entry) => entry.title === 'Configure Notes').run();
    assert.deepEqual(recorded.panels.at(-1), { mod: 'notes' }, 'straight to that mod in the panel');
  } finally {
    dom.cleanup();
  }
});

test('it works with no token at all, on what BetterSlack knows', async () => {
  const dom = installDom();
  try {
    const { api, recorded } = createTestApi({ web: { available: false } });
    await plugin.start(api);
    press();
    assert.ok(shown(recorded).length >= 4, 'the panel’s own doors are still there');
  } finally {
    dom.cleanup();
  }
});

test('binds every shortcut asked for, and refuses nonsense', async () => {
  const { parseShortcuts, comboOf } = await import('./shortcuts.js');

  // The setting is a list because the question is not "which of ours" but
  // "which of yours".
  assert.deepEqual(parseShortcuts('mod+k, mod+shift+p'), ['mod+k', 'mod+shift+p']);
  assert.deepEqual(parseShortcuts(' MOD+K , mod+k '), ['mod+k'], 'tidied and deduplicated');

  // Never unreachable: a setting emptied by hand falls back to the one
  // everybody knows rather than leaving the palette with no way in.
  assert.deepEqual(parseShortcuts(''), ['mod+k']);
  assert.deepEqual(parseShortcuts('¯\\_(ツ)_/¯'), ['mod+k']);

  // Recording a combination.
  assert.equal(comboOf({ key: 'k', metaKey: true }), 'mod+k');
  assert.equal(comboOf({ key: 'P', metaKey: true, shiftKey: true }), 'mod+shift+p');
  assert.equal(comboOf({ key: 'F5' }), 'f5');
  assert.equal(comboOf({ key: 'Shift', shiftKey: true }), null, 'still pressing');
  // A bare letter would fire while somebody is typing a message.
  assert.equal(comboOf({ key: 'k' }), null);
});

test('every shortcut in the setting opens it, not just the first', async () => {
  const { api, recorded, dom } = mount({});
  try {
    // Two of them, one of which Slack has its own use for.
    await api.settings.set('shortcuts', 'mod+k, mod+shift+p');
    await plugin.start(api);
    await settle();

    const mac = /mac/i.test(globalThis.navigator?.platform ?? '');
    const hit = (init) => globalThis.window.dispatchEvent(
      new globalThis.window.KeyboardEvent('keydown', { bubbles: true, metaKey: mac, ctrlKey: !mac, ...init }),
    );

    hit({ code: 'KeyK', key: 'k' });
    hit({ code: 'KeyP', key: 'p', shiftKey: true });
    assert.equal(recorded.palettes.length, 2, 'both combinations reached it');
  } finally {
    dom.cleanup();
  }
});

test('a person carries their status, emoji and all', async () => {
  const dom = installDom();
  const { api, recorded } = createTestApi({
    web: {
      call: async (method) => {
        if (method === 'users.conversations') return { channels: [{ id: 'D1', is_im: true, user: 'U1' }] };
        return { ok: true, items: [] };
      },
      users: async (ids) => new Map(ids.map((id) => [id, {
        id,
        name: 'zoe',
        profile: {
          display_name: 'Zoe',
          title: 'Design',
          status_emoji: ':palm_tree:',
          status_text: 'On holiday',
        },
      }])),
      emoji: async () => new Map([['palm_tree', 'https://emoji.example/palm.png']]),
    },
  });
  try {
    await plugin.start(api);
    await settle();
    press();
    await settle(40);

    const person = (await shown(recorded)).find((row) => row.title === 'Zoe');
    assert.ok(person, 'the person is listed');
    assert.equal(person.status?.imageUrl, 'https://emoji.example/palm.png',
      'the emoji is resolved from the workspace map');
    assert.equal(person.status?.text, 'On holiday');
    // The row draws the status itself, and twice would read as a mistake.
    assert.doesNotMatch(person.subtitle ?? '', /On holiday/, 'and not repeated in the subtitle');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('says it is still looking, rather than that nothing matches', async () => {
  /*
   * The two are different answers and the palette was giving the second for the
   * first. A directory search is debounced and then goes to the network, so for
   * a few hundred milliseconds after typing a name the list is empty because
   * nobody has answered yet.
   */
  const { api, recorded, dom } = mount({
    conversations: [],
    search: { people: [{ id: 'U9', profile: { display_name: 'Zoe' } }] },
  });
  try {
    await plugin.start(api);
    await settle();
    press();
    await settle();

    const palette = recorded.palettes.at(-1);
    await palette.entries('zoe');
    assert.equal(palette.busy, true, 'waiting starts at the keystroke, not at the request');

    // The debounce, then the answer.
    await settle(SEARCHED);
    await palette.entries('zoe');
    assert.equal(palette.busy, false, 'and stops when Slack has answered');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('a query too short to search is not a query being waited for', async () => {
  const { api, recorded, dom } = mount({ conversations: [] });
  try {
    await plugin.start(api);
    await settle();
    press();
    await settle();

    const palette = recorded.palettes.at(-1);
    await palette.entries('z');
    assert.equal(palette.busy, false,
      'nothing is asked for one letter, so there is nothing to wait for');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

/*
 * Messages, which are the one thing in the palette that is only ever Slack's
 * answer -- a client keeps no index of what was said, so there is no local half
 * to show while the search is out.
 *
 * The shape is measured rather than invented: an item is a conversation, and
 * the match is `messages[0]`.
 */
test('> searches the messages, and opens the one you pick where it was said', async () => {
  const { api, recorded, dom } = mount({
    conversations: [{ id: 'C1', name: 'general' }],
    search: {
      messages: [{
        iid: 'i1',
        team: 'T1',
        channel: { id: 'C7', name: 'deploys' },
        messages: [{
          ts: '1750000000.123456',
          user: 'U4',
          username: 'robin',
          text: 'the release   is\n  out',
          permalink: 'https://example.slack.com/archives/C7/p1750000000123456',
        }],
      }],
    },
  });
  try {
    await plugin.start(api);
    await settle();
    press();

    shown(recorded, 'release', 'messages');
    await settle(SEARCHED);

    const rows = shown(recorded, 'release', 'messages');
    assert.equal(rows.length, 1);
    // One line: a message with newlines in it would otherwise stretch the row
    // and push everything under it off the screen.
    assert.equal(rows[0].title, 'the release is out');
    // The face and the name, not the handle: `robin` is neither of the two
    // things anybody scans a list of results by.
    const sub = rows[0].subtitleNode().textContent;
    assert.match(sub, /Person U4/);
    assert.match(sub, /#deploys/);
    assert.match(rows[0].icon, /U4-48$/, 'the author\'s face is the row\'s icon');
    assert.ok(rows[0].always, 'Slack matched it; the on-screen ranking has not got the whole message');

    rows[0].run();
    // The team travels with it: search answers across every workspace you are
    // signed into, and a deep link without one lands in the wrong client.
    assert.deepEqual(recorded.navigations.at(-1),
      { kind: 'message', id: 'C7', ts: '1750000000.123456', team: 'T1' });
  } finally {
    dom.cleanup();
  }
});

test('the mixed list offers the messages rather than filling up with them', async () => {
  const { api, recorded, dom } = mount({
    conversations: [{ id: 'C1', name: 'general' }],
    search: {
      messages: Array.from({ length: 20 }, (unused, i) => ({
        team: 'T1',
        channel: { id: 'C7', name: 'deploys' },
        messages: [{ ts: `175000000${i}.000100`, username: 'robin', text: `release ${i}` }],
      })),
    },
  });
  try {
    await plugin.start(api);
    await settle();
    press();

    shown(recorded, 'release');
    await settle(SEARCHED);

    const rows = shown(recorded, 'release');
    const messages = rows.filter((row) => /^release \d+$/.test(row.title));
    assert.deepEqual(messages, [], 'a switcher is for going somewhere, not for reading a conversation');

    const way = rows.find((row) => row.id === 'palette:messages');
    assert.ok(way, 'but the messages are one row away');
    assert.ok(way.keepOpen, 'switching mode is a refinement, not an arrival');
    way.run();
    assert.equal(recorded.palettes.at(-1).mode, 'messages');
  } finally {
    dom.cleanup();
  }
});

/*
 * Where you have been, first.
 *
 * `users.conversations` answers in an order of its own, so an untyped palette
 * opened on whatever Slack listed first -- which is roughly the channel you
 * joined longest ago and never read.
 */
test('what you opened last is what the palette opens on', async () => {
  const { api, recorded, dom } = mount({
    conversations: [
      { id: 'C1', name: 'general' },
      { id: 'C2', name: 'design' },
      { id: 'C3', name: 'releases' },
    ],
  });
  try {
    await plugin.start(api);
    await settle();
    press();

    const before = shown(recorded).filter((row) => row.id.startsWith('slack:'));
    assert.deepEqual(before.map((row) => row.title), ['general', 'design', 'releases']);

    before.find((row) => row.title === 'releases').run();
    press();
    assert.deepEqual(
      shown(recorded).filter((row) => row.id.startsWith('slack:')).map((row) => row.title),
      ['releases', 'general', 'design']);

    // A re-ordering and never a filter: a switcher that hid what you had not
    // opened lately would be one you cannot reach anything new with.
    assert.equal(shown(recorded).filter((row) => row.id.startsWith('slack:')).length, 3);
  } finally {
    dom.cleanup();
  }
});

/*
 * The half that changes something rather than going somewhere.
 *
 * Every method these rows call was measured against a live workspace first --
 * an xoxc token is refused by more of Slack's API than it is allowed by -- so
 * what the tests hold is the shape of the call, which is the part that can
 * regress here.
 */
test('the rows about the conversation you are looking at need a conversation', async () => {
  // The fixture's message carries this channel, and `currentChannelId` reads
  // what is drawn before it reads the URL -- the two disagree at a cold start.
  const HERE = 'C0BFQCYBRAB';
  const { api, recorded, dom } = mount({
    conversations: [{ id: HERE, name: 'general' }],
    counts: { channels: [{ id: HERE, last_read: '100.0001', latest: '200.0002', has_unreads: true, mention_count: 2 }] },
  });
  try {
    await plugin.start(api);
    await settle(30);
    press();

    const rows = shown(recorded, '');
    const link = rows.find((row) => row.id === 'do:copy-link');
    assert.ok(link, 'a link to where you are, without typing anything');
    link.run();
    await settle();
    assert.equal(dom.recorded.clipboard.at(-1), `https://acme.slack.com/archives/${HERE}`,
      'built from the workspace domain the token file carries, not fetched');

    const mark = rows.find((row) => row.id === 'do:mark-read');
    assert.ok(mark, 'offered, because this one is unread');
    mark.run();
    await settle();
    // Slack marks up to a timestamp, and the counts answer is where it is.
    assert.deepEqual(
      recorded.calls.filter((call) => call.method === 'conversations.mark').at(-1).params,
      { channel: HERE, ts: '200.0002' });
  } finally {
    dom.cleanup();
  }
});

test('a conversation with nothing new in it is not offered a mark-as-read', async () => {
  const { api, recorded, dom } = mount({
    conversations: [{ id: 'C0BFQCYBRAB', name: 'general' }],
    counts: { channels: [{ id: 'C0BFQCYBRAB', last_read: '200.0002', latest: '200.0002', has_unreads: false }] },
  });
  try {
    await plugin.start(api);
    await settle(30);
    press();
    assert.equal(shown(recorded, '').find((row) => row.id === 'do:mark-read'), undefined);
  } finally {
    dom.cleanup();
  }
});

test('a status preset is one profile write, with an expiry', async () => {
  const { api, recorded, dom } = mount({ conversations: [] });
  try {
    await plugin.start(api);
    await settle();
    press();

    // Presets wait for a query: six of them on an untyped palette bury the
    // conversations it was opened for.
    assert.equal(shown(recorded, '').find((row) => row.id === 'do:status:statusLunch'), undefined);

    const lunch = shown(recorded, 'lunch').find((row) => row.id === 'do:status:statusLunch');
    assert.ok(lunch);
    lunch.run();
    await settle();

    const wrote = recorded.calls.filter((call) => call.method === 'users.profile.set').at(-1);
    // One key holding the whole profile as JSON: sending `status_text` as a
    // field of its own is accepted and ignored.
    const profile = JSON.parse(wrote.params.profile);
    assert.equal(profile.status_text, 'At lunch');
    assert.equal(profile.status_emoji, ':knife_fork_plate:');
    const minutes = (profile.status_expiration - Math.floor(Date.now() / 1000)) / 60;
    assert.ok(minutes > 28 && minutes < 31, `expires in half an hour, got ${minutes}`);

    shown(recorded, 'clear').find((row) => row.id === 'do:status-clear').run();
    await settle();
    assert.deepEqual(
      JSON.parse(recorded.calls.filter((call) => call.method === 'users.profile.set').at(-1).params.profile),
      { status_text: '', status_emoji: '', status_expiration: 0 });
  } finally {
    dom.cleanup();
  }
});

test('showing yourself as away reads the screen, not users.getPresence', async () => {
  const { api, recorded, dom } = mount({ conversations: [] });
  try {
    // Slack swaps this class the moment presence changes; the API lags it by
    // up to a minute after the window comes back to the front.
    const button = dom.document.querySelector('[data-qa="user-button"]')
      ?? dom.document.body.appendChild(Object.assign(dom.document.createElement('div'), {}));
    button.setAttribute('data-qa', 'user-button');
    button.innerHTML = '<span class="c-presence c-presence--away"></span>';

    await plugin.start(api);
    await settle();
    press();

    const row = shown(recorded, 'active').find((entry) => entry.id === 'do:presence');
    assert.equal(row.title, 'Show yourself as active', 'away already, so the row is the way back');
    row.run();
    await settle();
    assert.deepEqual(
      recorded.calls.filter((call) => call.method === 'users.setPresence').at(-1).params,
      // `auto`, not `active`: Slack decides from the client's own activity.
      { presence: 'auto' });
  } finally {
    dom.cleanup();
  }
});

/*
 * ⌘K with nothing typed is the "where should I be" question.
 *
 * The honest answer is the conversations with something new in them -- and only
 * then: once there is a query it is a search again, and an unread channel that
 * does not match what you typed has no business jumping the queue.
 */
test('an untyped palette leads with what is waiting for you', async () => {
  const { api, recorded, dom } = mount({
    conversations: [
      { id: 'C1', name: 'general' },
      { id: 'C2', name: 'design' },
      { id: 'C3', name: 'releases' },
    ],
    counts: {
      channels: [
        { id: 'C1', last_read: '400.0001', latest: '400.0001', has_unreads: false },
        { id: 'C3', last_read: '100.0001', latest: '500.0001', has_unreads: true, mention_count: 3 },
      ],
    },
  });
  try {
    await plugin.start(api);
    await settle(30);
    press();

    const rows = shown(recorded).filter((row) => row.id.startsWith('slack:'));
    assert.equal(rows[0].title, 'releases');
    assert.equal(rows[0].section, 'Waiting for you');
    assert.match(rows[0].subtitle, /3 mentions/);
    // Listed once, not twice: it is in the unread section instead of its own,
    // not as well as.
    assert.equal(rows.filter((row) => row.title === 'releases').length, 1);

    // Typed, it is a search again.
    const searched = shown(recorded, 'design').filter((row) => row.id.startsWith('slack:'));
    assert.equal(searched[0].title, 'design');
    assert.ok(searched.every((row) => row.section !== 'Waiting for you'));
  } finally {
    dom.cleanup();
  }
});

/*
 * What an integration posted, which is most of what a search turns up.
 *
 * Measured on a live workspace: every Grafana alert came back with `text: ''`
 * and its words in an attachment, so eight rows read "(no text)" and the search
 * looked broken. The words are in the attachment or in the blocks.
 */
test('a message with no text of its own is read out of its attachments and blocks', async () => {
  const { api, recorded, dom } = mount({
    search: {
      messages: [
        {
          team: 'T1',
          channel: { id: 'C7', name: 'warnings' },
          messages: [{ ts: '1.1', username: 'grafana', text: '', attachments: [{ fallback: '[FIRING:1] disk usage' }] }],
        },
        {
          team: 'T1',
          channel: { id: 'C8', name: 'alerts' },
          messages: [{
            ts: '2.2',
            username: 'grafana',
            text: '',
            blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'queue is *backing up*' } }],
          }],
        },
        {
          team: 'T1',
          channel: { id: 'C9', name: 'quiet' },
          messages: [{ ts: '3.3', username: 'nobody', text: '' }],
        },
      ],
    },
  });
  try {
    await plugin.start(api);
    await settle();
    press();
    shown(recorded, 'disk', 'messages');
    await settle(SEARCHED);

    assert.deepEqual(
      shown(recorded, 'disk', 'messages').map((row) => row.title),
      ['[FIRING:1] disk usage', 'queue is backing up'],
      'and a message with nothing readable in it is left out rather than shown empty');
  } finally {
    dom.cleanup();
  }
});

test('a channel purpose is one readable line, not Slack markup', async () => {
  const { api, recorded, dom } = mount({
    conversations: [{
      id: 'C1',
      name: 'tech-payment',
      purpose: { value: 'Point Payments &amp; Prophecy :\n<https://example.com/j/889|le zoom>' },
    }],
  });
  try {
    await plugin.start(api);
    await settle();
    press();
    const row = shown(recorded).find((entry) => entry.title === 'tech-payment');
    assert.equal(row.subtitle, 'Point Payments & Prophecy : le zoom');
  } finally {
    dom.cleanup();
  }
});

/*
 * What somebody wrote, as they wrote it.
 *
 * Flattened to plain text a result loses the three things that make it
 * readable at a glance: the emphasis, the link's label instead of thirty
 * characters of address, and the emoji. `title` stays the plain reading --
 * that is what the ranking sorts by and what is announced -- and the row draws
 * the message itself.
 */
test('a message result keeps its bold, its links, its mentions and its emoji', async () => {
  const { api, recorded, dom } = mount({
    search: {
      messages: [{
        team: 'T1',
        channel: { id: 'C7', name: 'deploys' },
        messages: [{
          ts: '1750000000.000100',
          user: 'U4',
          username: 'robin',
          text: '',
          blocks: [{
            type: 'rich_text',
            elements: [{
              type: 'rich_text_section',
              elements: [
                { type: 'text', text: 'ship ' },
                { type: 'text', text: 'now', style: { bold: true } },
                { type: 'text', text: ' ' },
                { type: 'user', user_id: 'U9' },
                { type: 'text', text: ' see ' },
                { type: 'link', url: 'https://gitlab.example.com/a/b/-/merge_requests/719', text: '!719' },
                { type: 'text', text: ' ' },
                { type: 'emoji', name: 'tada', unicode: '1f389' },
              ],
            }],
          }],
        }],
      }],
    },
  });
  try {
    await plugin.start(api);
    await settle();
    press();
    shown(recorded, 'ship', 'messages');
    await settle(SEARCHED);

    const row = shown(recorded, 'ship', 'messages')[0];
    const box = dom.document.createElement('div');
    box.append(row.titleNode());

    assert.equal(box.querySelector('b').textContent, 'now');
    // The label, never the address: thirty characters of URL on one line is
    // thirty characters nobody reads.
    assert.equal(box.querySelector('.bsp-link').textContent, '!719');
    // A mention is a person, not `<@U9>` -- and the person is looked up.
    assert.equal(box.querySelector('.bsp-mention').textContent, '@Person U9');
    // Slack sends the codepoints, so a standard emoji costs no request at all.
    assert.match(box.textContent, /🎉/);
    // A row is a button, so nothing inside it may be a link that swallows the
    // click that opens the conversation.
    assert.equal(box.querySelector('a'), null);
    // And it ends where the words do: every block appends a space after itself,
    // which on the last one leaves the title sitting a pixel off.
    assert.equal(box.textContent, box.textContent.trimEnd());
  } finally {
    dom.cleanup();
  }
});

/*
 * `mpdm-alice--bob--carol-1` is a key, not a name.
 *
 * It comes back that way from the conversation list *and* from the channel
 * search, and only the first was being turned into people.
 */
test('a group DM is the people in it, wherever it came from, and never you', async () => {
  const { api, recorded, dom } = mount({
    conversations: [{ id: 'G1', is_mpim: true, name: 'mpdm-erwan.martin--nina.lagoutte--sam.okonkwo-1' }],
    search: {
      channels: [{ id: 'G2', name: 'mpdm-erwan.martin--robin.vasquez-1', is_member: true }],
    },
  });
  try {
    await plugin.start(api);
    await settle(30);
    press();

    const mine = shown(recorded).find((row) => row.id === 'slack:group:G1');
    assert.equal(mine.title, 'Nina Lagoutte, Sam Okonkwo',
      'Slack leaves you out of the name it draws, and so does this');

    shown(recorded, 'robin');
    await settle(SEARCHED);
    const found = shown(recorded, 'robin').find((row) => row.id === 'slack:group:G2');
    assert.equal(found.title, 'Robin Vasquez');
    assert.ok(!found.title.includes('mpdm'), 'and never the key Slack files it under');
  } finally {
    dom.cleanup();
  }
});

/*
 * A run of `>` means a quote in Slack's markup and means nothing on one line.
 *
 * An integration that posts its body as one mrkdwn string puts six of them in
 * the middle of it, and they arrive in a `rich_text` block as literal
 * characters -- whatever posted it never had its markup parsed.
 */
test('blockquote markers do not survive into a one-line row', async () => {
  const { api, recorded, dom } = mount({
    search: {
      messages: [{
        team: 'T1',
        channel: { id: 'C7', name: 'deploys' },
        messages: [{
          ts: '1750000000.000100',
          username: 'prodbot',
          text: '',
          blocks: [{
            type: 'rich_text',
            elements: [{
              type: 'rich_text_section',
              elements: [{ type: 'text', text: '[bizion] docked prod >>>>>> Refacto\n\ndu formulaire' }],
            }],
          }],
        }],
      }],
    },
  });
  try {
    await plugin.start(api);
    await settle();
    press();
    shown(recorded, 'docked', 'messages');
    await settle(SEARCHED);

    const box = dom.document.createElement('div');
    box.append(shown(recorded, 'docked', 'messages')[0].titleNode());
    assert.equal(box.textContent, '[bizion] docked prod Refacto du formulaire');
  } finally {
    dom.cleanup();
  }
});
