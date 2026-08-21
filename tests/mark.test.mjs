// One mark, drawn in more than one place.
//
// `assets/mark.svg` is the original. The site keeps a copy because it is
// published on its own and cannot reach `assets/`, `assets/icon.icns` is built
// from it by `pnpm icon`, and the client draws it inline -- in Slack's rail and
// at the head of the panel -- because a mod's window and Slack's chrome have no
// asset pipeline between them.
//
// So there are several copies by necessity, and the failure they invite is a
// redrawn mark that ships in one place and not the others. This is the check
// that would have caught it: the shapes must be the same everywhere, whatever
// the file around them says.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MARK_SVG } from '../dist/ui/mark.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

/**
 * The drawing itself: every shape, in order, with its fill.
 *
 * Compared rather than the whole file, because the copies legitimately differ
 * around it -- the original carries a comment explaining itself, and the site's
 * does not.
 */
const shapes = (svg) =>
  [...svg.matchAll(/<(rect|path)\b[^>]*>/g)]
    .map((match) => match[0].replace(/\s+/g, ' ').trim());

test('the client draws the mark that is in assets/', () => {
  const original = shapes(read('assets/mark.svg'));
  assert.ok(original.length >= 8, 'four arms and four elbows, at least');
  assert.deepEqual(shapes(MARK_SVG), original, 'redrawing the mark means updating ui/mark.ts too');
});

test('the site draws it as well', () => {
  assert.deepEqual(shapes(read('site/mark.svg')), shapes(read('assets/mark.svg')));
});

test('nothing else keeps a copy of its own', () => {
  // The rail and the panel header both read ui/mark.ts. A third inline copy is
  // how one of them ends up wearing last year's mark.
  for (const rel of ['src/runtime/ui/launcher.ts', 'src/runtime/ui/panel.ts']) {
    assert.doesNotMatch(read(rel), /viewBox="0 0 848 848"/, `${rel} must import MARK_SVG`);
  }
});
