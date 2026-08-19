import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPluginShape, createTestApi, installDom } from '../../../tests/harness.mjs';
import plugin from './index.js';

/** The fixture URL is /client/T0EXAMPLE1/C0BFQCYBRAB. */
const CHANNEL = 'C0BFQCYBRAB';

async function mount(settings = {}) {
  const dom = installDom();
  const harness = createTestApi({ settings });
  await plugin.start(harness.api);
  return { dom, ...harness };
}

const openNotes = (recorded) => {
  recorded.toolbarButtons[0].button.onClick();
  return recorded.modals.at(-1);
};

test('exports a plugin', () => {
  assertPluginShape(assert, plugin);
});

test('adds a button to the channel header', async () => {
  const { dom, recorded } = await mount();
  try {
    assert.equal(recorded.toolbarButtons.length, 1);
    assert.equal(recorded.toolbarButtons[0].toolbar, 'channelHeader');
    assert.equal(recorded.toolbarButtons[0].button.id, 'notes');
  } finally {
    dom.cleanup();
  }
});

test('opens a modal holding the notes for the current channel', async () => {
  const { dom, recorded } = await mount({ notes: { [CHANNEL]: 'existing note' } });
  try {
    const modal = openNotes(recorded);
    assert.match(modal.options.title, /Notes/);
    assert.equal(modal.body.querySelector('textarea').value, 'existing note');
  } finally {
    dom.cleanup();
  }
});

test('starts empty for a channel with no notes', async () => {
  const { dom, recorded } = await mount({ notes: { OTHER: 'not mine' } });
  try {
    assert.equal(openNotes(recorded).body.querySelector('textarea').value, '');
  } finally {
    dom.cleanup();
  }
});

test('saves under the current channel without touching the others', async () => {
  const { dom, recorded, store } = await mount({ notes: { OTHER: 'keep me' } });
  try {
    const modal = openNotes(recorded);
    modal.body.querySelector('textarea').value = 'new note';
    await modal.options.actions.find((a) => a.label === 'Save').onClick();

    assert.deepEqual(store.notes, { OTHER: 'keep me', [CHANNEL]: 'new note' });
  } finally {
    dom.cleanup();
  }
});

test('clearing asks first, and a refusal keeps the dialog open', async () => {
  const { dom, recorded, store, setConfirmAnswer } = await mount({
    notes: { [CHANNEL]: 'delete me' },
  });
  try {
    setConfirmAnswer(false);
    const modal = openNotes(recorded);
    const result = await modal.options.actions.find((a) => a.label === 'Clear').onClick();

    assert.equal(recorded.confirms.length, 1, 'must ask before destroying');
    assert.equal(result, false, 'returning false keeps the modal open');
    assert.equal(store.notes[CHANNEL], 'delete me', 'nothing deleted');
  } finally {
    dom.cleanup();
  }
});

test('clearing removes the entry once confirmed', async () => {
  const { dom, recorded, store, setConfirmAnswer } = await mount({
    notes: { [CHANNEL]: 'delete me', OTHER: 'keep me' },
  });
  try {
    setConfirmAnswer(true);
    const modal = openNotes(recorded);
    await modal.options.actions.find((a) => a.label === 'Clear').onClick();

    assert.deepEqual(store.notes, { OTHER: 'keep me' });
  } finally {
    dom.cleanup();
  }
});

test('an empty note is dropped rather than stored blank', async () => {
  const { dom, recorded, store } = await mount({ notes: { [CHANNEL]: 'old' } });
  try {
    const modal = openNotes(recorded);
    modal.body.querySelector('textarea').value = '   ';
    await modal.options.actions.find((a) => a.label === 'Save').onClick();

    assert.deepEqual(store.notes, {});
  } finally {
    dom.cleanup();
  }
});
