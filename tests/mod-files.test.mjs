// A mod is a folder.
//
// The page has no 'unsafe-eval', so a plugin is loaded as a real ES module
// through a blob: URL -- and a blob URL has no directory, so `import './x.js'`
// inside one resolves to nothing. The runtime therefore builds one blob per
// file, leaves-first, and rewrites each relative specifier to the blob URL of
// the file it names. A theme gets the same treatment through @import, inlined
// into the single <style> element the page receives.
//
// These run the real resolver over real folders. Node cannot `import()` a
// blob: URL, but it can fetch one, which is enough to assert that what came out
// is the module that would have run.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildModuleGraph } from '../dist/plugins.mjs';
import { inlineCssImports, resolvePath } from '../dist/themes.mjs';
import { readModFiles } from './harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (url) => fetch(url).then((r) => r.text());

test('a relative import becomes the blob of the file it names', async () => {
  const files = {
    'index.js': "import { hello } from './lib/greet.js';\nexport default { start: () => hello() };",
    'lib/greet.js': "export const hello = () => 'hi';",
  };
  const { url, urls } = buildModuleGraph(files, 'index.js');
  const entry = await source(url);

  assert.doesNotMatch(entry, /'\.\/lib\/greet\.js'/, 'the relative path is gone');
  assert.match(entry, /from "blob:|from 'blob:/, 'and a blob URL is in its place');
  assert.equal(urls.length, 2, 'one blob per file, so unload can revoke them all');

  const imported = entry.match(/blob:[^'"]+/)[0];
  assert.equal(await source(imported), files['lib/greet.js'], 'pointing at the right file');
});

test('everything else in the module is left exactly as written', async () => {
  // The module that runs must be the module the author wrote; only specifiers
  // change. A rewrite that reformatted code would make every stack trace lie.
  const body = [
    "import { a } from './a.js';",
    "const label = 'imported from a colleague';", // reads like a specifier, is not
    'export default { start: () => a(label) };',
  ].join('\n');
  const { url } = buildModuleGraph({ 'index.js': body, 'a.js': 'export const a = (x) => x;' }, 'index.js');

  const out = await source(url);
  assert.match(out, /const label = 'imported from a colleague';/);
  assert.equal(out.split('\n').length, body.split('\n').length);
});

test('a file imported twice is built once, and shares one blob', async () => {
  const files = {
    'index.js': "import './a.js';\nimport './b.js';",
    'a.js': "export { x } from './shared.js';",
    'b.js': "export { x } from './shared.js';",
    'shared.js': 'export const x = 1;',
  };
  const { url, urls } = buildModuleGraph(files, 'index.js');
  assert.equal(urls.length, 4, 'four files, four blobs -- not five');

  // Module identity matters: two blobs of the same source are two modules with
  // two copies of its state, which is a bug nobody would find by reading.
  const entry = await source(url);
  const [aUrl, bUrl] = [...entry.matchAll(/blob:[^'"]+/g)].map((m) => m[0]);
  const [a, b] = await Promise.all([source(aUrl), source(bUrl)]);
  const shared = (text) => text.match(/blob:[^'"]+/)[0];
  assert.equal(shared(a), shared(b), 'both reach the same instance of shared.js');
});

test('a cycle is an error, not a hang', () => {
  const files = {
    'index.js': "import './a.js';",
    'a.js': "import './b.js';",
    'b.js': "import './a.js';",
  };
  assert.throws(() => buildModuleGraph(files, 'index.js'), /circular import/);
});

test('importing a file that is not there names the file', () => {
  assert.throws(
    () => buildModuleGraph({ 'index.js': "import './missing.js';" }, 'index.js'),
    /"missing\.js" is imported but not in the mod folder/,
  );
});

test('a bare specifier is left alone, to fail loudly at import time', async () => {
  // There is no package manager in the page and never will be. Rewriting this
  // to something is worse than letting the import throw with the name in it.
  const { url } = buildModuleGraph({ 'index.js': "import _ from 'lodash';" }, 'index.js');
  assert.match(await source(url), /'lodash'/);
});

test('relative paths resolve the way a module loader would', () => {
  assert.equal(resolvePath('index.js', './lib/x.js'), 'lib/x.js');
  assert.equal(resolvePath('ui/panel.js', '../lib/x.js'), 'lib/x.js');
  assert.equal(resolvePath('ui/panel.js', './parts/row.js'), 'ui/parts/row.js');
  assert.equal(resolvePath('a/b/c.js', '../../top.js'), 'top.js');
});

test('a theme is stitched into one stylesheet, in the order it was imported', () => {
  const css = inlineCssImports(
    {
      'theme.css': "@import './tokens.css';\n@import './chrome.css';\nbody { margin: 0; }",
      'tokens.css': ':root { --a: 1; }',
      'chrome.css': "@import './rail.css';\n.sidebar { color: red; }",
      'rail.css': '.rail { width: 68px; }',
    },
    'theme.css',
  );

  assert.doesNotMatch(css, /@import/, 'nothing left for the page to fetch');
  assert.ok(css.indexOf('--a: 1') < css.indexOf('.rail'), 'depth-first, in source order');
  assert.ok(css.indexOf('.rail') < css.indexOf('.sidebar'), 'an import runs before what follows it');
  assert.ok(css.indexOf('.sidebar') < css.indexOf('body { margin: 0; }'), 'and the entry finishes last');
});

test('a theme that imports itself in a loop drops the loop, not the theme', () => {
  // Unlike a plugin, a theme is cosmetic: the rest of the stylesheet is still
  // worth applying, so the cycle is reported and cut rather than thrown.
  const css = inlineCssImports(
    { 'a.css': "@import './b.css';\n.a { color: red; }", 'b.css': "@import './a.css';\n.b { color: blue; }" },
    'a.css',
  );
  assert.match(css, /\.a \{ color: red; \}/);
  assert.match(css, /\.b \{ color: blue; \}/);
});

test('text that only looks like an import is left alone', () => {
  // Every mod types its api parameter with a JSDoc import(); resolving that
  // would climb out of the folder and fail the mod at load time.
  const files = {
    'index.js': [
      "/** @param {import('../../../src/runtime/api.js').PluginApi} api */",
      "// import './old.js' -- removed, kept as a note",
      "import { x } from './real.js';",
      'export default { start: (api) => x(api) };',
    ].join('\n'),
    'real.js': 'export const x = () => {};',
  };
  const { urls } = buildModuleGraph(files, 'index.js');
  assert.equal(urls.length, 2, 'only the real import was followed');
});

test('an @import inside a CSS comment is not inlined', () => {
  const css = inlineCssImports(
    { 'theme.css': "/* @import './draft.css'; */\nbody { margin: 0; }", 'draft.css': '.draft {}' },
    'theme.css',
  );
  assert.doesNotMatch(css, /\.draft/);
});

test('every mod in this repository resolves as a folder', () => {
  // The gate CI runs is scripts/check-structure.mjs; this is the same claim
  // made against the code that actually does the resolving.
  const registry = JSON.parse(readFileSync(path.join(root, 'mods/registry.json'), 'utf8'));
  for (const mod of registry.mods) {
    const dir = path.join(root, 'mods', mod.type === 'theme' ? 'themes' : 'plugins', mod.id);
    const files = readModFiles(dir);
    if (mod.type === 'theme') {
      assert.doesNotThrow(() => inlineCssImports(files, mod.entry), `${mod.id} stitches`);
    } else {
      assert.doesNotThrow(() => buildModuleGraph(files, mod.entry), `${mod.id} resolves`);
    }
  }
});
