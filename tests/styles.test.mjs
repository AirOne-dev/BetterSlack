// Who owns a plugin's stylesheet.
//
// A plugin writes CSS two ways: `api.css`, which replaces its stylesheet
// whole, and helpers -- `toggle({ whenOn })`, `badge`, `tooltip` -- which write
// CSS of their own. Those two used to share one <style> node, so a mod that
// used both kept only whichever wrote last.
//
// It was not theoretical. A shipped mod called `toggle({ whenOn })` to hide the
// sidebar and then `api.css` to style its indicator, and shipped folding
// nothing away at all. Its own tests passed: they asserted on every call the
// mod made, and the bug is that only one of those calls survives. That mod has
// since been removed from the catalogue, which is why the third test below
// carries its shape as a fixture rather than importing it -- the regression
// outlives any one mod, and a test that can be deleted along with its subject
// is not covering the runtime.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { StyleManager } from '../dist/themes.mjs';
import { createHelpers } from '../dist/helpers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Async-aware on purpose: a try/finally around a *returned* promise tears the
// globals down before the body has run, and the failure that produces --
// "document is not defined" from inside a mod -- looks like the mod's bug.
async function withDom(run) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>');
  const previous = ['document', 'window'].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]);
  for (const key of ['document', 'window']) {
    Object.defineProperty(globalThis, key, { value: dom.window[key] ?? dom.window, configurable: true, writable: true });
  }
  try {
    return await run(dom);
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor === undefined) delete globalThis[key];
      else Object.defineProperty(globalThis, key, descriptor);
    }
    dom.window.close();
  }
}

test('two ids in one layer are two nodes, and neither erases the other', async () => {
  await withDom(() => {
    const styles = new StyleManager();
    styles.set('plugin', 'demo', '.a { color: red }');
    styles.set('plugin', 'demo:helpers', '.b { color: blue }');
    styles.set('plugin', 'demo', '.a { color: green }');

    const text = [...document.querySelectorAll('style')].map((n) => n.textContent).join('\n');
    assert.ok(text.includes('.b { color: blue }'), 'the helpers sheet is still there');
    assert.ok(text.includes('.a { color: green }'), 'and the plugin sheet was replaced, not appended');
    assert.equal(text.includes('color: red'), false, 'replaced whole, which is the documented contract');
  });
});

test('the helpers are wired to a node of their own', () => {
  // A source check rather than a behavioural one: `createApi` is not built for
  // the test bundle, and what matters is the one line that decides which node
  // the helpers write to. If this moves, move the test with it.
  const source = readFileSync(path.join(root, 'src/runtime/api.ts'), 'utf8');
  assert.match(
    source,
    /createHelpers\(\{[\s\S]*?css:[\s\S]*?styles\.set\('plugin', `\$\{record\.id\}:helpers`/,
    'helpers write to <id>:helpers, not to the plugin id',
  );
});

test('a mod using both keeps both, which is what the bug was', async () => {
  await withDom(async () => {
    const sheets = { plugin: '', helpers: '' };
    const store = {};
    const settings = {
      get: (key, fallback) => (key in store ? store[key] : fallback),
      set: async (key, value) => { store[key] = value; },
    };

    // Both sinks kept apart exactly as the runtime keeps them.
    const helpers = createHelpers({
      pluginId: 'fixture',
      css: (text) => { sheets.helpers = text; },
      toast: () => {},
      settings,
      track: (fn) => fn,
    });

    /*
     * The shape the bug had: a `whenOn` rule that hides something, and an
     * `api.css` call that styles the mod's own indicator. Either one alone
     * passes whichever way the runtime is wired; only both together catch a
     * shared style node.
     */
    await helpers.toggle({
      key: 'on',
      className: 'betterslack-fixture-on',
      initial: true,
      whenOn: 'html.betterslack-fixture-on .p-channel_sidebar { display: none }',
    });
    const api = { css: (text) => { sheets.plugin = text; } };
    api.css('.betterslack-fixture-indicator { position: fixed }');

    assert.ok(sheets.helpers.includes('p-channel_sidebar'), 'it really does hide the sidebar');
    assert.ok(sheets.plugin.includes('betterslack-fixture-indicator'), 'and really does draw its indicator');
  });
});

test('a stylesheet written before the document has a head is not lost', async () => {
  /*
   * The runtime is injected at document-start, so `document.head` is genuinely
   * null there -- and reading `querySelector` off it threw, which took the
   * whole bundle down at evaluation. It was silent because the loader's
   * re-injection fallback works: the mods arrived anyway, against a DOM Slack
   * had already half built, which is exactly where both renderer freezes came
   * from. Seen twice in four launches of a real client.
   */
  const dom = new JSDOM('<!doctype html><html></html>');
  const { document: doc } = dom.window;
  doc.documentElement.remove();
  // MutationObserver as well as the document: this is the one path in
  // StyleManager that has to wait for the page to arrive, so it is the one that
  // needs it.
  const keys = ['document', 'window', 'MutationObserver'];
  const previous = keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]);
  for (const key of keys) {
    Object.defineProperty(globalThis, key, { value: dom.window[key] ?? dom.window, configurable: true, writable: true });
  }
  try {
    const styles = new StyleManager();
    // No head, no documentElement: the state the document-start script sees.
    assert.equal(doc.head, null, 'the fixture really is a document with no head');
    styles.set('plugin', 'fixture', '.betterslack-fixture { color: red }');

    // Slack's own markup arrives, the way it does a moment later.
    const html = doc.createElement('html');
    html.append(doc.createElement('head'), doc.createElement('body'));
    doc.append(html);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const node = doc.head.querySelector('style[data-betterslack-style="plugin:fixture"]');
    assert.ok(node, 'the stylesheet lands once there is a head to land in');
    assert.match(node.textContent, /betterslack-fixture/);
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    dom.window.close();
  }
});
