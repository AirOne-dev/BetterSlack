import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { themeChecks } from '../../../tests/theme.mjs';

const { css } = themeChecks(test, assert, import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(here, 'mod.json'), 'utf8'));

test('maps all three Slack token families', () => {
  assert.match(css, /--dt_color-base-pry/, 'content family');
  assert.match(css, /--dt_color-theme-surf-inv-sec/, 'chrome family');
  assert.match(css, /--sk_primary_background/, 'legacy family');
});

test('uses Discord type stack', () => {
  assert.match(css, /"gg sans"/);
  assert.match(css, /Noto Sans/);
});

test('repaints Slack full-viewport backdrop layer', () => {
  assert.match(css, /\.p-theme_background/);
});

test('gives the rail Discord behaviour without labels', () => {
  assert.match(css, /\.p-tab_rail__button__label\s*\{[^}]*display:\s*none/);
  assert.match(css, /\.p-tab_rail__button--active::before/, 'the active pill');
});

test('requires the plugins that carry the parts CSS cannot do', () => {
  assert.deepEqual(manifest.requires, ['member-sidebar', 'sidebar-account']);
  assert.equal(manifest.script, undefined, 'a theme is CSS; behaviour belongs in a plugin');
  assert.equal(manifest.permissions, undefined);
});

test('styles only Slack, leaving the required plugins to style themselves', () => {
  // The plugins read Slack's tokens, so they follow whatever theme is on. A
  // theme reaching into their markup would tie the two together and break the
  // plugins for everyone else.
  assert.doesNotMatch(css, /slackmod-member-column|slackmod-account-strip/);
});
