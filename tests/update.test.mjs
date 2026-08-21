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
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyUpdate, checkForUpdate, isNewer } from '../dist/update.mjs';

/*
 * store.ts resolves the home directory once, when it is imported, which is
 * right for the app and awkward here: the variable has to be set before the
 * module is pulled in, and one home has to serve both backup tests.
 */
const BACKUP_HOME = mkdtempSync(path.join(tmpdir(), 'betterslack-home-'));
process.env.BETTERSLACK_HOME = BACKUP_HOME;
const { exportBackup, importBackup } = await import('../dist/store.mjs');

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

test('a checkout names the published version, so the notice need not count commits', async () => {
  /*
   * "Four commits behind" is true and means nothing to somebody who has never
   * made one -- and a git checkout is what install.sh leaves behind, so it is
   * not a developer's install by any means. The fetch has already brought the
   * ref down, so reading package.json out of it costs nothing.
   */
  const { origin, clone, root, cleanup } = scratch();
  try {
    const other = path.join(root, 'other');
    execFileSync('git', ['clone', origin, other], { stdio: 'ignore' });
    git(other, 'config', 'user.email', 'test@example.com');
    git(other, 'config', 'user.name', 'Test');
    writeFileSync(path.join(other, 'package.json'), JSON.stringify({ version: '1.1.0' }));
    git(other, 'add', '.');
    git(other, 'commit', '-m', 'release: 1.1.0');
    git(other, 'push');

    const status = await check(clone);
    assert.equal(status.behind, true);
    assert.equal(status.latest, '1.1.0', 'two numbers to show, not a count');
  } finally {
    cleanup();
  }
});

test('a branch that moved without a release has no version to name', async () => {
  // And there the count of changes is the only honest measure there is:
  // "1.0.0 is out, you have 1.0.0" would be worse than saying nothing.
  const { origin, clone, root, cleanup } = scratch();
  try {
    const other = path.join(root, 'other');
    execFileSync('git', ['clone', origin, other], { stdio: 'ignore' });
    git(other, 'config', 'user.email', 'test@example.com');
    git(other, 'config', 'user.name', 'Test');
    writeFileSync(path.join(other, 'fix.txt'), 'a fix');
    git(other, 'add', '.');
    git(other, 'commit', '-m', 'fix: something');
    git(other, 'push');

    const status = await check(clone);
    assert.equal(status.behind, true);
    assert.equal(status.latest, undefined, 'the version did not move, so it is not claimed');
    assert.equal(status.commits, 1, 'the count is what is left');
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
      repo: 'AirOne-dev/BetterSlack',
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

// Mod updates, which are a different question from the app's own: a mod carries
// its own version, and a one-line fix to a theme should not require pulling the
// loader and the runtime with it.

test('only installed mods with a newer published version are offered', async () => {
  const { findModUpdates, isNewerVersion } = await import('../dist/mod-updates.mjs');

  assert.equal(isNewerVersion('1.3.0', '1.2.9'), true);
  assert.equal(isNewerVersion('1.2.10', '1.2.9'), true, '10 is not smaller than 9');
  assert.equal(isNewerVersion('1.0.0', '1.0.0'), false, 'the same version is not an update');

  // Against the real registry on the default branch, which is the only honest
  // check that the file is where this thinks it is.
  const updates = await findModUpdates(
    [
      { id: 'midnight', name: 'Midnight', version: '0.0.1', type: 'theme' },
      { id: 'not-a-real-mod', name: 'Nope', version: '0.0.1', type: 'plugin' },
    ],
    { repo: 'AirOne-dev/BetterSlack', branch: 'master' },
  );
  if (updates === null) return; // offline
  assert.equal(updates.some((u) => u.id === 'not-a-real-mod'), false,
    'a mod the catalogue does not have is not an update');
});

// A backup is the part of an install that cannot be downloaded again: the
// settings, and the mods someone wrote themselves. Catalogue mods deliberately
// stay out of it — they come back with the project, and carrying them would
// restore a stale copy over a newer one.

test('a backup carries the settings and the user’s own mods, and nothing else', async () => {
  const home = BACKUP_HOME;
  try {
    // Written the way the loader would: a user mod, and settings naming it.
    const modDir = path.join(home, 'mods', 'my-theme');
    execFileSync('mkdir', ['-p', modDir]);
    writeFileSync(path.join(modDir, 'mod.json'), JSON.stringify({ id: 'my-theme' }));
    writeFileSync(path.join(modDir, 'theme.css'), ':root { --a: 1; }');
    writeFileSync(path.join(home, 'settings.json'), JSON.stringify({
      installed: ['my-theme'], enabled: ['my-theme'], customCss: '.x {}', hotReload: true, modSettings: {},
    }));

    const archive = await exportBackup();
    const parsed = JSON.parse(archive);
    assert.equal(parsed.kind, 'betterslack-backup');
    assert.deepEqual(parsed.settings.enabled, ['my-theme']);
    assert.equal(parsed.mods['my-theme']['theme.css'], ':root { --a: 1; }');

    // Wipe it, put it back.
    rmSync(path.join(home, 'mods'), { recursive: true, force: true });
    writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ installed: [], enabled: [] }));

    const result = await importBackup(archive);
    assert.equal(result.ok, true);
    assert.equal(readFileSync(path.join(modDir, 'theme.css'), 'utf8'), ':root { --a: 1; }');
    assert.equal(JSON.parse(readFileSync(path.join(home, 'settings.json'), 'utf8')).enabled[0], 'my-theme');

    // And the two things it must refuse.
    assert.equal((await importBackup('not json')).ok, false);
    assert.equal((await importBackup(JSON.stringify({ kind: 'something-else' }))).ok, false);
  } finally {
    rmSync(path.join(home, 'mods'), { recursive: true, force: true });
  }
});

