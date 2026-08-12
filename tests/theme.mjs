// Shared checks every theme has to pass.
//
// A theme is CSS, so there is no behaviour to unit test — but there are plenty
// of ways to ship a broken or unreviewable one, and these catch them.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function themeChecks(test, assert, importMetaUrl) {
  const dir = dirname(fileURLToPath(importMetaUrl));
  const manifest = JSON.parse(readFileSync(join(dir, 'mod.json'), 'utf8'));
  const css = readFileSync(join(dir, manifest.entry), 'utf8');

  test('manifest declares a theme', () => {
    assert.equal(manifest.type, 'theme');
    assert.equal(manifest.slackmodApi, 1);
    assert.match(manifest.entry, /\.css$/);
  });

  test('braces are balanced', () => {
    // Comments first, or a `{` inside prose would fail the count.
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const open = (stripped.match(/{/g) ?? []).length;
    const close = (stripped.match(/}/g) ?? []).length;
    assert.equal(open, close, `${open} "{" vs ${close} "}"`);
  });

  test('builds on something stable', () => {
    // Two ways to write a theme that survives a Slack release: redefine its
    // design tokens, or target semantics (roles, states, data-qa). Both are
    // fine. What is not fine is hanging a theme off Slack's class names alone.
    const usesTokens = /--dt_color-/.test(css);
    const usesSlackClasses = /\.[cp]-[a-z]/.test(css);
    assert.ok(
      usesTokens || !usesSlackClasses,
      'a theme that targets Slack class names must also redefine design tokens',
    );
  });

  test('does not target hashed class names', () => {
    // Slack uses two conventions that both contain `__`:
    //   .p-channel_sidebar__channel   hand-written BEM, stable
    //   .circleButton__cMiUK          CSS-module output, regenerated per build
    // The tell is the suffix: module hashes carry uppercase letters, BEM
    // element names are lowercase words.
    const hashed = css.match(/\.[A-Za-z][\w-]*__[A-Za-z0-9]*[A-Z][A-Za-z0-9]*\b/g);
    assert.equal(
      hashed,
      null,
      `hashed class names will break on the next Slack build: ${hashed?.join(', ')}`,
    );
  });

  test('loads nothing from the network', () => {
    // A remote @import or url() is code a reviewer cannot see and a tracking
    // vector; everything a theme needs must be in the file.
    assert.doesNotMatch(css, /@import/i, 'no @import');
    assert.doesNotMatch(css, /url\(\s*['"]?https?:/i, 'no remote url()');
  });

  test('leaves no debugging leftovers', () => {
    assert.doesNotMatch(css, /\bdisplay\s*:\s*none\s*!important\s*;?\s*\}\s*$/, 'trailing kill switch');
  });

  return { manifest, css, dir };
}
