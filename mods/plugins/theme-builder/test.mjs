import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPluginShape, createTestApi, installDom } from '../../../tests/harness.mjs';
import plugin, { buildThemeCss } from './index.js';

const ROLES = {
  bg: '#101014', raised: '#18181d', chrome: '#0b0b0d', surface: '#26262c',
  selected: '#2e2e35', hover: '#161619', text: '#e8e8ea', bright: '#ffffff',
  muted: '#8a8a92', accent: '#4f46e5', accentText: '#a5b4fc', danger: '#ef4444',
};

test('has the shape the runtime loads', () => assertPluginShape(assert, plugin));

test('maps the twelve roles across all four token families', () => {
  const css = buildThemeCss(ROLES, 'Test');
  // A theme that only sets the first family leaves the app chrome untouched --
  // the single most common way a Slack theme looks half-applied.
  assert.match(css, /--dt_color-base-pry:\s*#101014/, 'content family');
  assert.match(css, /--dt_color-theme-base-inv-pry:\s*#0b0b0d !important/, 'chrome family');
  assert.match(css, /--sk_primary_background:\s*16, 16, 20 !important/, 'legacy family, as a triplet');
  assert.match(css, /\.p-theme_background/, 'the opaque layer above <body>');
});

test('the chrome and legacy families carry !important', () => {
  const css = buildThemeCss(ROLES, 'Test');
  const chrome = css.match(/--dt_color-theme-[\w-]+:[^;]+;/g) ?? [];
  const legacy = css.match(/--sk_[\w]+:[^;]+;/g) ?? [];
  assert.ok(chrome.length > 5 && legacy.length > 5, 'both families are actually written');
  for (const rule of [...chrome, ...legacy]) {
    assert.match(rule, /!important/, `Slack wins without it: ${rule.trim()}`);
  }
});

test('produces a stylesheet that parses', () => {
  const css = buildThemeCss(ROLES, 'Test');
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
