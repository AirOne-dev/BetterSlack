#!/usr/bin/env node
// What an installed BetterSlack actually is, answered in one place.
//
// All three installers end here -- install.sh on macOS and Linux, install.ps1
// on Windows -- so the question "what gets installed" has one answer instead of
// three, written in three languages that would drift apart the first time one
// of them was edited.
//
// An install is small on purpose. dist/loader.mjs imports nothing but Node's
// own built-ins, so a working install is the bundles, the entry point, the mod
// catalogue and a Node to run them: about 6 MB, against the 61 MB of
// node_modules the build needed. The checkout that built it is not part of it,
// which is what lets install.sh be run from a clone the user then deletes.

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** `--key value` off the command line, since this is called from shell scripts. */
function flag(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at !== -1 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

/*
 * Beside the settings, not inside the checkout.
 *
 * ~/.betterslack is already where settings.json and the installed mods live, so
 * an install adds one directory to a folder that is already the user's, rather
 * than a second home somewhere else to explain and to clean up. BETTERSLACK_HOME
 * moves the lot, and the tests rely on it.
 */
const home = flag('home', process.env.BETTERSLACK_HOME ?? path.join(homedir(), '.betterslack'));
const target = path.join(home, 'app');

/*
 * The Node this install will run under, pinned as an absolute path.
 *
 * Left to look itself up at launch, the app takes whatever the first `node` on
 * a GUI process's PATH happens to be -- which is nvm's `default` alias, an
 * old one on plenty of machines, and too old to parse the loader on some. The
 * installer has already found a Node good enough to build with; that is the one
 * to remember. Launchers read this file and only go looking if it is gone.
 */
const nodePath = path.resolve(flag('node', process.execPath));

/**
 * Everything an install is made of, and nothing else.
 *
 * mods/ is the reviewed catalogue the Browse shelf offers; it is not what the
 * user has installed, which lives in ~/.betterslack/mods and is untouched here.
 * package.json comes along because the updater refuses to replace an install
 * whose manifest does not name this project, and because it carries the version
 * the update check compares against.
 */
const CONTENTS = ['package.json', 'bin', 'dist', 'mods'];

/*
 * And the version judge, so a launcher can heal itself.
 *
 * The Node recorded below can go away -- an nvm version the user prunes, a
 * Homebrew upgrade -- and a launcher that could only read that one path would
 * then fail with nothing to suggest but a reinstall. With this file beside the
 * app, it can look for another Node and check it against the same engines the
 * installer used. It reads ../package.json, which is why it is staged under
 * app/scripts rather than next to the bundles.
 */
const FILES = [['scripts/node-ok.cjs', 'scripts/node-ok.cjs']];

/**
 * Refuse to stage an install that would not run.
 *
 * The slimness above is a claim about the bundle, and a claim is worth checking:
 * the day somebody adds a real dependency to the loader, esbuild leaves a bare
 * import in loader.mjs, and a staged install without node_modules dies at
 * startup with a module-not-found -- in the log, where nothing shows it, which
 * is the failure this whole installer exists to stop happening. Better to fail
 * here, naming the import.
 */
async function assertSelfContained() {
  const bundle = await fs.readFile(path.join(root, 'dist', 'loader.mjs'), 'utf8').catch(() => null);
  if (bundle === null) {
    throw new Error('dist/loader.mjs is missing -- run the build before staging an install');
  }
  const external = [...bundle.matchAll(/(?:^|\n)\s*import\s[^\n]*?from\s*["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter((specifier) => !specifier.startsWith('node:'));
  if (external.length) {
    throw new Error(
      `dist/loader.mjs imports ${[...new Set(external)].join(', ')}, which a staged install has `
      + 'no node_modules to satisfy. Either bundle it, or teach this script to bring it along.',
    );
  }
}

await assertSelfContained();

/*
 * Replaced whole rather than merged.
 *
 * A staged install is disposable and rebuilt in seconds, and copying a new
 * catalogue over an old one leaves behind every mod that has since been renamed
 * or withdrawn -- which the panel would go on offering.
 */
await fs.rm(target, { recursive: true, force: true });
await fs.mkdir(target, { recursive: true });
for (const entry of CONTENTS) {
  await fs.cp(path.join(root, entry), path.join(target, entry), { recursive: true });
}
for (const [from, to] of FILES) {
  await fs.mkdir(path.dirname(path.join(target, to)), { recursive: true });
  await fs.copyFile(path.join(root, from), path.join(target, to));
}

await fs.writeFile(path.join(target, 'node-path'), `${nodePath}\n`, 'utf8');

// The installers read these two lines rather than recomputing the paths.
console.log(`app=${target}`);
console.log(`node=${nodePath}`);
