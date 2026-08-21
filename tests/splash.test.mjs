// The screen that covers Slack while BetterSlack starts.
//
// It is a decoration over the whole application, which is the entire reason it
// is tested: a decoration with the power to hide someone's Slack has to be
// unable to hide it for ever, unable to throw inside boot, and unable to appear
// at a moment when there is nowhere to put it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { showSplash } from '../dist/ui/splash.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

async function withDom(html, run) {
  const dom = new JSDOM(html, { pretendToBeVisual: true });
  // Node's own timers, deliberately: jsdom's are bound to its window, and
  // calling one with globalThis as its receiver recurses until the stack goes.
  const keys = ['document', 'window', 'MutationObserver', 'navigator'];
  const previous = keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]);
  for (const key of keys) {
    Object.defineProperty(globalThis, key, {
      value: dom.window[key] ?? dom.window, configurable: true, writable: true,
    });
  }
  try {
    return await run(dom);
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    dom.window.close();
  }
}

const hostIn = (dom) => dom.window.document.getElementById('betterslack-splash');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('it covers the app, in a shadow root of its own', async () => {
  await withDom('<!doctype html><html><head></head><body></body></html>', async (dom) => {
    const splash = showSplash();
    const host = hostIn(dom);
    assert.ok(host, 'it is on screen');
    // A shadow root, because at document-start Slack's stylesheet has not
    // loaded and a theme may repaint everything a moment later.
    assert.ok(host.shadowRoot, 'and isolated from whatever Slack does to the page');
    assert.ok(host.shadowRoot.querySelector('.mark svg'), 'with the mark in it');
    assert.equal(host.getAttribute('aria-hidden'), 'true', 'and out of the accessibility tree');
    splash.done();
  });
});

test('at document-start there is no body, and it waits for one', async () => {
  /*
   * The runtime is injected before Slack's markup exists, so `document.body` is
   * genuinely null here -- the same state that made `StyleManager` throw and
   * take the whole bundle down. Nothing is built until there is somewhere to
   * put it.
   */
  await withDom('<!doctype html><html></html>', async (dom) => {
    const { document: doc } = dom.window;
    doc.documentElement.remove();
    const splash = showSplash();
    assert.equal(hostIn(dom), null, 'nothing yet, and nothing thrown');

    const html = doc.createElement('html');
    html.append(doc.createElement('head'), doc.createElement('body'));
    doc.append(html);
    await wait(30);

    assert.ok(hostIn(dom), 'it appears as soon as the page does');
    splash.done();
  });
});

test('done() before it ever appeared leaves nothing behind', async () => {
  await withDom('<!doctype html><html></html>', async (dom) => {
    dom.window.document.documentElement.remove();
    showSplash().done();

    const { document: doc } = dom.window;
    const html = doc.createElement('html');
    html.append(doc.createElement('head'), doc.createElement('body'));
    doc.append(html);
    await wait(30);

    assert.equal(hostIn(dom), null, 'a cancelled splash does not turn up later');
  });
});

test('it names what is starting, so a slow mod is not a guess', async () => {
  await withDom('<!doctype html><html><head></head><body></body></html>', async (dom) => {
    const splash = showSplash();
    splash.progress('Motion', 6, 13);
    const text = hostIn(dom).shadowRoot.querySelector('.label').textContent;
    assert.match(text, /Motion/);
    // Counted from one: "6 of 13" while the seventh is the one being started
    // would be off by one on the only number anybody reads.
    assert.match(text, /7/);
    assert.match(text, /13/);
    splash.done();
  });
});

