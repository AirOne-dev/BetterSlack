#!/usr/bin/env node
// Cut a version, so the update check has something to compare.
//
//   pnpm release patch|minor|major
//   pnpm release 3.1.0
//   pnpm release patch --dry-run
//
// This exists because the updater does not work without it. A copy installed
// from GitHub's Download ZIP has no history: the only thing it can compare is
// the version in package.json on the default branch. That number had not moved
// since the project was created, so for everyone who is not running a git
// checkout, "you are up to date" was a fact about nothing.
//
// The changelog is generated from the commits since the last tag rather than
// written by hand, because a changelog nobody updates is worse than none.

import { exec as execCallback } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execCallback);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const target = args.find((arg) => !arg.startsWith('--')) ?? 'patch';

const run = async (command) => (await exec(command, { cwd: root, maxBuffer: 4_000_000 })).stdout.trim();

/** The next version, from a bump word or a literal one. */
export function nextVersion(current, request) {
  if (/^\d+\.\d+\.\d+$/.test(request)) return request;
  const [major, minor, patch] = current.split('.').map((part) => Number.parseInt(part, 10) || 0);
  if (request === 'major') return `${major + 1}.0.0`;
  if (request === 'minor') return `${major}.${minor + 1}.0`;
  if (request === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`"${request}" is neither a version nor one of major, minor, patch`);
}

/**
 * Commits since the last release, grouped the way they were written.
 *
 * Conventional-ish prefixes are what this repository already uses, so the
 * grouping is free. Anything unprefixed lands under "Other", which is a nudge
 * rather than a rule.
 */
export function groupCommits(lines) {
  const groups = new Map([
    ['feat', { title: 'Added', items: [] }],
    ['fix', { title: 'Fixed', items: [] }],
    ['refactor', { title: 'Changed', items: [] }],
    ['docs', { title: 'Documentation', items: [] }],
    ['other', { title: 'Other', items: [] }],
  ]);

  for (const line of lines) {
    if (!line.trim()) continue;
    const match = /^(\w+)(?:\(([^)]+)\))?!?:\s*(.+)$/.exec(line);
    const kind = match && groups.has(match[1]) ? match[1] : 'other';
    const scope = match?.[2];
    const text = match ? match[3] : line;
    groups.get(kind).items.push(scope ? `**${scope}:** ${text}` : text);
  }

  return [...groups.values()].filter((group) => group.items.length > 0);
}

const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const version = nextVersion(manifest.version, target);

const lastTag = await run('git describe --tags --abbrev=0').catch(() => '');
const range = lastTag ? `${lastTag}..HEAD` : 'HEAD';
const log = await run(`git log ${range} --no-merges --format=%s`);
const groups = groupCommits(log.split('\n'));

if (groups.length === 0) {
  console.error(`Nothing to release: no commits since ${lastTag || 'the beginning'}.`);
  process.exit(1);
}

const today = (await run('git log -1 --format=%cd --date=short')) || new Date().toISOString().slice(0, 10);
const entry = [
  `## ${version} — ${today}`,
  '',
  ...groups.flatMap((group) => [`### ${group.title}`, '', ...group.items.map((item) => `- ${item}`), '']),
].join('\n');

const changelogPath = path.join(root, 'CHANGELOG.md');
const existing = await fs.readFile(changelogPath, 'utf8').catch(() => null);
/*
 * Matched exactly, to insert beneath. It has to stay identical to the one in
 * CHANGELOG.md: `replace` with a string that is not found changes nothing and
 * says nothing, so a drifted header would drop the release's entry silently.
 */
const header = '# Changelog\n\nWritten for the people upgrading. `pnpm release` seeds each section from the\n'
  + 'commits since the last tag; the release then rewrites it into something worth\n'
  + 'reading.\n\n';
const changelog = existing
  ? existing.replace(header, `${header}${entry}\n`)
  : `${header}${entry}\n`;

if (dryRun) {
  console.log(entry);
  console.log(`(dry run: package.json would go ${manifest.version} -> ${version})`);
  process.exit(0);
}

const dirty = await run('git status --porcelain');
if (dirty) {
  console.error('The tree is not clean. Commit or stash first: a release should describe a known state.');
  process.exit(1);
}

manifest.version = version;
await fs.writeFile(path.join(root, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await fs.writeFile(changelogPath, changelog);

/*
 * Every API entry marked `unreleased` is now released, and this is the moment
 * it gets its number.
 *
 * A new entry is written `since: unreleased` because the version it will ship
 * in is not decided when it is added -- and that word is what makes a mod using
 * it refuse to install on any published build, correctly, since the call really
 * is in none of them. Cutting the release is exactly when that stops being
 * true, so stamping it anywhere else would mean remembering to.
 */
const apiDir = path.join(root, 'docs', 'api');
let stamped = 0;
for (const file of await fs.readdir(apiDir)) {
  if (!file.endsWith('.md')) continue;
  const at = path.join(apiDir, file);
  const text = await fs.readFile(at, 'utf8');
  if (!/^since: unreleased$/m.test(text)) continue;
  await fs.writeFile(at, text.replace(/^since: unreleased$/m, `since: ${version}`));
  stamped += 1;
}
if (stamped) console.log(`marked ${stamped} API entr(ies) as since ${version}`);

/*
 * And the registry, which publishes what each mod needs. Those floors are
 * computed from the `since` values just stamped, so a registry built before
 * this point still says `unreleased` -- and every mod that used a new call
 * would stay uninstallable for everyone after the release that fixed it.
 */
await run('node scripts/build-registry.mjs');

/*
 * The site carries the version too.
 *
 * `site/data.js` is generated from the catalogue and holds the number, and it
 * is committed and checked for drift -- so a release that bumped only
 * package.json left the published site a version behind and the Pages job red
 * on the next push. Regenerated here rather than remembered.
 */
await run('node scripts/build-site.mjs');

/*
 * `docs/` whole, not `docs/api/`.
 *
 * docs/api.md is generated from that folder and sits beside it, so a list
 * naming only the folder leaves it modified and uncommitted -- and the next
 * `pnpm check` reports a dirty tree for a drift the release itself caused.
 */
await run('git add package.json CHANGELOG.md site/ docs/ mods/registry.json');
await run(`git commit -m "release: ${version}"`);
await run(`git tag -a v${version} -m "${version}"`);

console.log(`
Released ${version}.

  git push && git push --tags

The update check compares this number for anyone who installed from a zip, so
it only reaches them once the tag and package.json are on the default branch.

Pushing the tag is also what creates the release on GitHub: a tag is a git
object and a release is one of theirs, so nothing here can make one. The
Release workflow reads this version's section out of CHANGELOG.md and posts it
as the notes -- which is why the changelog is worth rewriting before pushing,
and why there is no second copy of the notes to keep in step.
`);
