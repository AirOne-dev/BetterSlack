import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPluginShape, createTestApi, installDom } from '../../../tests/harness.mjs';
import plugin from './index.js';

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

/** The api the palette needs, with the two halves it joins together. */
function mount({ conversations = [], mods = [], commands = [] } = {}) {
  const dom = installDom();
  const { api, recorded } = createTestApi({
    web: {
      call: async (method) => (method === 'users.conversations' ? { channels: conversations } : { ok: true }),
      users: async (ids) => new Map(ids.map((id) => [id, { id, profile: { display_name: `Person ${id}` } }])),
    },
  });

  // api.app is the runtime's own surface; the harness does not model the
  // catalogue, so it is stood in for here.
  api.app = {
    mods: () => mods,
    commands: () => commands,
    setEnabled: async () => {},
    setInstalled: async () => {},
    openPanel: (tab) => recorded.panels.push(tab ?? 'default'),
  };
  recorded.panels = [];
  recorded.palettes = [];
  api.ui.palette = (entries, labels) => {
    recorded.palettes.push({ entries, labels });
    return () => {};
  };

  return { api, recorded, dom };
}

test('⌘K opens it, and Slack’s conversations are what it opens on', async () => {
  const { api, recorded, dom } = mount({
    conversations: [
      { id: 'C1', name: 'general', is_private: false, purpose: { value: 'Everything' } },
      { id: 'C2', name: 'secrets', is_private: true },
      { id: 'D1', is_im: true, user: 'U9' },
    ],
  });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 10));

    // A real key event, so the combo parser is exercised rather than trusted:
    // `mod` is ⌘ on a Mac and Ctrl elsewhere, and the test should not care.
    press();
    const { entries } = recorded.palettes[0];

    // Slack's own job comes first, because this replaced Slack's own switcher.
    assert.equal(entries[0].title, '# general');
    assert.equal(entries[1].title, '🔒 secrets', 'a private channel says so');
    assert.equal(entries[2].title, 'Person U9', 'and a DM is a person, not an id');

    entries[0].run();
    assert.deepEqual(recorded.navigations.at(-1), { kind: 'channel', id: 'C1' },
      'opening one navigates in place, the way Slack does');
  } finally {
    dom.cleanup();
  }
});

test('and everything Slack has no idea about is in the same list', async () => {
  const { api, recorded, dom } = mount({
    mods: [
      { id: 'midnight', name: 'Midnight', description: 'A dark theme', type: 'theme', installed: true, enabled: false },
      { id: 'aurora', name: 'Aurora', description: 'Gradients', type: 'theme', installed: false, enabled: false },
    ],
    commands: [{ id: 'theme-builder:open', title: 'Theme builder', source: 'Theme Builder', run() {} }],
  });
  try {
    await plugin.start(api);
    await new Promise((resolve) => setTimeout(resolve, 10));
    press();
    const titles = recorded.palettes[0].entries.map((entry) => entry.title);

    assert.ok(titles.includes('Theme builder'), 'what a mod registered');
    assert.ok(titles.some((title) => /Open BetterSlack/.test(title)), 'the panel');
    assert.ok(titles.some((title) => /Enable Midnight/.test(title)), 'an installed mod, as a switch');
    // The whole catalogue: searching a theme by name and being told nothing
    // matches, because it is not installed yet, is what kills a palette.
    assert.ok(titles.some((title) => /Install Aurora/.test(title)), 'and one that is not installed');
  } finally {
    dom.cleanup();
  }
});

test('it works with no token at all, on what BetterSlack knows', async () => {
  const dom = installDom();
  try {
    const { api, recorded } = createTestApi({ web: { available: false } });
    api.app = { mods: () => [], commands: () => [], openPanel: () => {}, setEnabled: async () => {}, setInstalled: async () => {} };
    recorded.palettes = [];
    api.ui.palette = (entries) => { recorded.palettes.push({ entries }); return () => {}; };

    await plugin.start(api);
    press();
    assert.ok(recorded.palettes[0].entries.length >= 4, 'the panel’s own doors are still there');
  } finally {
    dom.cleanup();
  }
});
