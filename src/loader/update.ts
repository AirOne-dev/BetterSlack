// Is this copy of BetterSlack out of date, and can it update itself?
//
// Two installations, two answers, and both can update themselves.
//
// A git checkout -- what anyone running from source has -- is asked precisely:
// fetch, then count the commits between HEAD and the branch it tracks, and
// update with a fast-forward pull.
//
// A copy downloaded with GitHub's "Download ZIP" button has no history at all.
// It is compared by the version in package.json on the default branch, and
// updated by fetching that branch's tarball and unpacking it over the install.
// Which is the more delicate of the two, so: everything is downloaded and
// extracted first, the install is only touched once the new copy is complete on
// disk, the previous one is kept beside it until the new one has built, and
// nothing outside the install directory is read or written -- what a person has
// installed, enabled and written themselves lives in ~/.betterslack, which this
// never goes near.
//
// Everything here fails soft. Being offline, behind a proxy, on a fork with no
// upstream or in a detached head are all ordinary situations, and none of them
// is worth a message at boot: the check simply says it does not know, and no
// badge appears.

import { exec as execCallback } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { UpdateStatus } from '../shared/protocol.js';

const exec = promisify(execCallback);

/** Long enough for a fetch over a slow link, short enough to never hold a boot. */
const GIT_TIMEOUT_MS = 20_000;
const HTTP_TIMEOUT_MS = 8_000;

export type { UpdateStatus } from '../shared/protocol.js';

async function git(root: string, command: string): Promise<string | null> {
  try {
    const { stdout } = await exec(`git ${command}`, { cwd: root, timeout: GIT_TIMEOUT_MS });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function isCheckout(root: string): Promise<boolean> {
  return fs
    .stat(path.join(root, '.git'))
    .then(() => true)
    .catch(() => false);
}

/** The version on the default branch, for copies with no history of their own. */
async function publishedVersion(repo: string, branch: string): Promise<string | null> {
  const url = `https://raw.githubusercontent.com/${repo}/${branch}/package.json`;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return null;
    const manifest = (await response.json()) as { version?: string };
    return typeof manifest.version === 'string' ? manifest.version : null;
  } catch {
    return null;
  }
}

/** `1.2.10` is newer than `1.2.9`, which a string comparison gets wrong. */
export function isNewer(candidate: string, current: string): boolean {
  const parse = (value: string) => value.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const [a, b] = [parse(candidate), parse(current)];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left > right;
  }
  return false;
}

export interface CheckOptions {
  root: string;
  version: string;
  /** owner/name, for a copy that has no git remote to ask. */
  repo: string;
  branch: string;
}

export async function checkForUpdate({ root, version, repo, branch }: CheckOptions): Promise<UpdateStatus> {
  if (await isCheckout(root)) {
    const remote = await git(root, 'remote');
    if (!remote) {
      return { kind: 'git', behind: false, updatable: false, note: 'no remote to compare against' };
    }
    // The branch this checkout follows, not a hard-coded one: someone working
    // on a branch of their own should not be told they are behind master.
    const upstream = await git(root, 'rev-parse --abbrev-ref --symbolic-full-name @{u}');
    if (!upstream) {
      return { kind: 'git', behind: false, updatable: false, note: 'this branch tracks nothing' };
    }
    if ((await git(root, 'fetch --quiet')) === null) {
      return { kind: 'git', behind: false, updatable: false, note: 'could not reach the remote' };
    }
    const counts = await git(root, `rev-list --left-right --count HEAD...${upstream}`);
    if (!counts) return { kind: 'git', behind: false, updatable: false, note: 'could not compare' };
    const [, behindText] = counts.split(/\s+/);
    const commits = Number.parseInt(behindText ?? '0', 10) || 0;
    const headline = commits > 0 ? await git(root, `log -1 --format=%s ${upstream}`) : null;

    // Only offer to pull when the pull would be a fast-forward. Local work in
    // progress is not something an update button should be resolving.
    const dirty = (await git(root, 'status --porcelain')) ?? '';
    const ahead = Number.parseInt(counts.split(/\s+/)[0] ?? '0', 10) || 0;

    return {
      kind: 'git',
      behind: commits > 0,
      commits,
      headline: headline ?? undefined,
      updatable: commits > 0 && ahead === 0 && dirty === '',
      note: commits > 0 && (ahead > 0 || dirty !== '')
        ? 'there are local changes here, so this one has to be pulled by hand'
        : undefined,
    };
  }

  const latest = await publishedVersion(repo, branch);
  if (!latest) return { kind: 'unknown', behind: false, updatable: false, note: 'could not reach GitHub' };
  const behind = isNewer(latest, version);
  return {
    kind: 'package',
    behind,
    latest,
    // No git needed: the branch tarball is fetched and unpacked in its place.
    updatable: behind && (await canUnpack()),
    note: behind && !(await canUnpack())
      ? 'tar is not available here, so this one has to be downloaded by hand'
      : undefined,
  };
}

