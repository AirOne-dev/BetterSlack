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

test('the panel borrows Slack\'s field and Slack\'s select, and draws neither', () => {
  /*
   * Inside the client, borrowing beats drawing: .c-input_text and
   * .c-input_select carry the height, the radius, the border, the 80ms focus
   * transition and every theme, including one somebody is in the middle of
   * editing in the theme builder.
   *
   * And Slack's select is not a `select`. It is a bordered button that opens a
   * c-menu, which is why there is a helper rather than an element: a native
   * dropdown is drawn by the operating system, so on a dark theme it comes up
   * as a white rectangle in the middle of a dark dialog.
   */
  const panel = read('src/runtime/ui/panel.ts');

  assert.doesNotMatch(panel, /h\('select'/, 'no native dropdown anywhere in the panel');
  assert.match(panel, /class: .c-input_select betterslack-select/, 'the select is Slack\'s');
  assert.match(panel, /openMenu\(button, options\.map/, 'and it opens Slack\'s menu');

  // Every text field, not only the filter: two looks in one dialog is worse
  // than either of them.
  const fields = [...panel.matchAll(/h\('input', \{[\s\S]{0,300}?\n\s*\}\)/g)]
    .map((match) => match[0])
    // A colour input is a swatch the browser draws; there is nothing of Slack's
    // to borrow for it.
    .filter((block) => /type: '(text|number)'/.test(block));
  assert.ok(fields.length >= 3, 'the shelf filter, the remote field and the settings inputs');
  for (const field of fields) {
    assert.match(field, /c-input_text/, `a field that is not Slack's: ${field.slice(0, 70)}`);
  }
});

test('Slack\'s form margin is undone, and doubled to win', () => {
  // .c-input_text and .c-input_select both carry margin 0 0 20px, because in
  // Slack they are form fields stacked in a column. Slack's stylesheet loads
  // after ours, so a single class ties on specificity and loses on order --
  // measured: the field kept the 20px, as a gap under the search box.
  const styles = read('src/runtime/ui/styles.ts');
  assert.match(styles, /\.betterslack-search\.betterslack-search,\s*\n\.betterslack-select\.betterslack-select \{\s*\n\s*margin: 0;/);
});

test('focus is a border, not a halo', () => {
  /*
   * Slack draws focus as two stacked shadows -- a 1px ring and a 5px spread at
   * 30% -- and sets the border transparent underneath, so what is left floats
   * where the field's edge was. Read off the live stylesheet:
   *
   *   .c-input_text:focus { box-shadow: 0 0 0 1px var(--sk_focused-shadow-color),
   *     0 0 0 5px color-mix(in srgb, var(--sk_focused-shadow-color) 30%, transparent) }
   *
   * The border replaces it: still visible for anyone arriving by keyboard,
   * which is the one thing taking a focus indicator away may not cost.
   */
  const styles = read('src/runtime/ui/styles.ts');
  const rule = styles.match(/\.betterslack-search\.betterslack-search:focus,[\s\S]*?\}/);
  assert.ok(rule, 'there must be a focus rule of our own');
  assert.match(rule[0], /box-shadow: none;/, 'the halo goes');
  assert.match(rule[0], /border-color: rgba\(var\(--sk_highlight/, 'and the border shows focus instead');
  // A class and a pseudo-class is what Slack's rule scores; one of ours ties
  // and loses on source order, since its stylesheet loads after ours.
  assert.match(rule[0], /\.betterslack-select\.betterslack-select:focus/, 'doubled, to beat it');
});
