import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPluginShape, createTestApi, installDom } from '../../../tests/harness.mjs';
import plugin, { settled } from './index.js';
import {
  SLOTS,
  allocateCarrier,
  checkFile,
  customFor,
  fallbackFor,
  fileNameFor,
  labelFor,
  reconcile,
  soundFromUrl,
} from './sounds.js';

const TEAM = 'T0EXAMPLE1';
const URL_OF = (stem) => `https://a.slack-edge.com/bv1-13/${stem}-ac2b6e8.mp3`;

/* -- the rules ----------------------------------------------------------- */

test('a Slack sound is recognised by its stem, whatever its hash', () => {
  assert.equal(soundFromUrl(URL_OF('knock_brush')), 'knock_brush.mp3');
  assert.equal(soundFromUrl('https://a.slack-edge.com/bv1-13/b2-0ccd0e9.mp3?x=1'), 'b2.mp3');
  assert.equal(soundFromUrl('https://a.slack-edge.com/hummus.mp3'), 'hummus.mp3');
  // A huddle's own join sound is nobody's choice and is left alone.
  assert.equal(soundFromUrl(URL_OF('they_joined_call_v2')), null);
  assert.equal(soundFromUrl('blob:https://app.slack.com/123'), null);
});

test('the carrier is the slot\'s previous sound when nothing else uses it', () => {
  const prefs = { desktop_sound: 'hummus.mp3', huddle_invite_sound: 'b2.mp3' };
  assert.equal(allocateCarrier('desktop_sound', prefs), 'hummus.mp3');
});

test('a carrier is never a sound another slot is using', () => {
  const prefs = { desktop_sound: 'b2.mp3', huddle_invite_sound: 'b2.mp3', dm_sent_sound: 'animal_stick.mp3' };
  const carrier = allocateCarrier('desktop_sound', prefs);
  assert.ok(!['b2.mp3', 'animal_stick.mp3'].includes(carrier));
});

test('a slot changed somewhere else is let go; a clash moves the custom slot', () => {
  const assignments = {
    desktop_sound: { sound: 's1', carrier: 'hummus.mp3', previous: 'hummus.mp3' },
    dm_sent_sound: { sound: 's2', carrier: 'boop.mp3', previous: 'b2.mp3' },
  };
  // Messages were set to Ding on another computer; huddles took dm_sent's carrier.
  const prefs = { desktop_sound: 'b2.mp3', dm_sent_sound: 'boop.mp3', huddle_invite_sound: 'boop.mp3' };
  const steps = reconcile(prefs, assignments);
  assert.deepEqual(steps[0], { slot: 'desktop_sound', drop: true });
  assert.equal(steps[1].slot, 'dm_sent_sound');
  assert.ok(!['boop.mp3', 'b2.mp3'].includes(steps[1].carrier));
});

test('a deleted sound falls back to the previous one, never to silence by accident', () => {
  assert.equal(fallbackFor({ previous: 'hummus.mp3' }), 'hummus.mp3');
  assert.equal(fallbackFor({ previous: 'none' }), 'none');
  assert.equal(fallbackFor({ previous: 'something_gone.mp3' }), 'b2.mp3');
  assert.equal(fallbackFor(undefined), 'b2.mp3');
});

test('files are kept under their own name, and checked before they are kept', () => {
  assert.equal(fileNameFor('s1', 'My Ding.WAV'), 's1.wav');
  assert.equal(labelFor('my_great-ding.mp3'), 'my great ding');
  assert.equal(checkFile({ name: 'a.mp3', type: 'audio/mpeg', size: 10 }), null);
  assert.equal(checkFile({ name: 'a.txt', type: 'text/plain', size: 10 }), 'notAudio');
  assert.equal(checkFile({ name: 'a.mp3', type: 'audio/mpeg', size: 6 * 1024 * 1024 }), 'tooBig');
  assert.equal(customFor('hummus.mp3', { desktop_sound: { sound: 's1', carrier: 'hummus.mp3' } }), 's1');
});

/* -- the plugin ---------------------------------------------------------- */

