// Who owns a plugin's stylesheet.
//
// A plugin writes CSS two ways: `api.css`, which replaces its stylesheet
// whole, and helpers -- `toggle({ whenOn })`, `badge`, `tooltip` -- which write
// CSS of their own. Those two used to share one <style> node, so a mod that
// used both kept only whichever wrote last.
//
// It was not theoretical. Focus Mode called `toggle({ whenOn })` to hide the
// sidebar and then `api.css` to style its indicator, and shipped folding
// nothing away at all. Its own tests passed: they asserted on every call the
// mod made, and the bug is that only one of those calls survives.

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

test('a mod using both keeps both, which Focus Mode is the reason for', async () => {
  await withDom(async () => {
    const { default: focus } = await import('../mods/plugins/focus-mode/index.js');
    const sheets = { plugin: '', helpers: '' };
    const store = {};
    const settings = {
      get: (key, fallback) => (key in store ? store[key] : fallback),
      set: async (key, value) => { store[key] = value; },
    };

    // Only what the mod touches, and both sinks kept apart exactly as the
    // runtime now keeps them.
    const api = {
      id: 'focus-mode',
      css: (text) => { sheets.plugin = text; },
      settings: { ...settings, all: () => ({ ...store }), onChange: () => () => {} },
      i18n: { strings: (tables) => (key) => tables.en[key] ?? key },
      dom: { h: (tag, attrs = {}, kids = []) => {
        const el = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k === 'class' ? 'class' : k, v);
        for (const kid of kids) el.append(typeof kid === 'string' ? document.createTextNode(kid) : kid);
        return el;
      } },
      commands: { add: () => () => {} },
      onDispose: () => {},
      log: { info() {}, warn() {}, error() {} },
    };
    api.helpers = createHelpers({
      pluginId: 'focus-mode',
      css: (text) => { sheets.helpers = text; },
      toast: () => {},
      settings,
      track: (fn) => fn,
    });

    await focus.start(api);

    assert.ok(sheets.helpers.includes('p-channel_sidebar'), 'it really does hide the sidebar');
    assert.ok(sheets.plugin.includes('betterslack-focus-indicator'), 'and really does draw its indicator');
  });
});

/*
 * Slack's own preferences file.
 *
 * This is the only thing BetterSlack writes outside its own home, so it is
 * held to a narrow contract: two keys, nothing else touched, and an untouched
 * file when it already agrees. The edit is a pure function precisely so it can
 * be checked without a Slack installation.
 */
test('the window flag changes two keys and nothing else', async () => {
  const { withPrefs } = await import('../dist/slack-settings.mjs');

  const original = {
    settings: {
      windowVibrancy: false,
      slackDefaults: { windowVibrancy: false, userTheme: 'dark' },
      locale: 'fr-FR',
      mainWindowSettings: { bounds: { x: 1, y: 2 } },
    },
    teams: { T1: { name: 'Acme' } },
  };

  const { changed, state } = withPrefs(structuredClone(original), { windowVibrancy: true });
  assert.equal(changed, true);
  assert.equal(state.settings.windowVibrancy, true);
  assert.equal(state.settings.slackDefaults.windowVibrancy, true, 'and the defaults snapshot with it');
  assert.equal(state.settings.slackDefaults.userTheme, 'dark', 'neighbours untouched');
  assert.equal(state.settings.locale, 'fr-FR');
  assert.deepEqual(state.teams, original.teams, 'and the workspaces are not ours to rewrite');

  assert.equal(withPrefs(structuredClone(state), { windowVibrancy: true }).changed, false, 'already true is no write');
});

test('a settings file it does not recognise is left alone', async () => {
  const { withPrefs } = await import('../dist/slack-settings.mjs');
  // Slack could rename or restructure this at any update. Refusing to guess is
  // the difference between a mod that stops working and a Slack that will not
  // start.
  for (const junk of [null, 'not json', 42, {}, { settings: null }, { settings: 'nope' }]) {
    const { changed } = withPrefs(junk, { windowVibrancy: true });
    assert.equal(changed, false, `left ${JSON.stringify(junk)} alone`);
  }
});

test('refuses a key that is not on the list, and a value of the wrong type', async () => {
  const { withPrefs, checkPref } = await import('../dist/slack-settings.mjs');

  // The file holds the workspaces you are signed in to. A mod reaching a key
  // nobody vetted is the failure this list exists to make impossible.
  assert.match(checkPref('teams', {}), /not a Slack preference/);
  assert.match(checkPref('windowVibrancy', 'yes'), /is a boolean/);
  assert.equal(checkPref('windowVibrancy', true), null);

  const state = { settings: { windowVibrancy: false, teams: 'mine' } };
  const { changed, state: after } = withPrefs(state, { teams: 'theirs', windowVibrancy: true });
  assert.equal(changed, true, 'the allowed key went in');
  assert.equal(after.settings.teams, 'mine', 'and the refused one did not');
});
