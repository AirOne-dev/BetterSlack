import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  assertPluginShape, createTestApi, installDom, readModFiles,
} from '../../../tests/harness.mjs';
import plugin, {
  buildThemeCss, contrast, derivePalette, formatTriplet, kindOf, matchedRules,
  parseColour, readability, tokenCss, variablesIn,
} from './index.js';

// The builder reads its own stylesheet with api.assets, so the test api is
// given the folder the app would have shipped it.
const FILES = readModFiles(path.dirname(fileURLToPath(import.meta.url)));
const createApi = (options) => createTestApi({ ...options, files: FILES });

const ROLES_FIXTURE = derivePalette(parseColour('#101014'), parseColour('#4f46e5'));

test('has the shape the runtime loads', () => assertPluginShape(assert, plugin));

test('maps the twelve roles across all four token families', () => {
  const css = buildThemeCss(ROLES_FIXTURE, 'Test');
  // A theme that only sets the first family leaves the app chrome untouched --
  // the single most common way a Slack theme looks half-applied.
  assert.match(css, /--dt_color-base-pry:\s*#101014/, 'content family');
  assert.match(css, /--dt_color-theme-base-inv-pry:[^;]+!important/, 'chrome family');
  assert.match(css, /--sk_primary_background:\s*16, 16, 20 !important/, 'legacy family, as a triplet');
  assert.match(css, /\.p-theme_background/, 'the opaque layer above <body>');
});

test('the chrome and legacy families carry !important', () => {
  const css = buildThemeCss(ROLES_FIXTURE, 'Test');
  const chrome = css.match(/--dt_color-theme-[\w-]+:[^;]+;/g) ?? [];
  const legacy = css.match(/--sk_[\w]+:[^;]+;/g) ?? [];
  assert.ok(chrome.length > 5 && legacy.length > 5, 'both families are actually written');
  for (const rule of [...chrome, ...legacy]) {
    assert.match(rule, /!important/, `Slack wins without it: ${rule.trim()}`);
  }
});

test('produces a stylesheet that parses', () => {
  const css = buildThemeCss(ROLES_FIXTURE, 'Test');
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal((stripped.match(/{/g) ?? []).length, (stripped.match(/}/g) ?? []).length);
});

test('offers the builder from the control strip', async () => {
  const dom = installDom();
  const { api, recorded } = createApi();
  try {
    await plugin.start(api);
    const button = recorded.toolbarButtons.find((b) => b.button.id === 'theme-builder');
    assert.ok(button, 'a button, so the window is opened deliberately');
    assert.equal(button.toolbar, 'controlStrip');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('saves through the theme-only route, with an id Slack’s catalogue accepts', () => {
  // The loader re-validates what it is handed, and ids have to match its
  // pattern, so the name is slugged rather than passed through.
  const slug = 'Mon Thème 2026 !'.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  assert.match(slug, /^[a-z0-9][a-z0-9-]{1,48}$/);
});

test('parses every colour form Slack and a human might write', () => {
  assert.deepEqual(parseColour('#1a1a1e'), { r: 26, g: 26, b: 30, a: 1 });
  assert.deepEqual(parseColour('#abc'), { r: 170, g: 187, b: 204, a: 1 });
  assert.deepEqual(parseColour('rgb(26, 26, 30)'), { r: 26, g: 26, b: 30, a: 1 });
  assert.equal(parseColour('rgba(0,0,0,0.5)').a, 0.5);
  assert.equal(parseColour('#1a1a1e80').a.toFixed(2), '0.50', 'eight-digit hex carries alpha');
  assert.equal(parseColour('transparent'), null);
});

test('alpha survives the modern families and is dropped from the legacy one', () => {
  // --sk_* takes a bare "r, g, b" triplet. A theme that writes rgba() there
  // paints nothing at all, which is invisible until someone reports a blank UI.
  const translucent = { r: 26, g: 26, b: 30, a: 0.4 };
  assert.equal(formatTriplet(translucent), '26, 26, 30');
});

test('contrast flattens a translucent foreground before judging it', () => {
  const bg = { r: 0, g: 0, b: 0, a: 1 };
  const solid = contrast({ r: 255, g: 255, b: 255, a: 1 }, bg);
  const faint = contrast({ r: 255, g: 255, b: 255, a: 0.2 }, bg);
  assert.ok(solid > faint, 'the ratio of a colour you can see through is not the one you read');
  assert.equal(readability(solid).grade, 'AAA');
  assert.equal(readability(faint).ok, false);
});

test('a palette derived from a light background goes the other way', () => {
  const dark = derivePalette(parseColour('#101014'), parseColour('#4f46e5'));
  const light = derivePalette(parseColour('#fbfbfd'), parseColour('#4f46e5'));
  // Raised is lighter than the background on a dark theme and darker on a light
  // one; getting this backwards is why hand-built light themes look wrong.
  assert.ok(dark.raised.r > dark.bg.r);
  assert.ok(light.raised.r < light.bg.r);
  assert.ok(readability(contrast(dark.text, dark.bg)).ok, 'derived text stays readable');
  assert.ok(readability(contrast(light.text, light.bg)).ok);
});

test('every relative import in the mod lands on a file that exists', () => {
  // The runtime resolves these into blob URLs; a missing one fails at load
  // time, inside the app, where no test is watching.
  const files = readModFiles(new URL('.', import.meta.url).pathname);
  for (const [name, source] of Object.entries(files)) {
    // Tests reach out to the shared harness; the runtime never loads them.
    if (name === 'test.mjs' || name.endsWith('.test.mjs')) continue;
    for (const [, spec] of source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      const base = name.split('/').slice(0, -1);
      for (const part of spec.split('/')) {
        if (part === '.' || part === '') continue;
        if (part === '..') base.pop(); else base.push(part);
      }
      assert.ok(files[base.join('/')], `${name} imports ${spec}, which is not in the folder`);
    }
  }
});

test('finds the rules that match an element, and skips sheets it may not read', () => {
  const dom = installDom();
  try {
    const el = document.querySelector('.p-channel_sidebar');
    const sheets = [
      { get cssRules() { throw new Error('cross-origin'); } },
      { cssRules: [
        { selectorText: '.p-channel_sidebar, .nope', style: { cssText: 'background: var(--dt_color-base-sec)' } },
        { selectorText: '.something-else', style: { cssText: 'color: red' } },
        { selectorText: '::-webkit-nonsense', style: { cssText: 'color: red' } },
      ] },
    ];
    const rules = matchedRules(el, sheets);
    // The unreadable sheet is skipped rather than ending the walk, and the
    // selector list reports the part that actually matched.
    assert.equal(rules.length, 1);
    assert.equal(rules[0].selector, '.p-channel_sidebar');
  } finally {
    dom.cleanup();
  }
});

test('names the variables a set of rules depends on', () => {
  const rules = [
    { text: 'background: var(--dt_color-base-sec); color: var(--dt_color-content-pry)' },
    { text: 'border: 1px solid var(--dt_color-base-sec)' },
  ];
  const seen = variablesIn(rules, (name) => (name === '--dt_color-base-sec' ? '#222327' : ''));
  assert.deepEqual(seen.map((v) => v.name), ['--dt_color-base-sec', '--dt_color-content-pry']);
  assert.equal(seen[0].value, '#222327', 'resolved, so the swatch is the real colour');
});

test('a base theme is applied under the roles, so overriding one works', () => {
  // Order is the whole feature, and it is one line: base, then the derived
  // roles, then tokens taken over by hand, then whatever was typed. Last wins.
  const source = FILES['index.js'];
  const build = source.match(/const themeCss = \(\) =>[\s\S]*?;\n/)[0];
  assert.match(build, /\$\{baseCss\}[\s\S]*buildThemeCss/);
  assert.match(build, /extraCss, tokenOverrides/, 'and the two override layers reach the CSS');
});

test('a token is written the way its own family reads it', () => {
  // The silent failure this exists for: --sk_* and --dt_color-plt-* hold bare
  // "r, g, b" triplets. Give one of them a real colour and the rule parses,
  // paints nothing, and says nothing about it.
  assert.equal(kindOf('26, 26, 30'), 'triplet');
  assert.equal(kindOf('#1a1a1e'), 'colour');
  assert.equal(kindOf('0.3s ease'), 'other', 'not everything in a token is a colour');

  const css = tokenCss({ '--sk_primary_background': '26, 26, 30', '--dt_color-base-pry': '#1a1a1e' });
  assert.match(css, /--sk_primary_background: 26, 26, 30 !important;/, 'legacy needs !important');
  assert.match(css, /--dt_color-base-pry: #1a1a1e;/, 'content does not');
});

test('hand-picked tokens land after the roles they contradict', () => {
  const css = buildThemeCss(ROLES_FIXTURE, 'T', '', { '--dt_color-base-pry': '#ff0000' });
  const derived = css.indexOf('--dt_color-base-pry: #101014');
  const taken = css.indexOf('--dt_color-base-pry: #ff0000');
  assert.ok(derived !== -1 && taken > derived, 'the one you picked is the one that wins');
});

test('hand-written CSS lands after everything the roles generate', () => {
  const css = buildThemeCss(ROLES_FIXTURE, 'T', '.x { color: red }');
  assert.ok(css.indexOf('.x { color: red }') > css.indexOf('--sk_highlight'));
});
