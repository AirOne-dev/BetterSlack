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
  // `before: "#slackmod-control-button"`, so with two of them each kept shoving
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
