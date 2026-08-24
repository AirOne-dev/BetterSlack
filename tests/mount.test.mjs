// keepMounted, and the two ways it can take the renderer down with it.
//
// Slack's tree is React's and it re-renders constantly, so a mod's node has to
// be put back when it disappears. That means a MutationObserver whose callback
// mutates the DOM -- which is a loop unless every branch of it converges. Twice
// now it has not, and the symptom is the worst kind: no error, no console, a
// grey Slack that has to be killed, because the renderer never gets its main
// thread back.
//
// Both failures are in here as tests. Neither can hang the suite: every DOM
// touch is counted, and the mount gives up past the limit.

import test from 'node:test';
import assert from 'node:assert/strict';
import { keepMounted } from '../dist/dom.mjs';
import { closeMenu, openMenu } from '../dist/ui/menu.mjs';
import { installDom } from './harness.mjs';

/** Let the observer callbacks (microtasks) drain. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

/** Capture console.error, since giving up is reported rather than thrown. */
function recordErrors() {
  const seen = [];
  const previous = console.error;
  console.error = (...args) => seen.push(args.join(' '));
  return { seen, restore: () => { console.error = previous; } };
}

const CONTAINER = '<div id="strip"><button id="anchor">anchor</button></div>';
const button = (text) => () => {
  const node = document.createElement('button');
  node.textContent = text;
  return node;
};

test('two mods anchored on the same neighbour settle instead of fighting', async () => {
  // The freeze this repository shipped: every control-strip button defaults to
  // `before: "#betterslack-control-button"`, so with two of them each kept shoving
  // the other aside to become its immediate previous sibling. Every shove is a
  // mutation, every mutation ran the callback again, and the renderer stopped
  // answering CDP altogether. Being *somewhere* before the anchor satisfies
  // both, which is the whole fix.
  const dom = installDom(CONTAINER);
  const errors = recordErrors();
  try {
    const a = keepMounted('#strip', 'mod-a', button('A'), { before: '#anchor' });
    const b = keepMounted('#strip', 'mod-b', button('B'), { before: '#anchor' });
    await settle();

    const order = [...document.querySelectorAll('#strip > *')].map((n) => n.id);
    assert.deepEqual(order.slice(-1), ['anchor'], 'both mods sit before the anchor');
    assert.equal(order.length, 3, 'and neither was duplicated');
    assert.deepEqual(errors.seen, [], 'nobody had to give up');

    a();
    b();
  } finally {
    errors.restore();
    dom.cleanup();
  }
});

test('a node that ends up after its anchor is moved back before it', async () => {
  const dom = installDom(CONTAINER);
  try {
    const cleanup = keepMounted('#strip', 'mine', button('mine'), { before: '#anchor' });
    await settle();

    // Slack re-renders and drops our node at the end, which is where its own
    // appends land.
    document.querySelector('#strip').append(document.getElementById('mine'));
    await settle();

    const order = [...document.querySelectorAll('#strip > *')].map((n) => n.id);
    assert.deepEqual(order, ['mine', 'anchor'], 'put back on the right side');
    cleanup();
  } finally {
    dom.cleanup();
  }
});

