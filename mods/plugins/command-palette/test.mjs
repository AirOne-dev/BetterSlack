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
function mount({ conversations = [], mods = [], search = {} } = {}) {
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
        return { ok: true };
      },
      users: async (ids) => new Map(ids.map((id) => [id, {
        id,
        name: `handle-${id}`,
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

test('/ is actions, @ is people, # is channels', async () => {
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
    assert.deepEqual(prefixes, ['/', '@', '#']);
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
    // It used to be the only place the status appeared; showing it twice now
    // would read as a mistake.
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
