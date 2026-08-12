import test from 'node:test';
import assert from 'node:assert/strict';
import { themeChecks } from '../../../tests/theme.mjs';

const { css } = themeChecks(test, assert, import.meta.url);

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
