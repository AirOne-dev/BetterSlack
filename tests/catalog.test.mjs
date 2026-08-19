// What happens to a mod folder the loader will not accept.
//
// A refused mod is dropped from the catalogue, so it is simply absent from
// Browse -- and "a mod I added is not there" is the report that follows. The
// reason has to survive as far as the user: `Catalog.errors` is what the loader
// prints and what it now sends to the panel, so these tests are about that list
// carrying something a person can act on, not merely being non-empty.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Catalog, scanRoot } from '../dist/catalog.mjs';

/** A scratch mods root, with the folders the scanner expects. */
async function root(mods) {
  const dir = await mkdtemp(path.join(tmpdir(), 'betterslack-catalog-'));
  for (const [where, files] of Object.entries(mods)) {
    const folder = path.join(dir, where);
    await mkdir(folder, { recursive: true });
    for (const [name, body] of Object.entries(files)) {
      await writeFile(path.join(folder, name), body, 'utf8');
    }
  }
  return dir;
}

const manifest = (over = {}) => JSON.stringify({
  id: 'demo',
  name: 'Demo',
  type: 'plugin',
  version: '1.0.0',
  author: 'someone',
  description: 'One sentence.',
  entry: 'index.js',
  betterslackApi: 1,
  ...over,
});

test('a mod that is fine is listed and reports nothing', async () => {
  const dir = await root({ 'plugins/demo': { 'mod.json': manifest(), 'index.js': 'export default {};' } });
  try {
    const scan = await scanRoot(dir, 'builtin');
    assert.deepEqual(scan.errors, []);
    assert.deepEqual(scan.mods.map((m) => m.id), ['demo']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an id that does not match its folder is refused, and says so', async () => {
  // The commonest way a hand-written mod is silently missing: the folder was
  // renamed and the manifest was not.
  const dir = await root({ 'plugins/renamed': { 'mod.json': manifest(), 'index.js': '' } });
  try {
    const scan = await scanRoot(dir, 'builtin');
    assert.equal(scan.mods.length, 0);
    assert.equal(scan.errors.length, 1);
    assert.match(scan.errors[0], /renamed/, 'the folder is named');
    assert.match(scan.errors[0], /"demo"/, 'and so is the id that disagrees with it');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a missing entry file is refused at scan, not at enable-time', async () => {
  const dir = await root({ 'plugins/demo': { 'mod.json': manifest() } });
  try {
    const scan = await scanRoot(dir, 'builtin');
    assert.equal(scan.mods.length, 0);
    assert.equal(scan.errors.length, 1);
    assert.match(scan.errors[0], /index\.js/, 'the file that is missing is named');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a manifest that is not JSON names the file', async () => {
  const dir = await root({ 'plugins/demo': { 'mod.json': '{ oops', 'index.js': '' } });
  try {
    const scan = await scanRoot(dir, 'builtin');
    assert.equal(scan.mods.length, 0);
    assert.match(scan.errors[0], /mod\.json/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('one bad folder does not take the others with it', async () => {
  // The shape of the report that matters: some mods appear and some do not.
  const dir = await root({
    'plugins/demo': { 'mod.json': manifest(), 'index.js': '' },
    'plugins/broken': { 'mod.json': '{ oops', 'index.js': '' },
    'themes/nice': {
      'mod.json': manifest({ id: 'nice', type: 'theme', entry: 'theme.css' }),
      'theme.css': ':root {}',
    },
  });
  try {
    const scan = await scanRoot(dir, 'builtin');
    assert.deepEqual(scan.mods.map((m) => m.id).sort(), ['demo', 'nice']);
    assert.equal(scan.errors.length, 1, 'and exactly one reason to show');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Catalog keeps the reasons where the loader can hand them on', async () => {
  // `Catalog.errors` is what reaches the panel through LoaderInfo.skipped. If
  // this ever stops being populated, Browse goes back to being silent about a
  // mod that is not in it.
  const dir = await root({ 'plugins/broken': { 'mod.json': '{ oops', 'index.js': '' } });
  const empty = await root({});
  try {
    const catalog = new Catalog(dir, empty);
    const mods = await catalog.refresh();
    assert.deepEqual(mods, []);
    assert.equal(catalog.errors.length, 1);
    assert.match(catalog.errors[0], /broken/);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(empty, { recursive: true, force: true });
  }
});
