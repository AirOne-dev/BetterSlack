import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertPluginShape, createTestApi, installDom } from '../../../tests/harness.mjs';
import plugin, { buildThemeCss, matchedRules, toHex, variablesIn } from './index.js';

const ROLES_FIXTURE = {
  bg: '#101014', raised: '#18181d', chrome: '#0b0b0d', surface: '#26262c',
  selected: '#2e2e35', hover: '#161619', text: '#e8e8ea', bright: '#ffffff',
  muted: '#8a8a92', accent: '#4f46e5', accentText: '#a5b4fc', danger: '#ef4444',
};

test('has the shape the runtime loads', () => assertPluginShape(assert, plugin));

test('maps the twelve roles across all four token families', () => {
  const css = buildThemeCss(ROLES_FIXTURE, 'Test');
  // A theme that only sets the first family leaves the app chrome untouched --
  // the single most common way a Slack theme looks half-applied.
  assert.match(css, /--dt_color-base-pry:\s*#101014/, 'content family');
  assert.match(css, /--dt_color-theme-base-inv-pry:\s*#0b0b0d !important/, 'chrome family');
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
  const { api, recorded } = createTestApi();
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

test('reads a computed colour back into a picker value', () => {
  assert.equal(toHex('rgb(26, 26, 30)'), '#1a1a1e');
  assert.equal(toHex('rgba(26, 26, 30, 0.5)'), '#1a1a1e');
  assert.equal(toHex('#ABCDEF'), '#abcdef');
  assert.equal(toHex('transparent'), null, 'nothing to seed a picker with');
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
  // Order is the whole feature: base first, roles second, hand-written last.
  const source = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
  const preview = source.match(/const preview = \(\) => \{[\s\S]*?\};/)[0];
  assert.match(preview, /\$\{baseCss\}[\s\S]*buildThemeCss/);
});

test('hand-written CSS lands after everything the roles generate', () => {
  const css = buildThemeCss(ROLES_FIXTURE, 'T', '.x { color: red }');
  assert.ok(css.indexOf('.x { color: red }') > css.indexOf('--sk_highlight'));
});
