/**
 * A mod may not be installed into a BetterSlack that cannot run it.
 *
 * Mods update on their own, out of the registry on the default branch, into
 * whatever version the reader happens to have -- so a plugin that starts
 * calling something added last month breaks on every older install, at the
 * first click, with an error that reads as "this plugin is broken". The floor
 * is therefore computed from what the mod calls rather than remembered by hand.
 *
 * These cover the parts that decide: what counts as a use of the API, how two
 * versions compare, and that the answer reaches the registry.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  NO_FLOOR,
  compareVersions,
  floorForMod,
  loadSinceTable,
  usedMembers,
} from '../scripts/api-floor.mjs';

const table = loadSinceTable();

test('every documented API entry says which release it arrived in', () => {
  const groups = Object.entries(table);
  assert.ok(groups.length > 5, 'the table should cover every group');
  for (const [group, members] of groups) {
    for (const [name, since] of Object.entries(members)) {
      assert.ok(
        since === 'unreleased' || /^\d+\.\d+\.\d+$/.test(since),
        `${group}.${name} has since "${since}"`,
      );
    }
  }
});

test('unreleased outranks every release, and releases sort by number', () => {
  assert.equal(compareVersions('unreleased', '99.0.0'), 1);
  assert.equal(compareVersions('2.1.0', 'unreleased'), -1);
  assert.equal(compareVersions('unreleased', 'unreleased'), 0);
  assert.equal(compareVersions('2.1.0', '2.0.1'), 1);
  assert.equal(compareVersions('2.0.1', '2.1.0'), -1);
  assert.equal(compareVersions('2.1.0', '2.1.0'), 0);
  // Numeric, not lexical: "10" is above "9" and a string compare says otherwise.
  assert.equal(compareVersions('2.10.0', '2.9.0'), 1);
});

test('a call is found however the mod reaches the api', () => {
  const qualified = usedMembers('api.slack.openMessage(channel, ts);', table);
  assert.ok(qualified.has('slack.openMessage'));

  // The kit is handed over as an object, and mods do not all call it `kit`.
  const aliased = usedMembers('const ui = api.ui.kit(document); ui.button("Save");', table);
  assert.ok(aliased.has('kit.button'), [...aliased].join(', '));

  const destructured = usedMembers('const { slack } = api; slack.startHuddle(id);', table);
  assert.ok(destructured.has('slack.startHuddle'), [...destructured].join(', '));

  // The tools group is imported rather than received, so its call sites carry
  // no group at all.
  const imported = usedMembers("import { renderMarkdown } from 'x';\nrenderMarkdown(text);", table);
  assert.ok(imported.has('tools.renderMarkdown'), [...imported].join(', '));
});

test('a name that is not part of the API is not mistaken for one', () => {
  // `map` is a method on everything; `notAThing` is on nothing.
  const found = usedMembers('api.slack.notAThing(); list.map((x) => x); other.button();', table);
  assert.deepEqual([...found], []);
});

test('a theme needs no particular version, and a plugin needs what it calls', () => {
  const theme = floorForMod('mods/themes/midnight', table);
  assert.equal(theme.floor, NO_FLOOR, 'a theme runs no code and calls nothing');

  const palette = floorForMod('mods/plugins/command-palette', table);
  assert.notEqual(palette.floor, NO_FLOOR);
  assert.ok(palette.from.length > 0, 'the floor names the calls that set it');
  for (const member of palette.from) {
    const [group, name] = member.split('.');
    assert.equal(table[group][name], palette.floor, `${member} should be at the floor`);
  }
});

test('the registry publishes the floor, so an older install can read it', () => {
  const registry = JSON.parse(readFileSync('mods/registry.json', 'utf8'));
  const byId = new Map(registry.mods.map((mod) => [mod.id, mod]));

  for (const kind of ['plugins', 'themes']) {
    for (const [id, mod] of byId) {
      if (!mod.path?.startsWith(kind)) continue;
      const { floor } = floorForMod(`mods/${mod.path}`, table);
      if (floor === NO_FLOOR) {
        assert.equal(mod.needsBetterSlack, undefined, `${id} needs nothing and should say nothing`);
      } else {
        assert.ok(
          mod.needsBetterSlack !== undefined
            && compareVersions(mod.needsBetterSlack, floor) >= 0,
          `${id} calls things needing ${floor} but the registry says ${mod.needsBetterSlack}`,
        );
      }
    }
  }
});

test('a Slack version is compared over the parts a mod actually states', async () => {
  const { slackVersionIsNewer } = await import('../dist/protocol.mjs');

  // Mods declare two parts and Slack ships three: 4.51 is satisfied by 4.51.191,
  // and a full-length compare would call every mod in the catalogue a mismatch.
  assert.equal(slackVersionIsNewer('4.51', '4.51.191'), false);
  assert.equal(slackVersionIsNewer('4.52', '4.51.191'), true);
  assert.equal(slackVersionIsNewer('4.50', '4.51.191'), false);

  // Unknown is not out of date. Linux cannot name the running version, and a
  // warning that fires where nothing is wrong is one people learn to ignore.
  assert.equal(slackVersionIsNewer('4.99', null), false);
  assert.equal(slackVersionIsNewer('4.99', undefined), false);
  assert.equal(slackVersionIsNewer('nonsense', '4.51.191'), false);
});