test('it cannot stay for ever', () => {
  // A screen over the whole app that never lifts is worse than no screen at
  // all, and this project has already had two ways to be locked out of Slack.
  const source = read('src/runtime/ui/splash.ts');
  assert.match(source, /const CEILING_MS = 20_000;/, 'there is a ceiling');
  assert.match(source, /const ceiling = setTimeout\(/, 'and it is armed when the splash goes up');
  assert.match(source, /clearTimeout\(ceiling\)/, 'and disarmed when it comes down normally');

  const boot = read('src/runtime/index.ts');
  // A boot that threw would otherwise leave the app behind a logo.
  assert.match(boot, /catch \(err\) \{\s*\n[\s\S]{0,220}?splash\.done\(\);\s*\n\s*throw err;/);
});

test('nothing in it is built while the module is being evaluated', () => {
  /*
   * This file is imported at document-start. `createI18n` reads the language
   * off `document.documentElement`, which is null there -- a translator built
   * at module scope threw and took the whole bundle down, which is how the
   * runtime ended up arriving through the loader's re-injection fallback
   * against a half-built DOM, which is where both renderer freezes came from.
   */
  const source = read('src/runtime/ui/splash.ts');
  assert.doesNotMatch(
    source,
    /^const \w+ = createI18n\(/m,
    'the translator must be built on first use, not on import',
  );
  assert.match(source, /translator \?\?= createI18n\(\)/, 'lazily, and cached');
});

test('every shape is wrapped, because a CSS transform replaces an attribute one', async () => {
  /*
   * Three of the four bars are placed by a transform attribute -- the mark is
   * one bar drawn four times, rotated. A CSS transform on the same element
   * replaces that attribute outright instead of composing with it, so animating
   * the rects threw cyan, green and yellow back to their unrotated positions
   * and the mark came apart for the whole animation. The group takes the
   * animation and the rect keeps its placement.
   */
  await withDom('<!doctype html><html><head></head><body></body></html>', async (dom) => {
    const splash = showSplash();
    const svg = hostIn(dom).shadowRoot.querySelector('.mark svg');
    const groups = [...svg.children];
    assert.equal(groups.length, 8, 'four bars and four elbows');
    for (const group of groups) {
      assert.equal(group.tagName, 'g', 'each shape has a group of its own');
      assert.equal(group.children.length, 1);
      assert.ok(/^(rect|path)$/.test(group.firstElementChild.tagName));
    }
    // The placement the animation must not touch.
    const placed = groups.filter((g) => g.firstElementChild.hasAttribute('transform'));
    assert.equal(placed.length, 3, 'three bars are rotated copies of the first');
    for (const group of placed) {
      assert.equal(group.hasAttribute('transform'), false, 'and the group carries none of its own');
    }
    splash.done();
  });
});

test('the lap goes round the mark once, in order', () => {
  /*
   * The bars are the four sides of an open square, and each is drawn from the
   * end the previous one arrived at -- cyan across the top left to right, green
   * down the right, yellow back along the bottom, red up the left. Worked out
   * from the drawing: the rects are 121 by 421 at x 139..260 y 289..710 and its
   * three rotations, which is one clockwise circuit.
   *
   * The origins are what encode that, so they are what is checked: a lap with
   * one of them at the wrong end is a bar that grows backwards, which reads as
   * a stutter rather than as a mistake.
   */
  const source = read('src/runtime/ui/splash.ts');
  const lap = (name) => source.match(new RegExp(`@keyframes ${name} \\{[\\s\\S]*?\\n\\}`))?.[0] ?? '';

  const ends = {
    'lap-top': ['139px 199.5px', '560px 199.5px'],
    'lap-right': ['648.5px 139px', '648.5px 560px'],
    'lap-bottom': ['709px 649.5px', '288px 649.5px'],
    'lap-left': ['199.5px 710px', '199.5px 289px'],
  };
  for (const [name, [from, to]] of Object.entries(ends)) {
    const block = lap(name);
    assert.ok(block, `${name} must exist`);
    assert.ok(block.indexOf(from) < block.indexOf(to), `${name} grows from ${from} and leaves by ${to}`);
  }

  // A quarter of the cycle apart, so one light travels rather than four blink.
  for (const delay of ['0s', '.55s', '1.1s', '1.65s']) {
    assert.ok(source.includes(`animation-delay: ${delay}`), `a bar starts at ${delay}`);
  }
});
