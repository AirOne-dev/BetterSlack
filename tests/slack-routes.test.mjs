// A route is not a channel.
//
// `currentChannelId()` read the third segment of the address with a
// case-insensitive `[A-Z0-9]+`, which matches Slack's own views as happily as
// it matches a channel: `/client/T.../later` answered `LATER`, `/dms` answered
// `DMS`, `/activity-inbox` answered `ACTIVITY`. Measured against a live client,
// the member column asked Slack for the members of each of them and logged
// `channel_not_found` every time -- once per view change, for every mod that
// asks the runtime where it is.
//
// Slack's views are lowercase words and a conversation id is an uppercase C, D
// or G, so the pattern is case-sensitive and that is the whole fix. It is
// written twice -- once in the runtime, once in the harness that stands in for
// it -- so the first test here is that the two say the same thing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');

/**
 * The one pattern, wherever it is written. Compared as text rather than
 * re-derived: what makes it right is the exact shape -- the character classes
 * and the missing `i` flag -- so a copy that has drifted is what this is for.
 */
const PATTERN = String.raw`/\/client\/[^/]+\/([CDG][A-Z0-9]{2,})(?:\/|$)/`;

test('the runtime and the harness agree on what a conversation route looks like', () => {
  for (const file of ['src/runtime/slack-api.ts', 'tests/harness.mjs']) {
    assert.ok(
      read(file).includes(PATTERN),
      `${file} must match a conversation id and nothing else, case-sensitively, `
        + `or Slack's own lowercase routes come back as channels. Expected ${PATTERN}`,
    );
  }
});

test('Slack\'s own views are not channels', () => {
  const match = (pathname) =>
    pathname.match(/\/client\/[^/]+\/([CDG][A-Z0-9]{2,})(?:\/|$)/)?.[1] ?? null;

  // Every one of these was read off a live client while walking the tab rail.
  for (const route of ['later', 'dms', 'activity-inbox', 'unified-files', 'platform', 'threads', 'drafts']) {
    assert.equal(match(`/client/T025V5WN2/${route}`), null, `${route} is a view, not a channel`);
  }
  assert.equal(match('/client/T025V5WN2'), null, 'and the workspace on its own is the directory view');

  assert.equal(match('/client/T025V5WN2/C025UJ707'), 'C025UJ707', 'a channel still reads');
  assert.equal(match('/client/T025V5WN2/D01ABCDEF'), 'D01ABCDEF', 'so does a DM');
  assert.equal(match('/client/T025V5WN2/G01ABCDEF'), 'G01ABCDEF', 'so does a private group');
  assert.equal(
    match('/client/T025V5WN2/C025UJ707/thread/C025UJ707-1700000000.1'),
    'C025UJ707',
    'and an open thread is still the conversation it hangs off',
  );
});
