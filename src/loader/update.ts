// Is this copy of SlackMod out of date, and can it update itself?
//
// Two installations, two answers. A git checkout -- which is what anyone
// running from source has -- can be asked precisely: fetch, then count the
// commits between HEAD and the branch it tracks. A copy that is not a checkout
// (the built .app, a downloaded zip) has no history to compare, so the version
// in package.json on the default branch is the only honest signal, and it only
// moves when someone bumps it.
//
// Everything here fails soft. Being offline, behind a proxy, on a fork with no
// upstream or in a detached head are all ordinary situations, and none of them
// is worth a message at boot: the check simply says it does not know, and no
// badge appears.

import { exec as execCallback } from 'node:child_process';
import { promises as fs } from 'node:fs';
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
  return {
    kind: 'package',
    behind: isNewer(latest, version),
    latest,
    // A copy with no checkout cannot pull; it has to be downloaded again.
    updatable: false,
    note: isNewer(latest, version) ? 'download the new version from GitHub' : undefined,
  };
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
export async function applyUpdate(root: string): Promise<UpdateResult> {
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
    await exec('npm run build', { cwd: root, timeout: 120_000 });
  } catch (err) {
    return { ok: false, detail: `build failed: ${(err as Error).message.split('\n')[0]}` };
  }
  return { ok: true, detail: 'updated' };
}