const LABELS = ['None', 'Ding', 'Boing', 'Drop', 'Ta-da', 'Plink', 'Wow', 'Here you go', 'Hi',
  'Knock Brush', 'Whoa!', 'Yoink', 'Hummus', 'Boop'];
const STEMS = [null, 'b2', 'animal_stick', 'been_tree', 'complete_quest_requirement', 'confirm_delivery',
  'flitterbug', 'here_you_go_lighter', 'hi_flowers_hit', 'knock_brush', 'save_and_checkout',
  'item_pickup', 'hummus', 'boop'];

/**
 * Slack's select, as measured: `.c-basic-select[data-qa=<slot>]` holding a
 * `#<slot>_button` combobox; a click opens a `[role=listbox]` of options
 * numbered `<slot>_option_<n>` in the table's order; choosing one closes the
 * list, changes the button's text and makes Slack preview the sound.
 */
function slackSelect(slot, selected, { virtual = false } = {}) {
  const root = document.createElement('div');
  root.className = 'c-basic-select';
  root.dataset.qa = slot;
  const trigger = document.createElement('div');
  trigger.id = `${slot}_button`;
  trigger.setAttribute('role', 'combobox');
  trigger.textContent = LABELS[selected];
  root.append(trigger);
  const state = { selected, writes: [], opens: 0 };
  trigger.addEventListener('click', () => {
    const open = document.querySelector('[role="listbox"]');
    if (open) return void open.remove();
    state.opens += 1;
    const list = document.createElement('div');
    list.className = 'c-select_options_list';
    list.setAttribute('role', 'listbox');
    /*
     * Virtualised the way Slack's is: six options drawn around the selected
     * one, and a different six once the list is scrolled -- each 40px a row.
     */
    const draw = (first) => {
      list.replaceChildren(...options.filter((option, index) => !virtual || (index >= first && index < first + 6)));
    };
    const options = [];
    LABELS.forEach((label, index) => {
      const option = document.createElement('div');
      option.setAttribute('role', 'option');
      option.dataset.qa = `${slot}_option_${index}`;
      option.setAttribute('aria-selected', String(index === state.selected));
      option.textContent = label;
      option.addEventListener('click', () => {
        state.selected = index;
        state.writes.push(index);
        trigger.textContent = label;
        list.remove();
        if (STEMS[index]) void new Audio(URL_OF(STEMS[index])).play();
      });
      options.push(option);
    });
    let top = Math.max(0, state.selected - 5) * 40;
    Object.defineProperty(list, 'scrollTop', {
      get: () => top,
      set: (value) => { top = value; draw(Math.floor(value / 40)); },
    });
    Object.defineProperty(list, 'clientHeight', { get: () => 240 });
    Object.defineProperty(list, 'scrollHeight', { get: () => LABELS.length * 40 });
    draw(Math.floor(top / 40));
    document.body.append(list);
  });
  document.body.append(root);
  return state;
}

function harness({ settings = {}, files = {} } = {}) {
  const dom = installDom();
  const test = createTestApi({ settings });
  for (const [name, text] of Object.entries(files)) {
    test.recorded.data.set(name, { bytes: new TextEncoder().encode(text), modified: 0 });
  }
  URL.createObjectURL = (blob) => `blob:test-${blob.size}`;
  URL.revokeObjectURL = () => undefined;
  const played = [];
  HTMLMediaElement.prototype.play = function play() {
    played.push(this.src);
    return Promise.resolve();
  };
  /*
   * Stopped the way the runtime stops it, then the DOM goes. In that order:
   * the plugin has observers and timers of its own, and a DOM torn down under
   * them throws "document is not defined" from a test that already passed.
   */
  const done = async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    for (const dispose of test.recorded.disposers.splice(0).reverse()) {
      try { dispose(); } catch { /* already gone */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
    dom.cleanup();
  };
  return { dom, played, done, ...test };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 400));
const MINE = [{ id: 's1', label: 'Mine', file: 's1.mp3' }];

test('exports a plugin', () => {
  assertPluginShape(assert, plugin);
});

