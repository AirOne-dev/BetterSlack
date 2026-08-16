// Version checking, and the rules about when it may say anything at all.
//
// The whole feature hangs on one judgement: a badge that appears when it should
// not is worse than no badge. Being offline, on a fork, on a branch that tracks
// nothing, or in the middle of local work are all ordinary, and none of them
// means "out of date" -- so `behind` is only ever true when the check is sure,
// and `updatable` only when pulling could not lose anything.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyUpdate, checkForUpdate, isNewer } from '../dist/update.mjs';

const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/** A real repository with a real remote: the thing being tested is git itself. */
function scratch() {
  const root = mkdtempSync(path.join(tmpdir(), 'betterslack-update-'));
  const origin = path.join(root, 'origin');
  const clone = path.join(root, 'clone');

  execFileSync('git', ['init', '--bare', '-b', 'main', origin], { stdio: 'ignore' });
  execFileSync('git', ['clone', origin, clone], { stdio: 'ignore' });
  git(clone, 'config', 'user.email', 'test@example.com');
  git(clone, 'config', 'user.name', 'Test');
  writeFileSync(path.join(clone, 'package.json'), JSON.stringify({ version: '1.0.0' }));
  git(clone, 'add', '.');
  git(clone, 'commit', '-m', 'first');
  git(clone, 'push', '-u', 'origin', 'main');

  return { root, origin, clone, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const check = (root) => checkForUpdate({ root, version: '1.0.0', repo: 'x/y', branch: 'main' });

test('a checkout level with its remote is not behind', async () => {
  const { clone, cleanup } = scratch();
  try {
    const status = await check(clone);
    assert.equal(status.kind, 'git');
    assert.equal(status.behind, false);
    assert.equal(status.commits, 0);
  } finally {
    cleanup();
  }
});

test('a checkout behind its remote says how far, and what is in it', async () => {
  const { origin, clone, root, cleanup } = scratch();
  try {
    // Someone else pushes two commits.
    const other = path.join(root, 'other');
    execFileSync('git', ['clone', origin, other], { stdio: 'ignore' });
    git(other, 'config', 'user.email', 'test@example.com');
    git(other, 'config', 'user.name', 'Test');
    for (const message of ['second', 'a third thing']) {
      writeFileSync(path.join(other, `${message}.txt`), message);
      git(other, 'add', '.');
      git(other, 'commit', '-m', message);
    }
    git(other, 'push');

    const status = await check(clone);
    assert.equal(status.behind, true);
    assert.equal(status.commits, 2);
    assert.equal(status.headline, 'a third thing', 'the offer says what it contains');
    assert.equal(status.updatable, true, 'and a clean checkout can fast-forward');
  } finally {
    cleanup();
  }
});

test('local work in progress is never resolved by an update button', async () => {
  const { origin, clone, root, cleanup } = scratch();
  try {
    const other = path.join(root, 'other');
    execFileSync('git', ['clone', origin, other], { stdio: 'ignore' });
    git(other, 'config', 'user.email', 'test@example.com');
    git(other, 'config', 'user.name', 'Test');
    writeFileSync(path.join(other, 'second.txt'), 'second');
    git(other, 'add', '.');
    git(other, 'commit', '-m', 'second');
    git(other, 'push');

    writeFileSync(path.join(clone, 'package.json'), JSON.stringify({ version: '1.0.0', edited: true }));

    const status = await check(clone);
    assert.equal(status.behind, true, 'it still says so');
    assert.equal(status.updatable, false, 'but will not touch a dirty tree');
    assert.match(status.note, /by hand/);
  } finally {
    cleanup();
  }
});

test('a branch that tracks nothing is not out of date, it is unknown', async () => {
  const { clone, cleanup } = scratch();
  try {
    git(clone, 'checkout', '-b', 'mine');
    const status = await check(clone);
    assert.equal(status.behind, false, 'no badge for someone on their own branch');
    assert.equal(status.updatable, false);
    assert.match(status.note, /tracks nothing/);
  } finally {
    cleanup();
  }
});

test('a copy that is not a checkout falls back to the published version', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'betterslack-plain-'));
  try {
    // No network in tests: an unreachable repo name is the offline case, and
    // the answer has to be "do not know" rather than "out of date".
    const status = await checkForUpdate({
      root,
      version: '2.0.0',
      repo: 'betterslack-does-not-exist/nope',
      branch: 'main',
    });
    assert.equal(status.behind, false);
    assert.equal(status.updatable, false);
    assert.ok(status.note, 'and it says why it does not know');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('versions are compared as numbers, not as text', () => {
  assert.equal(isNewer('1.2.10', '1.2.9'), true, '10 is not smaller than 9');
  assert.equal(isNewer('2.0.0', '10.0.0'), false);
  assert.equal(isNewer('1.0.0', '1.0.0'), false, 'the same version is not newer');
  assert.equal(isNewer('1.1', '1.0.9'), true, 'a missing part counts as zero');
});

test('a copy with no git is offered the tarball route, not a shrug', async () => {
  // Most people arrive through GitHub's "Download ZIP" button, which leaves no
  // history at all. Saying "you are out of date, good luck" to the majority is
  // not an update system.
  const root = mkdtempSync(path.join(tmpdir(), 'betterslack-zip-'));
  try {
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'betterslack', version: '1.0.0' }));
    // A real repository, so the version really is read from GitHub.
    const status = await checkForUpdate({
      root,
      version: '0.0.1',
      repo: 'AirOne-dev/SlackMod',
      branch: 'master',
    });
    if (status.kind === 'unknown') return; // offline: nothing to assert about
    assert.equal(status.kind, 'package');
    assert.equal(status.behind, true, '0.0.1 is behind whatever is published');
    assert.equal(status.updatable, true, 'and it can be replaced without git');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an archive that is not this project is refused, and changes nothing', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'betterslack-wrong-'));
  try {
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'betterslack', version: '1.0.0' }));
    writeFileSync(path.join(root, 'mine.txt'), 'do not lose me');

    // A repository that exists and is emphatically not BetterSlack.
    const result = await applyUpdate({ root, repo: 'nodejs/node', branch: 'main' });
    assert.equal(result.ok, false);
    assert.ok(
      /not BetterSlack|GitHub answered|fetch failed|timed out|terminated/i.test(result.detail),
      `unexpected reason: ${result.detail}`,
    );
    assert.equal(readFileSync(path.join(root, 'mine.txt'), 'utf8'), 'do not lose me',
      'the install is untouched when the archive is refused');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