test('a container something else owns is abandoned, loudly, not spun on', async () => {
  const dom = installDom(CONTAINER);
  const errors = recordErrors();
  try {
    // Stand-in for React reclaiming the container: whatever we add, it removes.
    const container = document.querySelector('#strip');
    const evictor = new MutationObserver(() => {
      const ours = document.getElementById('mine');
      if (ours) ours.remove();
    });
    evictor.observe(container, { childList: true });

    keepMounted('#strip', 'mine', button('mine'));
    await settle();
    evictor.disconnect();

    assert.equal(errors.seen.length, 1, 'it gave up exactly once');
    assert.match(errors.seen[0], /giving up on "mine"/);
    assert.match(errors.seen[0], /#strip/, 'and names the container at fault');
    assert.equal(document.getElementById('mine'), null, 'leaving nothing behind');
  } finally {
    errors.restore();
    dom.cleanup();
  }
});

test('an unmounted node is put back, without counting as a fight', async () => {
  const dom = installDom(CONTAINER);
  const errors = recordErrors();
  try {
    const cleanup = keepMounted('#strip', 'mine', button('mine'));
    await settle();

    // A handful of ordinary re-renders, spread out the way Slack's are.
    for (let i = 0; i < 5; i++) {
      document.getElementById('mine').remove();
      await settle();
      assert.ok(document.getElementById('mine'), `remounted after re-render ${i + 1}`);
    }
    assert.deepEqual(errors.seen, [], 'ordinary remounting is not a fight');
    cleanup();
  } finally {
    errors.restore();
    dom.cleanup();
  }
});

test('cleanup takes the node with it and stops observing', async () => {
  const dom = installDom(CONTAINER);
  try {
    const cleanup = keepMounted('#strip', 'mine', button('mine'));
    await settle();
    cleanup();
    assert.equal(document.getElementById('mine'), null);

    document.querySelector('#strip').append(document.createElement('span'));
    await settle();
    assert.equal(document.getElementById('mine'), null, 'and does not come back');
  } finally {
    dom.cleanup();
  }
});

// The shared menu and the polling helper, both lifted out of mods that had a
// copy each. Neither is interesting on its own; both are worth a test because
// the mods that call them would notice a regression in Slack rather than here.

test('one menu at a time, closed by Escape or a click outside', async () => {
  const dom = installDom('<button id="anchor">…</button>');
  try {
    const anchor = document.getElementById('anchor');
    const chosen = [];
    openMenu(anchor, [
      { label: 'First', onSelect: () => chosen.push('first') },
      { label: 'Second', onSelect: () => chosen.push('second'), danger: true },
    ]);

    const layer = document.getElementById('betterslack-menu-layer');
    assert.ok(layer, 'the menu is in the document');
    assert.ok(layer.querySelector('.c-menu__items'), 'in Slack’s own markup');
    assert.equal(layer.querySelectorAll('.c-menu_item__button').length, 2);

    document.querySelector('.c-menu_item__button').click();
    assert.deepEqual(chosen, ['first'], 'choosing runs the entry');
    assert.equal(document.getElementById('betterslack-menu-layer'), null, 'and closes it');

    // Opening a second closes the first: two overflow buttons in a row should
    // not leave two menus on screen.
    openMenu(anchor, [{ label: 'One', onSelect: () => {} }]);
    openMenu(anchor, [{ label: 'Two', onSelect: () => {} }]);
    assert.equal(document.querySelectorAll('#betterslack-menu-layer').length, 1);
    assert.match(document.getElementById('betterslack-menu-layer').textContent, /Two/);

    openMenu(anchor, [{ label: 'Again', onSelect: () => chosen.push('again') }]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.equal(document.getElementById('betterslack-menu-layer'), null, 'Escape closes it');
    assert.deepEqual(chosen, ['first'], 'and Escape chose nothing');
  } finally {
    closeMenu();
    dom.cleanup();
  }
});

test('a disabled entry is shown and does nothing', () => {
  const dom = installDom('<button id="anchor">…</button>');
  try {
    let ran = false;
    openMenu(document.getElementById('anchor'), [
      { label: 'Not now', disabled: true, onSelect: () => { ran = true; } },
    ]);
    document.querySelector('.c-menu_item__button').click();
    assert.equal(ran, false);
    assert.ok(document.getElementById('betterslack-menu-layer'), 'and it stays open');
  } finally {
    closeMenu();
    dom.cleanup();
  }
});

// The command palette: how a mod offers something without taking a button in
// Slack's rail, which is Slack's and has room for about three.

test('the palette ranks a title match above a source match', async () => {
  const { rank } = await import('../dist/ui/palette.mjs');
  const commands = [
    { id: 'a', title: 'Open BetterSlack', source: 'BetterSlack', run() {} },
    { id: 'b', title: 'Theme builder', source: 'Theme Builder', run() {} },
    { id: 'c', title: 'Enable Midnight', source: 'Themes', run() {} },
  ];

  assert.deepEqual(rank(commands, '').length, 3, 'no query means everything');
  assert.equal(rank(commands, 'theme')[0].id, 'b', 'the one whose title starts with it');
  // Every word has to appear somewhere, in any order.
  assert.deepEqual(rank(commands, 'midnight enable').map((c) => c.id), ['c']);
  assert.deepEqual(rank(commands, 'nothing here').map((c) => c.id), []);
});

test('a command is attributed to the mod it came from', async () => {
  const { createTestApi, installDom } = await import('./harness.mjs');
  const dom = installDom();
  try {
    const { api, recorded } = createTestApi();
    let ran = false;
    const remove = api.commands.add({ id: 'go', title: 'Do the thing', run: () => { ran = true; } });

    assert.equal(recorded.commands.length, 1);
    recorded.commands[0].run();
    assert.equal(ran, true);

    remove();
    assert.equal(recorded.commands.length, 0, 'and it goes when the mod does');
  } finally {
    dom.cleanup();
  }
});
