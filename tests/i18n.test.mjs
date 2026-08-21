// Translations.
//
// The rules a mod author can rely on, and the ones that keep a half-translated
// mod from rendering blank.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { createI18n, detectLocale } from '../dist/i18n.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TABLES = {
  en: { hello: 'Hello', count: '{n} members', only: 'English only' },
  fr: { hello: 'Bonjour', count: '{n} membres' },
  'fr-CA': { hello: 'Salut' },
};

test('falls back language by language, then to English', () => {
  assert.equal(createI18n('fr-FR').strings(TABLES)('hello'), 'Bonjour');
  assert.equal(createI18n('fr-CA').strings(TABLES)('hello'), 'Salut', 'the exact tag wins');
  assert.equal(createI18n('de-DE').strings(TABLES)('hello'), 'Hello', 'unknown language');
  assert.equal(createI18n('fr-FR').strings(TABLES)('only'), 'English only', 'untranslated key');
});

test('interpolates, and leaves unknown placeholders alone', () => {
  const t = createI18n('fr').strings(TABLES);
  assert.equal(t('count', { n: 3 }), '3 membres');
  assert.equal(t('count'), '{n} membres', 'no vars is not a crash');
});

test('a key missing everywhere shows the key, never an empty gap', () => {
  // A blank label reads as a rendering bug and gets reported as one; the key
  // says which string is missing and from where.
  assert.equal(createI18n('fr').strings(TABLES)('nope'), 'nope');
});

test('the language comes from Slack’s <html lang>, not from localStorage', () => {
  const dom = new JSDOM('<!doctype html><html lang="fr-FR"><body></body></html>');
  // Defined, not assigned: Node 22's own `navigator` is a getter with no
  // setter, and assigning to it throws. Same reason as in the harness.
  const previous = ['document', 'navigator'].map((key) =>
    [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  for (const key of ['document', 'navigator']) {
    Object.defineProperty(globalThis, key, {
      value: dom.window[key],
      configurable: true,
      writable: true,
    });
  }
  try {
    assert.equal(detectLocale(), 'fr-FR');
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor === undefined) delete globalThis[key];
      else Object.defineProperty(globalThis, key, descriptor);
    }
    dom.window.close();
  }

  // localConfig_v2 also holds a locale, but it is the file with the session
  // token in it, and only web-api.ts may read that.
  const source = readFileSync(path.join(root, 'src/runtime/i18n.ts'), 'utf8');
  assert.doesNotMatch(source, /localStorage/);
});

test('every plugin that speaks to the user speaks both languages', async () => {
  const { listMods } = await import('../scripts/test-mods.mjs');
  const { readModFiles } = await import('./harness.mjs');

  for (const mod of listMods()) {
    if (mod.kind !== 'plugins') continue;

    // A mod is a folder, and a split mod usually keeps its dictionaries in a
    // file of their own. Look through all of them, not only the entry.
    const files = Object.entries(readModFiles(mod.dir)).filter(([name]) => name.endsWith('.js'));
    const table = files.find(([, text]) => /(?:export )?const STRINGS = \{/.test(text));

    if (!table) {
      // Fine, as long as it genuinely shows no text of its own.
      for (const [name, text] of files) {
        assert.doesNotMatch(
          text,
          /(?:label|title|subtitle|placeholder|description):\s*'[A-Z]/,
          `${mod.id} (${name}) shows text but ships no translations`,
        );
      }
      continue;
    }

    const [name, source] = table;
    assert.match(source, /en:\s*\{/, `${mod.id}: ${name} must have an English table`);
    assert.match(source, /fr:\s*\{/, `${mod.id}: ${name} must have a French table`);

    // The two tables must cover the same keys, or French users get English
    // holes that nobody notices until someone screenshots them.
    const keys = (lang) => {
      const start = source.indexOf(`\n  ${lang}: {`);
      assert.ok(start !== -1, `${mod.id}: no ${lang} table`);
      const end = source.indexOf('\n  },', start);
      return new Set([...source.slice(start, end).matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]));
    };
    assert.deepEqual([...keys('fr')].sort(), [...keys('en')].sort(),
      `${mod.id}: en and fr must cover the same keys`);
  }
});

/**
 * The panel is held to the rule it holds mods to.
 *
 * Every mod here must ship English and French, and a test fails one whose
 * tables disagree — while the window around them was English only. A French
 * user had French mods inside an English panel, which is the kind of seam that
 * makes a product feel assembled rather than built.
 */
test('the panel speaks both languages, and asks for nothing it does not have', async () => {
  const { PANEL_STRINGS } = await import('../dist/ui/strings.mjs');

  const en = Object.keys(PANEL_STRINGS.en).sort();
  const fr = Object.keys(PANEL_STRINGS.fr).sort();
  assert.deepEqual(fr, en, 'en and fr must cover the same keys');

  /*
   * Everything the panel asks for must exist, or it renders as its own key.
   *
   * Every file that draws with this dictionary, not only panel.ts: the start
   * screen has its own translator over the same table, and a key it asked for
   * and nobody had defined would be a screen-wide logo with a raw key under it.
   */
  const source = ['src/runtime/ui/panel.ts', 'src/runtime/ui/splash.ts']
    .map((rel) => readFileSync(path.join(root, rel), 'utf8'))
    .join('\n');
  const asked = new Set([...source.matchAll(/\bt\('([a-zA-Z0-9_]+)'/g)].map((m) => m[1]));
  const missing = [...asked].filter((key) => !(key in PANEL_STRINGS.en));
  assert.deepEqual(missing, [], 'these are asked for and never defined');

  // And nothing user-facing left behind: a bare English sentence in the source
  // is a string that will never be translated.
  const leftovers = [...source.matchAll(/(?:^|[[(,]\s*)'([A-Z][a-z]+ [a-z][^']{12,})'/gm)]
    .map((m) => m[1])
    .filter((text) => !/^[A-Z][a-z]+ [a-z]+\.(js|css|json)/.test(text));
  assert.deepEqual(leftovers, [], 'move these into PANEL_STRINGS');
});