test('Slack\'s select is redrawn as one that lists Slack\'s options, then yours', async () => {
  const h = harness({ settings: { sounds: MINE }, files: { 's1.mp3': 'x' } });
  try {
    slackSelect('desktop_sound', 9);
    await plugin.start(h.api);
    await settled();
    await settle();
    const ours = document.querySelector('[data-custom-sounds-slot="desktop_sound"]');
    assert.ok(ours, 'our select is there');
    assert.ok(document.querySelector('[data-qa="desktop_sound"]').classList.contains('betterslack-custom-sounds__hidden'),
      'Slack\'s is hidden but kept: it is what gets clicked');
    assert.equal(ours.textContent, 'Knock Brush');
    ours.click();
    await settle();
    const labels = h.recorded.menus.at(-1).items.map((item) => item.label);
    assert.deepEqual(labels.slice(0, 14), LABELS, 'Slack\'s own list, in Slack\'s words');
    assert.ok(labels.includes('Mine'));
    assert.ok(labels.includes('Add a sound…'));
  } finally {
    await h.done();
  }
});

test('a virtualised list opened at its bottom still offers None', async () => {
  const h = harness({ settings: { sounds: MINE }, files: { 's1.mp3': 'x' } });
  try {
    // Boop is the last option: Slack opens the list there and draws no "None".
    slackSelect('desktop_sound', 13, { virtual: true });
    await plugin.start(h.api);
    await settled();
    await settle();
    document.querySelector('[data-custom-sounds-slot="desktop_sound"]').click();
    await settle();
    const labels = h.recorded.menus.at(-1).items.map((item) => item.label);
    assert.deepEqual(labels.slice(0, 14), LABELS);
  } finally {
    await h.done();
  }
});

test('a picker opens without opening Slack\'s list, and always starts with its option 0', async () => {
  const h = harness({ settings: { sounds: MINE }, files: { 's1.mp3': 'x' } });
  try {
    const sent = slackSelect('dm_sent_sound', 0, { virtual: true });
    slackSelect('priority_desktop_sound', 0);
    await plugin.start(h.api);
    await settled();
    await settle();
    document.querySelector('[data-custom-sounds-slot="dm_sent_sound"]').click();
    await settle();
    // Nothing of Slack's put on screen first: with Motion on, that was a
    // frame drawn and gone before the menu appeared.
    assert.equal(sent.opens, 0);
    const items = h.recorded.menus.at(-1).items;
    assert.equal(items[0].label, 'None');
    assert.ok(items[0].icon, 'and it is ticked when it is the choice');
    document.querySelector('[data-custom-sounds-slot="priority_desktop_sound"]').click();
    await settle();
    assert.equal(h.recorded.menus.at(-1).items[0].label, 'Same as messages sound');
  } finally {
    await h.done();
  }
});

test('Preferences coming up opens none of Slack\'s lists', async () => {
  const h = harness({ settings: { sounds: MINE }, files: { 's1.mp3': 'x' } });
  try {
    const one = slackSelect('desktop_sound', 9);
    const two = slackSelect('dm_sent_sound', 0);
    await plugin.start(h.api);
    await settled();
    await settle();
    // Opening one focuses it and scrolls the page to it: never unasked.
    assert.equal(one.opens + two.opens, 0);
  } finally {
    await h.done();
  }
});

test('choosing your sound puts its carrier in Slack\'s select, silently, and plays yours', async () => {
  const h = harness({ settings: { sounds: MINE }, files: { 's1.mp3': 'x' } });
  try {
    const select = slackSelect('desktop_sound', 9);
    await plugin.start(h.api);
    await settled();
    await settle();
    document.querySelector('[data-custom-sounds-slot="desktop_sound"]').click();
    await settle();
    h.recorded.menus.at(-1).items.find((item) => item.label === 'Mine').onSelect();
    await settle();
    const assignment = h.api.settings.get('assignments')[TEAM].desktop_sound;
    // Knock Brush was free, so it carries the custom sound: Slack keeps what it had.
    assert.deepEqual(assignment, { sound: 's1', carrier: 'knock_brush.mp3', previous: 'knock_brush.mp3' });
    assert.deepEqual(select.writes, [], 'nothing to write when the previous sound is free');
    assert.equal(document.querySelector('[data-custom-sounds-slot="desktop_sound"]').textContent, 'Mine');
    assert.ok(h.played.includes('blob:test-1'), 'the custom file previewed');
  } finally {
    await h.done();
  }
});