test('a backup cannot write outside the mod folder it names', async () => {
  const home = BACKUP_HOME;
  try {
    const result = await importBackup(JSON.stringify({
      kind: 'betterslack-backup',
      settings: { installed: [], enabled: [] },
      mods: { 'my-mod': { '../../escaped.js': 'nope' } },
    }));
    assert.equal(result.ok, true, 'the rest of the archive still applies');
    assert.equal(existsSync(path.join(home, '..', 'escaped.js')), false, 'and nothing escaped');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// Mods from outside this repository. The security model here is human review —
// everything in the catalogue was read by someone before it was merged — and a
// mod from a URL was not. What the code has to guarantee is that the user is
// asked before anything is written, and that the mod says where it came from
// for as long as it exists.

test('a URL is read and described before anything is installed', async () => {
  const { inspectRemote } = await import('../dist/mod-updates.mjs');

  for (const bad of ['not a url', 'https://gitlab.com/a/b', 'ftp://x']) {
    const result = await inspectRemote(bad);
    assert.ok('error' in result, `${bad} should be refused`);
  }

  // A real folder in this repository, read as if it were somebody else's.
  const result = await inspectRemote(
    'https://github.com/AirOne-dev/BetterSlack/tree/master/mods/plugins/quote-reply',
  );
  if ('error' in result) return; // offline, or rate-limited
  assert.equal(result.manifest.id, 'quote-reply');
  assert.equal(result.repo, 'AirOne-dev/BetterSlack');
  assert.ok(result.scripts.includes('index.js'), 'it says which files will run');
  assert.ok(result.bytes > 0, 'and how much of it there is');
  assert.equal(result.files['test.mjs'], undefined, 'tests are not part of a mod');
});

test('a folder with no mod.json is refused rather than half-installed', async () => {
  const { inspectRemote } = await import('../dist/mod-updates.mjs');
  const result = await inspectRemote('https://github.com/AirOne-dev/BetterSlack/tree/master/docs');
  if (!('error' in result)) assert.fail('docs/ is not a mod');
  assert.match(result.error, /mod\.json/);
});
