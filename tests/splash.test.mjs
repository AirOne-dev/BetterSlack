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
