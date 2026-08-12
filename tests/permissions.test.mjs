// The permission system, tested where it is actually enforced.
//
// A theme's companion script is the one place in SlackMod where installing
// something can run code the "theme" label did not lead anyone to expect. The
// promise made to the user is narrow and worth pinning down: the consent dialog
// names exactly what the manifest declares, nothing runs before the answer, and
// removing a mod forgets the answer.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const protocol = readFileSync(path.join(root, 'src/shared/protocol.ts'), 'utf8');
const validator = readFileSync(path.join(root, 'scripts/validate-mods.mjs'), 'utf8');

/** Names declared in PERMISSIONS in the shared protocol. */
function protocolPermissions() {
  const block = protocol.match(/export const PERMISSIONS[^{]*\{([\s\S]*?)\n\};/);
  assert.ok(block, 'PERMISSIONS must be a top-level object literal');
  return [...block[1].matchAll(/^\s{2}([a-z][a-zA-Z0-9]*):\s*\{/gm)].map((m) => m[1]);
}

test('the validator knows the same permissions as the runtime', () => {
  // validate-mods.mjs runs without a build step, so it cannot import the
  // TypeScript source and keeps its own copy. This is the check that stops the
  // two drifting: a permission added to one and not the other would either be
  // rejected in CI or accepted without ever being described in a dialog.
  const copy = validator.match(/const PERMISSIONS = \[([^\]]*)\]/);
  assert.ok(copy, 'validate-mods.mjs must declare PERMISSIONS as an array literal');
  const inValidator = [...copy[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(inValidator.sort(), protocolPermissions().sort());
});

test('every permission has a title and a detail a person can weigh', () => {
  for (const name of protocolPermissions()) {
    const entry = protocol.match(new RegExp(`\\n  ${name}: \\{([\\s\\S]*?)\\n  \\},`));
    assert.ok(entry, `${name} must be a full entry`);
    assert.match(entry[1], /title:/, `${name} needs a title`);
    assert.match(entry[1], /detail:/, `${name} needs a detail`);
  }
});

test('the runtime checks the grant before loading a theme script', () => {
  const manager = readFileSync(path.join(root, 'src/runtime/manager.ts'), 'utf8');
  const fn = manager.match(/private async applyThemeScript[\s\S]*?\n  \}/);
  assert.ok(fn, 'applyThemeScript must exist');
  const body = fn[0];
  // Order matters, not just presence: the guard has to come before the load.
  const guard = body.indexOf('isGranted');
  const load = body.indexOf('themeScripts.load');
  assert.ok(guard !== -1 && load !== -1, 'both the guard and the load must be there');
  assert.ok(guard < load, 'the grant is checked before the script is loaded, not after');
});

test('removing a mod forgets what it was allowed to do', () => {
  const store = readFileSync(path.join(root, 'src/loader/store.ts'), 'utf8');
  const fn = store.match(/export function setModInstalled[\s\S]*?\n\}/);
  assert.ok(fn, 'setModInstalled must exist');
  assert.match(fn[0], /delete grants\[id\]/, 'uninstalling must drop the grant');
});

test('grants are filtered on read rather than trusted', () => {
  const store = readFileSync(path.join(root, 'src/loader/store.ts'), 'utf8');
  assert.match(store, /function readGrants/, 'settings.json is user-editable input');
  assert.match(store, /filter\(isPermission\)/, 'unknown names must not survive a read');
});

test('a plugin cannot declare a second script', () => {
  const catalog = readFileSync(path.join(root, 'src/loader/catalog.ts'), 'utf8');
  assert.match(catalog, /"script" is for themes only/);
  assert.match(catalog, /"script" requires the "layout" permission/);
});

test('every shipped mod that declares a script also declares layout', async () => {
  const { listMods } = await import('../scripts/test-mods.mjs');
  let withScripts = 0;
  for (const mod of listMods()) {
    const manifest = JSON.parse(readFileSync(path.join(mod.dir, 'mod.json'), 'utf8'));
    if (!manifest.script) {
      assert.ok(
        !manifest.permissions?.length,
        `${mod.id} asks for permissions but has no script to use them`,
      );
      continue;
    }
    withScripts++;
    assert.equal(manifest.type, 'theme', `${mod.id}: only themes may carry a script`);
    assert.ok(
      manifest.permissions?.includes('layout'),
      `${mod.id}: a script requires the layout permission`,
    );
  }
  // Not an assertion about the count, a note in the output: this number is how
  // many mods in the catalogue can run code beyond their kind.
  assert.ok(withScripts >= 0);
});