test('a carrier shared with another slot moves to a free sound, without Slack\'s preview being heard', async () => {
  const h = harness({ settings: { sounds: MINE }, files: { 's1.mp3': 'x' } });
  try {
    const select = slackSelect('desktop_sound', 1);
    slackSelect('dm_arrival_sound', 1);
    await plugin.start(h.api);
    await settled();
    await settle();
    document.querySelector('[data-custom-sounds-slot="desktop_sound"]').click();
    await settle();
    h.played.length = 0;
    h.recorded.menus.at(-1).items.find((item) => item.label === 'Mine').onSelect();
    await settle();
    const assignment = h.api.settings.get('assignments')[TEAM].desktop_sound;
    assert.equal(assignment.previous, 'b2.mp3');
    assert.notEqual(assignment.carrier, 'b2.mp3');
    assert.equal(select.writes.length, 1, 'the carrier was chosen in Slack\'s select');
    assert.ok(!h.played.some((src) => /a\.slack-edge\.com/.test(src)), 'Slack\'s preview of the carrier was swallowed');
  } finally {
    await h.done();
  }
});

test('a carrier about to play plays the custom file instead', async () => {
  const assignments = { [TEAM]: { desktop_sound: { sound: 's1', carrier: 'hummus.mp3', previous: 'hummus.mp3' } } };
  const h = harness({ settings: { sounds: MINE, assignments }, files: { 's1.mp3': 'x' } });
  try {
    await plugin.start(h.api);
    await settled();
    h.played.length = 0;
    await new Audio(URL_OF('hummus')).play();
    await new Audio(URL_OF('boop')).play();
    assert.deepEqual(h.played, ['blob:test-1', URL_OF('boop')]);
  } finally {
    await h.done();
  }
});

test('deleting asks first; yes falls back to the previous sound, which is the carrier', async () => {
  const assignments = { [TEAM]: { desktop_sound: { sound: 's1', carrier: 'hummus.mp3', previous: 'hummus.mp3' } } };
  const h = harness({ settings: { sounds: MINE, assignments }, files: { 's1.mp3': 'x' } });
  try {
    await plugin.start(h.api);
    await settled();
    h.recorded.commands[0].run();
    const manager = h.recorded.modals.at(-1);
    const remove = () => [...manager.body.querySelectorAll('button')].find((button) => button.textContent === 'Delete');
    h.setConfirmAnswer(false);
    remove().click();
    await settle();
    assert.ok(h.recorded.data.has('s1.mp3'), 'kept after a no');
    assert.match(h.recorded.confirms[0].message, /go back to the sound they had before: Messages/);
    h.setConfirmAnswer(true);
    remove().click();
    await settle();
    assert.ok(!h.recorded.data.has('s1.mp3'), 'the file is gone');
    assert.deepEqual(h.api.settings.get('sounds'), []);
    assert.deepEqual(h.api.settings.get('assignments')[TEAM], {});
    // Nothing left to swap: Slack's own Hummus plays again.
    h.played.length = 0;
    await new Audio(URL_OF('hummus')).play();
    assert.deepEqual(h.played, [URL_OF('hummus')]);
  } finally {
    await h.done();
  }
});

