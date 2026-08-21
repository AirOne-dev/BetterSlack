// How the panel orders and files what it shows.
//
// Two shelves, not three: an Enabled one sat between Installed and Browse and
// was a filter wearing a tab's clothes -- everything on it was on Installed as
// well, so the same mod was in two places and switching one off made it vanish
// from under the pointer. What it was for is a sort order now.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sortMods } from '../dist/ui/sort.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

const mod = (id, name) => ({ id, name, type: 'plugin', version: '1.0.0' });

/** Installed oldest-first, which is the order the settings file keeps them in. */
const INSTALLED = ['motion', 'zebra', 'alpha', 'ecran'];
const MODS = [
  mod('alpha', 'Alpha'),
  mod('zebra', 'Zebra'),
  mod('motion', 'Motion'),
  mod('ecran', 'Écran'),
];
const context = (enabled = []) => ({
  installedOrder: INSTALLED,
  isEnabled: (id) => enabled.includes(id),
});
const names = (list) => list.map((m) => m.name);

test('recent is install order, newest first', () => {
  // No timestamp was invented for this: ids are appended to settings.installed
  // as they are installed, so the record was already being kept -- which is why
  // it works for mods somebody installed months before the sort existed.
  assert.deepEqual(
    names(sortMods(MODS, 'recent', context())),
    ['Écran', 'Alpha', 'Zebra', 'Motion'],
  );
});

test('a mod that is not on the list sorts to the end, not to the front', () => {
  // indexOf answers -1, and a Browse shelf is entirely made of mods that are
  // not installed: ordered by that, the whole shelf would come out in no order
  // at all while looking deliberate.
  const withStranger = [...MODS, mod('newcomer', 'Newcomer')];
  assert.equal(names(sortMods(withStranger, 'recent', context())).at(-1), 'Newcomer');
});

test('names sort by locale, so an accent does not file a mod after Z', () => {
  assert.deepEqual(names(sortMods(MODS, 'az', context())), ['Alpha', 'Écran', 'Motion', 'Zebra']);
  assert.deepEqual(names(sortMods(MODS, 'za', context())), ['Zebra', 'Motion', 'Écran', 'Alpha']);
});

test('switched on first, and alphabetical inside each half', () => {
  assert.deepEqual(
    names(sortMods(MODS, 'enabled', context(['zebra', 'motion']))),
    ['Motion', 'Zebra', 'Alpha', 'Écran'],
  );
});

test('sorting never mutates the list it was given', () => {
  const before = names(MODS);
  sortMods(MODS, 'za', context());
  assert.deepEqual(names(MODS), before, 'the caller keeps the catalogue order it holds');
});

test('the shelves are Installed and Browse, and nothing between them', () => {
  const panel = read('src/runtime/ui/panel.ts');
  assert.match(panel, /type ShelfId = 'installed' \| 'browse';/);
  assert.doesNotMatch(panel, /id: 'enabled', label:/, 'the Enabled shelf is gone');
  // Browse has no install date and nothing on it is switched on, so offering
  // either there would be a control that does nothing.
  assert.match(panel, /browse: \['az', 'za'\]/);
});

test('each update notice is on the tab that owns it', () => {
  const panel = read('src/runtime/ui/panel.ts');
  assert.match(panel, /if \(this\.tab === 'about'\) body\.append\(\.\.\.this\.renderUpdate\(\)\)/);
  assert.match(
    panel,
    /renderModUpdates\(this\.tab === 'themes' \? 'theme' : 'plugin'\)/,
    'a plugin update belongs under Plugins, not under Themes',
  );
  // Safe mode is not an offer; it is the reason nothing on any tab is running.
  assert.match(panel, /body\.append\(\.\.\.this\.renderSafeMode\(\)\);/);
});
