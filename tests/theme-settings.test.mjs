// A theme with settings, which is a theme that still runs no code.
//
// The rule this has to respect is the one a `script` field broke when it was
// tried and removed: a theme is CSS. So a theme names the custom property each
// setting writes, and the runtime writes it -- the theme never reads anything.
// These tests are about the writing: what lands in the stylesheet, in what
// order, and what happens to it when the theme goes off.

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { StyleManager } from '../dist/themes.mjs';

async function withDom(run) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>');
  const previous = ['document', 'window'].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]);
  for (const key of ['document', 'window']) {
    Object.defineProperty(globalThis, key, { value: dom.window[key] ?? dom.window, configurable: true, writable: true });
  }
  try {
    return await run();
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor === undefined) delete globalThis[key];
      else Object.defineProperty(globalThis, key, descriptor);
    }
    dom.window.close();
  }
}

/** The layer order the runtime relies on, without booting the whole manager. */
const sheets = () => [...document.querySelectorAll('style[data-betterslack-style]')]
  .map((node) => ({ key: node.getAttribute('data-betterslack-style'), css: node.textContent }));

test('the variables land after the theme they belong to', async () => {
  await withDom(() => {
    const styles = new StyleManager();
    styles.set('theme', 'terminal', ':root { --term-green: #35e07f; }');
    styles.set('theme', 'terminal:vars', ':root { --term-green: #ff00ff; }');

    const order = sheets().map((s) => s.key);
    assert.deepEqual(order, ['theme:terminal', 'theme:terminal:vars'],
      'the override is written after, so it wins on order rather than specificity');
  });
});

test('a theme going off takes its variables with it', async () => {
  await withDom(() => {
    const styles = new StyleManager();
    styles.set('theme', 'terminal', ':root {}');
    styles.set('theme', 'terminal:vars', ':root { --term-green: #ff00ff; }');
    styles.remove('theme', 'terminal');
    styles.remove('theme', 'terminal:vars');
    assert.deepEqual(sheets(), [],
      'left behind they would paint a theme that is off, and beat the next one');
  });
});

test('Terminal declares its colours against real properties', async () => {
  const { readFileSync } = await import('node:fs');
  const manifest = JSON.parse(readFileSync('mods/themes/terminal/mod.json', 'utf8'));
  const css = readFileSync('mods/themes/terminal/theme.css', 'utf8');

  assert.equal(manifest.settings.length, 3);
  for (const field of manifest.settings) {
    assert.equal(field.type, 'colour');
    assert.match(field.cssVar, /^--[a-z0-9-]+$/);
    // The property has to be one the theme actually paints with, or the
    // setting is a control that changes nothing.
    assert.ok(css.includes(`${field.cssVar}:`), `${field.cssVar} is declared by the theme`);
    assert.ok(css.includes(`var(${field.cssVar})`), `${field.cssVar} is used by the theme`);
  }
});

test('nothing in Terminal derives from a colour written out by hand', async () => {
  /*
   * Twenty-five rules held a tint of the phosphor as literal
   * `rgba(53, 224, 127, …)`. A colour chosen in the panel would have reached
   * the tokens and none of those, which is a theme half-repainted with no error
   * to explain it.
   */
  const { readFileSync } = await import('node:fs');
  const css = readFileSync('mods/themes/terminal/theme.css', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const literal = css.match(/rgba?\(\s*53,\s*224,\s*127|rgba?\(\s*255,\s*182,\s*56/g) ?? [];
  assert.deepEqual(literal, [], 'derive from the property, not from the colour');
});

test('the legacy triplet families get a triplet', async () => {
  // `--sk_*` takes bare `r, g, b`; a var() holding a hex parses there and
  // paints nothing. The runtime writes `<name>-rgb` alongside the colour.
  const { readFileSync } = await import('node:fs');
  const css = readFileSync('mods/themes/terminal/theme.css', 'utf8');
  assert.match(css, /--sk_foreground_max: var\(--term-green-rgb\)/);
  assert.match(css, /--term-green-rgb: 53, 224, 127;/, 'with a default for when nothing is set');
});