/** `tar` reads .tar.gz on macOS, Linux and Windows 10+ alike. Checked, not assumed. */
async function canUnpack(): Promise<boolean> {
  try {
    await exec('tar --version', { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

export interface UpdateResult {
  ok: boolean;
  /** What happened, for the panel to show verbatim. */
  detail: string;
}

/**
 * Pull, rebuild, and report.
 *
 * `--ff-only` on purpose: an update button that can produce a merge conflict is
 * a button that can leave someone with a broken install and no idea why. If it
 * cannot fast-forward, it says so and changes nothing.
 */
export interface ApplyOptions {
  root: string;
  repo: string;
  branch: string;
}

/**
 * Update whichever kind of install this is.
 *
 * A checkout is pulled. Anything else is replaced from the branch tarball,
 * which is the only route open to a copy that came from the Download ZIP
 * button -- and that is most people.
 */
export async function applyUpdate(options: ApplyOptions): Promise<UpdateResult> {
  return (await isCheckout(options.root))
    ? pullUpdate(options.root)
    : unpackUpdate(options);
}

/**
 * Replace the install with the branch tarball.
 *
 * The order matters more than anything else here. Download, unpack and verify
 * the new copy in a temporary directory first; only then move the old install
 * aside and the new one into place; and put the old one back if the build
 * fails. An update that half-copies over a running install leaves someone with
 * neither version, and no way to tell what happened.
 */
async function unpackUpdate({ root, repo, branch }: ApplyOptions): Promise<UpdateResult> {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'betterslack-update-'));
  const archive = path.join(work, 'source.tar.gz');
  const previous = `${root}.previous`;

  try {
    const url = `https://codeload.github.com/${repo}/tar.gz/refs/heads/${branch}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) return { ok: false, detail: `GitHub answered ${response.status}` };
    await fs.writeFile(archive, Buffer.from(await response.arrayBuffer()));

    await exec(`tar -xzf ${JSON.stringify(archive)} -C ${JSON.stringify(work)}`, { timeout: 120_000 });
    // GitHub wraps the tree in one directory named after the repo and ref.
    const entries = await fs.readdir(work, { withFileTypes: true });
    const unpacked = entries.find((entry) => entry.isDirectory());
    if (!unpacked) return { ok: false, detail: 'the archive held no directory' };
    const fresh = path.join(work, unpacked.name);

    // It has to look like this project before it is allowed to replace it.
    const manifest = await fs
      .readFile(path.join(fresh, 'package.json'), 'utf8')
      .then((text) => JSON.parse(text) as { name?: string })
      .catch(() => null);
    if (manifest?.name !== 'betterslack') {
      return { ok: false, detail: 'the archive is not BetterSlack' };
    }

    // node_modules is not in the archive, and installing into the temporary
    // copy before the swap keeps the window where nothing works to one rename.
    //
    // PATH carries the directory of the Node currently running this. An install
    // that fetched its own Node has that Node nowhere on the PATH a shell would
    // hand back, so `corepack` and `npm` -- which live beside it -- would not be
    // found, and the update would fail on a machine that is working perfectly.
    const env = {
      ...process.env,
      PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ''}`,
    };
    const install = await packageManagerCommand(fresh);
    await exec(`${install} install`, { cwd: fresh, timeout: 300_000, env });
    await exec(`${install} run build`, { cwd: fresh, timeout: 300_000, env });

    /*
     * A checkout is replaced by the new tree; an install is re-staged from it.
     *
     * Handing the whole source tree to an install would undo what it is: 6 MB of
     * bundles and catalogue would become that plus src/ and 61 MB of
     * node_modules, and every later update would then need a package manager on
     * PATH -- which an install that fetched its own Node has no reason to have.
     */
    const replacement = (await isStagedInstall(root))
      ? (await stageFrom(fresh, work, env)) ?? fresh
      : fresh;

    await fs.rm(previous, { recursive: true, force: true });
    await fs.rename(root, previous);
    try {
      await fs.rename(replacement, root);
    } catch (err) {
      // Cross-device: the temporary directory is on another filesystem. Copy,
      // which is slower and always works.
      await fs.cp(replacement, root, { recursive: true });
      void err;
    }
    await fs.rm(previous, { recursive: true, force: true });
    return { ok: true, detail: 'updated' };
  } catch (err) {
    // Put the old one back if it was already moved: a failed update has to
    // leave a working install behind.
    const stranded = await fs.stat(previous).then(() => true).catch(() => false);
    const gone = !(await fs.stat(root).then(() => true).catch(() => false));
    if (stranded && gone) await fs.rename(previous, root).catch(() => undefined);
    /*
     * The panel shows this verbatim, and a failed exec puts its entire command
     * line in the message -- two absolute paths and a temporary directory, which
     * tells a reader nothing and hides the one line that would have. Keep the
     * cause, drop the invocation.
     */
    const message = (err as Error).message.split('\n')[0] ?? 'update failed';
    return { ok: false, detail: message.replace(/^Command failed: .*$/, 'the update could not be built here') };
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Is this an install rather than a checkout?
 *
 * install.sh stages the bundles, the entry point and the mod catalogue into
 * ~/.betterslack/app and leaves the source where it was, so an install has
 * dist/ and no src/. Asked rather than recorded, because a settings file can be
 * hand-edited and the layout on disk cannot lie about itself.
 */
async function isStagedInstall(root: string): Promise<boolean> {
  const has = (name: string) =>
    fs.stat(path.join(root, name)).then(() => true).catch(() => false);
  return (await has('dist')) && !(await has('src'));
}

/**
 * Build the replacement for a staged install, using the new copy's own staging
 * script rather than this one's idea of what an install contains -- the update
 * being installed is the authority on that, which is what lets the shape of an
 * install change in a later version without stranding everyone on this one.
 */
async function stageFrom(
  fresh: string,
  work: string,
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  const home = path.join(work, 'staged');
  const script = path.join(fresh, 'scripts', 'stage-install.mjs');

  /*
   * A version that does not know how to stage is not a failed update.
   *
   * Moving to a branch or a tag older than staging -- or forward to one that
   * has renamed it -- leaves this script absent, and the tree that was just
   * built is a perfectly good BetterSlack either way. Answering null puts the
   * whole tree in place instead: fatter than an install means to be, and
   * working, which is the right way round. Refusing here would strand somebody
   * on the version they were trying to leave.
   */
  const usable = await fs.stat(script).then(() => true).catch(() => false);
  if (!usable) return null;

  await exec(
    `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`
      + ` --home ${JSON.stringify(home)} --node ${JSON.stringify(process.execPath)}`,
    { cwd: fresh, timeout: 120_000, env },
  );
  return path.join(home, 'app');
}

/** pnpm when there is a pnpm lockfile, npm otherwise. */
async function packageManagerCommand(root: string): Promise<string> {
  const hasPnpmLock = await fs
    .stat(path.join(root, 'pnpm-lock.yaml'))
    .then(() => true)
    .catch(() => false);
  if (!hasPnpmLock) return 'npm';
  return (await exec('pnpm --version', { timeout: 5_000 }).then(() => true).catch(() => false))
    ? 'pnpm'
    // corepack ships with Node, so a machine with no pnpm on PATH still has one.
    : 'corepack pnpm';
}

async function pullUpdate(root: string): Promise<UpdateResult> {
  const before = await git(root, 'rev-parse HEAD');
  try {
    await exec('git pull --ff-only', { cwd: root, timeout: GIT_TIMEOUT_MS });
  } catch (err) {
    return { ok: false, detail: `git pull failed: ${(err as Error).message.split('\n')[0]}` };
  }
  const after = await git(root, 'rev-parse HEAD');
  if (before === after) return { ok: false, detail: 'already up to date' };

  try {
    // The loader and the runtime both ship as bundles, so a pull alone changes
    // nothing until they are rebuilt.
    await exec('pnpm build', { cwd: root, timeout: 120_000 });
  } catch (err) {
    return { ok: false, detail: `build failed: ${(err as Error).message.split('\n')[0]}` };
  }
  return { ok: true, detail: 'updated' };
}