test('a fallback that needs Slack\'s select waits for Preferences, then is applied', async () => {
  const assignments = { [TEAM]: { desktop_sound: { sound: 's1', carrier: 'boop.mp3', previous: 'b2.mp3' } } };
  const h = harness({ settings: { sounds: MINE, assignments }, files: { 's1.mp3': 'x' } });
  try {
    await plugin.start(h.api);
    await settled();
    h.recorded.commands[0].run();
    [...h.recorded.modals.at(-1).body.querySelectorAll('button')].find((b) => b.textContent === 'Delete').click();
    await settle();
    assert.deepEqual(h.api.settings.get('pending')[TEAM], { desktop_sound: 'b2.mp3' });
    assert.ok(h.recorded.toasts.some((toast) => /next time Preferences/.test(toast.message)));
    // Preferences opens, with Slack still on the old carrier.
    const select = slackSelect('desktop_sound', 13);
    await settle();
    await settle();
    assert.deepEqual(select.writes, [1], 'Ding chosen in Slack\'s own select');
    assert.deepEqual(h.api.settings.get('pending')[TEAM], {});
  } finally {
    await h.done();
  }
});

test('a file gone from disk is a deletion: its slot is let go', async () => {
  const assignments = { [TEAM]: { desktop_sound: { sound: 's1', carrier: 'hummus.mp3', previous: 'hummus.mp3' } } };
  const h = harness({ settings: { sounds: MINE, assignments } });
  try {
    await plugin.start(h.api);
    await settled();
    assert.deepEqual(h.api.settings.get('assignments')[TEAM], {});
    assert.ok(h.recorded.toasts.some((toast) => /missing/.test(toast.message)));
  } finally {
    await h.done();
  }
});

/** Slack's desktop bridge, as far as this plugin uses it: one live preference. */
function slackDesktop(playback) {
  const state = { notificationPlayback: playback, sets: [] };
  window.desktop = {
    app: {
      getPreference: async (name) => state[name],
      setPreference: async ({ name, value }) => {
        state[name] = value;
        state.sets.push(value);
      },
    },
  };
  return state;
}

test('a Mac handing notification sounds to the system is put back on Slack playing them', async () => {
  const assignments = { [TEAM]: { desktop_sound: { sound: 's1', carrier: 'hummus.mp3', previous: 'hummus.mp3' } } };
  const h = harness({ settings: { sounds: MINE, assignments }, files: { 's1.mp3': 'x' } });
  const desktop = slackDesktop('system');
  try {
    await plugin.start(h.api);
    await settled();
    // On "system", macOS plays Slack's own file and the swap never runs.
    assert.equal(desktop.notificationPlayback, 'web');
    assert.equal(h.api.settings.get('playbackBefore'), 'system');
  } finally {
    await h.done();
  }
  // Switched off, Slack goes back to playing the way it did.
  assert.equal(desktop.notificationPlayback, 'system');
});

test('nothing is touched without a custom notification sound', async () => {
  const assignments = { [TEAM]: { dm_sent_sound: { sound: 's1', carrier: 'hummus.mp3', previous: 'none' } } };
  const h = harness({ settings: { sounds: MINE, assignments }, files: { 's1.mp3': 'x' } });
  const desktop = slackDesktop('system');
  try {
    await plugin.start(h.api);
    await settled();
    // The sent-message sound is the page's own: it never needed the system.
    assert.deepEqual(desktop.sets, []);
  } finally {
    await h.done();
  }
});

test('the last custom notification sound gone, playback goes back to what it was', async () => {
  const assignments = { [TEAM]: { desktop_sound: { sound: 's1', carrier: 'hummus.mp3', previous: 'hummus.mp3' } } };
  const h = harness({ settings: { sounds: MINE, assignments }, files: { 's1.mp3': 'x' } });
  const desktop = slackDesktop('system');
  try {
    await plugin.start(h.api);
    await settled();
    assert.equal(desktop.notificationPlayback, 'web');
    h.recorded.commands[0].run();
    [...h.recorded.modals.at(-1).body.querySelectorAll('button')].find((b) => b.textContent === 'Delete').click();
    await settle();
    assert.equal(desktop.notificationPlayback, 'system');
    assert.equal(h.api.settings.get('playbackBefore'), undefined);
  } finally {
    await h.done();
  }
});

test('every slot has a label in both languages', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
  for (const slot of SLOTS) {
    assert.equal(source.split(`slot_${slot}:`).length, 3, `slot_${slot} in en and fr`);
  }
});
