// Themes that require plugins.
//
// A theme is CSS and nothing else. When a look needs behaviour, that behaviour
// is a plugin, reviewed and installed as one, and the theme points at it. These
// are the rules that keep that honest: only themes require, only plugins are
// required, the catalogue is self-contained, and switching a theme on never
// switches a plugin on behind the user's back.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

test('only themes may require, and never themselves', () => {
  const catalog = read('src/loader/catalog.ts');
  assert.match(catalog, /"requires" is for themes only/);
  assert.match(catalog, /a theme cannot require itself/);
});

test('a theme is CSS: nothing is left of the script-and-permission system', () => {
  // It was tried and taken back out. Themes doing their own DOM work put a
  // second, weaker plugin model next to the real one, with its own API to keep
  // in step and its own consent dialog to explain.
  for (const rel of [
    'src/shared/protocol.ts',
    'src/loader/catalog.ts',
    'src/loader/store.ts',
    'src/runtime/manager.ts',
    'src/runtime/ui/panel.ts',
  ]) {
    const source = read(rel);
    assert.doesNotMatch(source, /\bpermissions\b/, `${rel} still mentions permissions`);
    assert.doesNotMatch(source, /\bgrants\b/, `${rel} still mentions grants`);
  }
});

test('the panel asks before switching a required plugin on', () => {
  const panel = read('src/runtime/ui/panel.ts');
  const fn = panel.match(/private async enableWithRequirements[\s\S]*?\n  \}/);
  assert.ok(fn, 'enableWithRequirements must exist');
  const body = fn[0];
  const ask = body.indexOf('requestRequirements');
  const turnOn = body.indexOf('setEnabled(plugin.id, true)');
  assert.ok(ask !== -1 && turnOn !== -1, 'it must both ask and act');
  assert.ok(ask < turnOn, 'the question comes before the plugin is enabled, not after');
});

test('declining still enables the theme', () => {
  const panel = read('src/runtime/ui/panel.ts');
  const fn = panel.match(/private async enableWithRequirements[\s\S]*?\n  \}/)[0];
  // The theme is a stylesheet either way. Refusing to apply it because the user
  // said no to a plugin would be punishing them for answering.
  const last = fn.lastIndexOf('setEnabled(mod.id, true)');
  assert.ok(last !== -1, 'the theme is enabled unconditionally at the end');
  assert.ok(!/if[^}]*setEnabled\(mod\.id, true\)/.test(fn), 'and not inside the accepted branch');
});

test('every requirement in the catalogue exists and is a plugin', async () => {
  const { listMods } = await import('../scripts/test-mods.mjs');
  const mods = listMods().map((mod) => ({
    ...mod,
    manifest: JSON.parse(readFileSync(path.join(mod.dir, 'mod.json'), 'utf8')),
  }));
  const byId = new Map(mods.map((mod) => [mod.id, mod.manifest]));

  for (const mod of mods) {
    const requires = mod.manifest.requires ?? [];
    if (requires.length > 0) {
      assert.equal(mod.manifest.type, 'theme', `${mod.id}: only themes may require`);
    }
    for (const id of requires) {
      const target = byId.get(id);
      assert.ok(target, `${mod.id} requires "${id}", which this repository does not ship`);
      assert.equal(target.type, 'plugin', `${mod.id} requires "${id}", which is not a plugin`);
    }
  }
});

/**
 * Slack ships `.c-dialog` at opacity 0 and fades it in itself. Anything of ours
 * wearing that class has to say otherwise, or it renders in the document,
 * takes focus, and shows nothing. It cost a screenshot to notice once.
 */
test('every dialog we build overrides Slack’s opacity: 0', () => {
  const widgets = read('src/runtime/ui/widgets.ts');
  const styles = read('src/runtime/ui/styles.ts');

  const hosts = new Set(['betterslack-panel']);
  for (const [, classes] of widgets.matchAll(/class:\s*'([^']*\bc-dialog\b[^']*)'/g)) {
    for (const name of classes.split(/\s+/)) {
      if (name.startsWith('betterslack-') && name !== 'betterslack-dialog') hosts.add(name);
    }
  }
  assert.ok(hosts.size > 1, 'the modal host class must be discoverable');

  for (const host of hosts) {
    const rule = new RegExp(`[#.]${host}[^{]*\\{[^}]*opacity:\\s*1`);
    assert.match(styles, rule, `${host} must set opacity: 1`);
  }
});

/**
 * PANEL_CSS is a template literal. A backticked `.c-dialog` inside one of its
 * comments closes the string, and the rest parses as JavaScript that builds
 * cleanly and throws `ReferenceError: dialog is not defined` at boot — no
 * styling, no panel, no mods, and nothing pointing at a comment. Twice now.
 */
test('no backtick can sneak into a stylesheet that ships as a string', () => {
  // Every one of them, not only the panel's: the kit's stylesheet and the code
  // editor's are template literals for the same reason and would fail the same
  // way, in a window with no DevTools to open.
  //
  // The check is not "is there a backtick in the CSS" -- the first one closes
  // the literal, so by then it is code. It is: does the literal end where the
  // declaration does. Anything between the closing backtick and the semicolon
  // must be a plain concatenation, which is what CSS-turned-JavaScript is not.
  for (const [file, name] of [
    ['src/runtime/ui/styles.ts', 'PANEL_CSS'],
    ['src/runtime/ui/kit-css.ts', 'KIT_CSS'],
    ['src/runtime/ui/code.ts', 'CODE_CSS'],
  ]) {
    const declaration = read(file).split(`export const ${name} = `)[1];
    assert.ok(declaration, `${name} must exist`);
    const opened = declaration.indexOf('`');
    assert.notEqual(opened, -1, `${name} must be a template literal`);
    const closed = declaration.indexOf('`', opened + 1);
    assert.notEqual(closed, -1, `${name} never closes its literal`);
    const after = declaration.slice(closed + 1).split('\n')[0];
    assert.match(
      after,
      /^\s*(\+\s*[A-Za-z_$][\w$]*\s*)?;/,
      `${name} carries a backtick: the literal closed early and the CSS after it is code`,
    );
  }
});

/**
 * Switching workspace does not reload the client, so anything cached at boot
 * outlives the workspace it belongs to. The session token is the one that
 * matters: keep it past a switch and every call goes out for the wrong team,
 * which Slack reports as ordinary errors and which looks like broken plugins.
 */
test('the session token is cached per workspace, not once', () => {
  const source = read('src/runtime/web-api.ts');
  const fn = source.match(/export function createWebApi[\s\S]*?const call =/);
  assert.ok(fn, 'createWebApi must exist');
  assert.match(fn[0], /currentTeamId\(\)/, 'the cache has to be keyed by the team in the URL');
  assert.match(fn[0], /team !== cachedTeam/, 'and re-read when it changes');
});
