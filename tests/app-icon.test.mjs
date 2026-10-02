// Which icon Slack and BetterSlack.app wear, out of the themes switched on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bundleOf, chooseIcon, DEFAULT_APP_ICON, iconFromCss } from '../dist/app-icon.mjs';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#0054e3"/></svg>';
const declared = (text) => `:root {\n  --betterslack-app-icon: url("data:image/svg+xml,${encodeURIComponent(text)}");\n}`;

test('a theme declares its icon in its stylesheet, percent-encoded or base64', () => {
  assert.equal(iconFromCss(declared(svg)), svg);
  const b64 = `:root { --betterslack-app-icon: url('data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}'); }`;
  assert.equal(iconFromCss(b64), svg);
});

test('a commented-out declaration, or one that is not an SVG, is not an icon', () => {
  assert.equal(iconFromCss(`/* ${declared(svg)} */`), null);
  assert.equal(iconFromCss(':root { --betterslack-app-icon: url("data:image/svg+xml,hello"); }'), null);
  assert.equal(iconFromCss(':root { color: red; }'), null);
});

test('the last theme that brings one wins, as its stylesheet does in the client', () => {
  const other = svg.replace('#0054e3', '#e01858');
  assert.equal(chooseIcon([{ css: declared(svg) }, { css: ':root{}' }, { css: declared(other) }]), other);
  assert.equal(chooseIcon([{ css: ':root{}' }]), DEFAULT_APP_ICON);
  assert.equal(chooseIcon([]), DEFAULT_APP_ICON);
});

test('the default is the mark on a plain white plate, in the macOS icon grid', () => {
  assert.match(DEFAULT_APP_ICON, /<rect x="100" y="100" width="824" height="824" rx="185" fill="#FFFFFF"/);
  // The mark itself, untouched: its four arms in their four colours.
  for (const colour of ['#E01858', '#30C0F0', '#28B078', '#E8B028']) assert.ok(DEFAULT_APP_ICON.includes(colour));
  assert.ok(!/linearGradient|radialGradient/.test(DEFAULT_APP_ICON), 'plain white, no gradient');
});

test('the bundle around an executable', () => {
  assert.equal(bundleOf('/Applications/Slack.app/Contents/MacOS/Slack'), '/Applications/Slack.app');
  assert.equal(bundleOf('/usr/bin/slack'), null);
});

test('Windows XP brings an icon of its own, and it is an SVG', () => {
  const css = readFileSync(new URL('../mods/themes/windows-xp/theme.css', import.meta.url), 'utf8');
  const icon = iconFromCss(css);
  assert.ok(icon, 'declared in theme.css');
  assert.match(icon, /<svg[\s>]/);
});
