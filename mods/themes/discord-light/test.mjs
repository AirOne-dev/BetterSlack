import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { themeChecks } from '../../../tests/theme.mjs';

const { css } = themeChecks(test, assert, import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));
const dark = readFileSync(path.join(here, '../discord-dark/theme.css'), 'utf8');

/*
 * Where the palette stops and the design starts.
 *
 * Both files are a header comment, two `:root` blocks of colour, and then the
 * stylesheet. This line is the first rule after the palette in both, so
 * everything from it onward is the part the two themes share.
 */
const BODY = 'html, body { background-color: var(--dc-chat); }';

const bodyOf = (text) => {
  const at = text.indexOf(BODY);
  assert.notEqual(at, -1, 'the file still starts its stylesheet where the test expects');
  return text.slice(at);
};

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

/*
 * The point of this theme.
 *
 * It is Discord Dark with a different palette, and it stays that way only if
 * something checks. Two stylesheets meaning to be one design drift the moment
 * a fix lands in whichever file the person had open -- and the one that misses
 * out is always the one nobody is looking at.
 *
 * So: identical from the first rule onward, byte for byte. A change that
 * belongs to both goes in both; a change that belongs to one goes in the
 * palette, as a variable, which is what `--dc-header-shadow`, `--dc-float`,
 * `--dc-float-text` and the two scrollbar colours are for.
 */
test('is Discord Dark with a different palette, and nothing else', () => {
  assert.equal(
    bodyOf(css),
    bodyOf(dark),
    'discord-light and discord-dark have drifted below the palette — put the '
    + 'difference in a --dc-* variable rather than in one of the two files',
  );
});

test('every colour it paints with is declared, not written inline', () => {
  /*
   * A hex or an rgb() below the palette is a value one theme can honour and the
   * other cannot, which is exactly how the two files come apart. White is the
   * exception and is genuinely right in both: it is the text on the blurple
   * accent and on the red badge, which are the same two colours in either
   * theme.
   */
  const body = bodyOf(css);
  const inline = [...body.matchAll(/#(?!ffffff\b)[0-9a-f]{3,8}\b|\brgba?\([^)]*\)/gi)]
    .map((m) => m[0]);
  assert.deepEqual(inline, [], 'colours below the palette belong in a --dc-* variable');
});
