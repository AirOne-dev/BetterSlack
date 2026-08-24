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

/*
 * Switching tab in the panel.
 *
 * The panel rebuilds itself wholesale on every change, and one toggle causes
 * several renders in a frame, so an animation that ran whenever the body
 * mounted would flicker on every click in the list rather than mark the one
 * thing it is for. The class therefore goes on only when the tab really
 * changed -- which is a fact about panel.ts, not about the stylesheet, and is
 * exactly the sort of thing that gets "simplified" away later.
 */
test('the panel animates a tab change, and only a tab change', () => {
  const panel = read('src/runtime/ui/panel.ts');
  assert.match(
    panel,
    /const tabChanged = this\.renderedTab !== null && this\.renderedTab !== this\.tab;/,
    'a render knows whether the tab changed',
  );
  assert.match(panel, /tabChanged \? ' betterslack-body--enter' : ''/, 'and only then is the body stamped');
  assert.match(panel, /this\.renderedTab = null;/, 'opening the panel starts a fresh sequence');

  const css = read('src/runtime/ui/styles.ts');
  assert.match(css, /\.betterslack-body--enter \{[\s\S]*?animation: betterslack-tab-enter/, 'the class animates');
  assert.match(css, /:root \{[\s\S]*?--sm-motion-base: 200ms;/, 'with the design system tokens as defaults');

  /*
   * Both the defaults and the reduced-motion override are declared on :root
   * rather than on the elements that read them. A rule on the element wins over
   * anything inherited, so declaring them there would make a mod's dials --
   * set on html.<its-class> -- silently do nothing, and would also overrule
   * someone who installed a motion mod and told it to animate anyway.
   */
  const reduced = css.split('prefers-reduced-motion: reduce')[1].split('}')[0];
  assert.match(reduced, /:root \{ --sm-motion-shift: 0px;/, 'reduced motion drops the travel, on :root');
  assert.equal(css.includes('betterslack-tab-fade'), false, 'and does it by the token, not a second keyframe');
});

/**
 * What is under a view is off the screen, not merely covered.
 *
 * A view is `position: absolute` over `.p-client_workspace__tabpanel`, and
 * covering Slack's conversation leaves it mounted, sized and -- as far as Slack
 * is concerned -- being looked at, so a message arriving in the channel behind
 * it is marked read and the unread somebody was relying on is gone. Measured
 * with the rule in place: the message list drops to zero items while the view
 * is open and comes back with all of them on the way out, and a half-written
 * message in the composer survives the round trip.
 *
 * It is written as `:has()` on the panel rather than a class somebody has to
 * remember to remove, so it stops applying the moment the view unmounts.
 */
test('a view takes what is under it off the screen, rather than covering it', () => {
  // The source, the way every other check here reads it: `styles.ts` is bundled
  // into the runtime rather than emitted as a module of its own.
  const styles = read('src/runtime/ui/styles.ts');
  const rule = styles.match(/\.p-client_workspace__tabpanel:has\(> \.betterslack-view\)[^{]*\{[^}]*\}/);
  assert.ok(rule, 'the panel must hide its other children while a view is mounted in it');
  assert.match(rule[0], /:not\(\.betterslack-view\)/, 'and not hide the view itself');
  assert.match(rule[0], /display:\s*none/, 'display: none, so Slack renders nothing behind it');
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

/**
 * Settings a mod declares, and the two rules that make them worth declaring:
 * the panel draws them, and the mod reads the same keys with the same defaults
 * whether or not anyone has ever opened the panel.
 */
test('a declared setting is validated, and rubbish is refused loudly', async () => {
  const { parseManifest } = await import('../dist/catalog.mjs');
  const base = {
    id: 'example-mod', name: 'X', type: 'plugin', version: '1.0.0', author: 'a',
    description: 'A mod long enough to describe itself properly.',
    entry: 'index.js', betterslackApi: 1,
  };
  const parse = (settings) => parseManifest(JSON.stringify({ ...base, settings }), 'example-mod/mod.json', 'plugin');

  const ok = parse([
    { key: 'limit', type: 'number', label: 'Limit', default: 10 },
    { key: 'mode', type: 'choice', label: 'Mode', options: [{ value: 'a', label: 'A' }] },
  ]);
  assert.equal(ok.settings.length, 2);

  assert.throws(() => parse([{ key: 'a', type: 'slider', label: 'A' }]), /not a settings type/);
  assert.throws(() => parse([{ key: 'a', type: 'choice', label: 'A' }]), /needs options/);
  assert.throws(() => parse([{ key: 'a b', type: 'text', label: 'A' }]), /not a usable settings key/);
  assert.throws(() => parse([
    { key: 'a', type: 'text', label: 'A' },
    { key: 'a', type: 'text', label: 'Again' },
  ]), /twice/);
  assert.throws(() => parse({ nope: true }), /must be an array/);
});

test('the mods that declare settings really read them', () => {
  // A declaration nothing reads is a control that does nothing, which is worse
  // than no control at all.
  for (const [id, keys] of [
    ['member-sidebar', ['memberLimit', 'presenceLimit']],
    ['avatar-downloader', ['quality']],
    ['composer-char-count', ['warnAt', 'alwaysShow']],
  ]) {
    const manifest = JSON.parse(read(`mods/plugins/${id}/mod.json`));
    const source = read(`mods/plugins/${id}/index.js`);
    assert.deepEqual(manifest.settings.map((f) => f.key).sort(), [...keys].sort(),
      `${id} declares exactly what it reads`);
    for (const key of keys) {
      assert.ok(source.includes(`settings.get('${key}'`), `${id} reads ${key}`);
    }
  }
});

test('a menu draws above a dialog, since it is opened from inside one', () => {
  /*
   * The overflow button in a profile dialog opens a menu. With the menu layer
   * below the dialog it drew behind it, and the options were invisible -- a
   * button that appears to do nothing. Asserted as a relationship rather than a
   * pair of numbers so renumbering the stack cannot quietly swap them.
   */
  // Read from the source, like the backtick check above: PANEL_CSS is not built
  // for the test bundle, and what matters is the declaration itself.
  const css = read('src/runtime/ui/styles.ts');
  const layerOf = (selector) => {
    const rule = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^{]*\\{[^}]*z-index:\\s*(\\d+)`);
    const found = rule.exec(css);
    assert.ok(found, `${selector} still declares a z-index`);
    return Number(found[1]);
  };
  assert.ok(
    layerOf('.betterslack-menu_layer') > layerOf('.betterslack-widget_dialog'),
    'the menu layer sits above the dialog it is opened from',
  );
});
