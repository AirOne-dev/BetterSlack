import test from 'node:test';
import assert from 'node:assert/strict';
import { themeChecks } from '../../../tests/theme.mjs';

const { css, manifest } = themeChecks(test, assert, import.meta.url);

const MARKER = 'From here on, no colour is written by hand';
const stylesheet = () => css.slice(css.indexOf(MARKER));

/*
 * The three schemes are one stylesheet with three palettes. That holds only
 * while the stylesheet paints with the palette and nothing else: a hex below
 * the marker is a colour Olive Green and Silver can never change, and the
 * place it shows is the scheme nobody was looking at.
 */
test('the stylesheet paints only with the palette', () => {
  assert.ok(css.includes(MARKER), 'the marker between palette and stylesheet is gone');
  const body = stylesheet().replace(/\/\*[\s\S]*?\*\//g, '');
  const inline = [...body.matchAll(/#[0-9a-f]{3,8}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)/gi)].map((m) => m[0]);
  assert.deepEqual(inline, [], 'a colour below the palette belongs in an --xp-* variable');
});

test('every --xp-* variable the stylesheet reads is declared', () => {
  const declared = new Set([...css.matchAll(/(--xp-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const used = new Set([...css.matchAll(/var\((--xp-[a-z0-9-]+)/g)].map((m) => m[1]));
  const missing = [...used].filter((name) => !declared.has(name));
  assert.deepEqual(missing, [], 'read but never declared, so it paints nothing');
});

test('every --xp-* variable the palette declares is read', () => {
  const settings = new Set(manifest.settings.map((field) => field.cssVar));
  const declared = new Set([...css.matchAll(/(--xp-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const unread = [...declared].filter((name) => !settings.has(name) && !css.includes(`var(${name})`)
    && !css.includes(`var(${name},`));
  assert.deepEqual(unread, [], 'declared but never read, so it paints nothing');
});

/*
 * Each setting has to reach the stylesheet, or it is a control that changes
 * nothing. Two are read by style queries rather than by var(), so the test
 * asks for whichever form the setting needs: every option of a choice has to
 * be matched by a query, or be a value the stylesheet reads directly.
 */
test('every setting is declared and acted on', () => {
  for (const field of manifest.settings) {
    assert.ok(css.includes(`${field.cssVar}:`), `${field.cssVar} has a default in the palette`);
    const viaVar = css.includes(`var(${field.cssVar})`);
    const queried = field.options
      .filter((option) => option.value !== field.default)
      .every((option) => css.includes(`style(${field.cssVar}: ${option.value})`));
    assert.ok(viaVar || queried, `${field.cssVar} changes nothing`);
  }
});

test('the default scheme is Luna Blue, with XP\'s own system colours', () => {
  for (const colour of ['#ece9d8', '#316ac5', '#ffffe1', '#0054e3', '#7f9db9', '#003c74']) {
    assert.ok(css.toLowerCase().includes(colour), `${colour} is missing from the palette`);
  }
});

test('ships nothing of Microsoft\'s', () => {
  // Raster images and fonts are where a copied asset would hide; every glyph
  // here is a few lines of SVG written for this theme.
  assert.doesNotMatch(css, /data:(image\/(png|jpe?g|gif|bmp|webp)|font\/|application\/font)/i);
  assert.doesNotMatch(css, /@font-face/i);
});

test('does not reach into a plugin\'s markup', () => {
  // Plugins are themed through the tokens and Slack's classes they borrow;
  // naming their ids would tie a stylesheet to a plugin's internals.
  for (const id of ['betterslack-member-column', 'betterslack-account-strip', 'bsh-', 'bshl-', 'betterslack-members__']) {
    assert.ok(!css.includes(id), `${id} is a plugin's markup`);
  }
});

test('the Dock icon and the boot screen in the stylesheet are the SVG files beside it', async () => {
  // The files are what gets edited and the stylesheet is what ships, since a
  // mod update carries .css and leaves an .svg behind. Drift means somebody
  // edited one and forgot scripts/embed-theme-art.mjs.
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { embed } = await import('../../../scripts/embed-theme-art.mjs');
  const dir = fileURLToPath(new URL('.', import.meta.url));
  const shipped = await readFile(new URL('./theme.css', import.meta.url), 'utf8');
  assert.equal(await embed(dir, shipped), shipped, 'run: node scripts/embed-theme-art.mjs windows-xp');
  for (const property of ['--betterslack-app-icon', '--betterslack-splash-art']) {
    assert.match(shipped, new RegExp(`${property}: url\\("data:image/svg\\+xml,`), `${property} is declared`);
  }
});
