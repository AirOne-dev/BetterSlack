#!/usr/bin/env node
// Builds dist/BetterSlack.app — a thin macOS wrapper that starts the loader
// without leaving a terminal window open.
//
// It is a launcher, not a bundle: it runs the loader from this checkout, so the
// repository has to stay where it is. That is a deliberate simplification over
// vendoring a Node runtime into the app.
//
// **The bundle's executable is a real binary, and that is the whole point.**
//
// macOS gates Desktop, Documents and Downloads per application. An app whose
// executable is a shell script is not an application as far as that gate is
// concerned -- the process it sees is /bin/bash, a platform binary with no
// identity of its own -- so the read is refused outright, with no prompt, and
// `tccutil` does not even have a record of the bundle to reset. Measured with
// four throwaway bundles:
//
//   script executable, unsigned            -> refused
//   script executable, ad-hoc signed       -> refused
//   script executable + usage descriptions -> refused
//   Mach-O executable                      -> allowed, no prompt at all
//   Mach-O executable exec'ing the script  -> allowed
//
// So `Contents/MacOS/betterslack` is a three-line C stub that execs
// `Contents/Resources/launch.sh`, and everything below it inherits the app's
// identity. Without a compiler on the machine the old shape still gets built,
// and then the gate applies again -- which is what the warning at the end is
// about.

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

if (process.platform !== 'darwin') {
  console.error('build-app only works on macOS.');
  process.exit(1);
}

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'dist', 'BetterSlack.app');
const { version } = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));

await fs.rm(app, { recursive: true, force: true });
await fs.mkdir(path.join(app, 'Contents', 'MacOS'), { recursive: true });
await fs.mkdir(path.join(app, 'Contents', 'Resources'), { recursive: true });

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>betterslack</string>
  <key>CFBundleIdentifier</key><string>dev.airone.betterslack</string>
  <key>CFBundleName</key><string>BetterSlack</string>
  <key>CFBundleVersion</key><string>${version}</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleIconFile</key><string>icon.icns</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSUIElement</key><true/>
  <!-- Shown if macOS ever does ask. It does not, for this shape of app, but a
       missing usage description is a silent denial on some releases. -->
  <key>NSDesktopFolderUsageDescription</key><string>BetterSlack reads the project folder it was built from.</string>
  <key>NSDocumentsFolderUsageDescription</key><string>BetterSlack reads the project folder it was built from.</string>
  <key>NSDownloadsFolderUsageDescription</key><string>BetterSlack reads the project folder it was built from.</string>
</dict>
</plist>
`;

// `command -v node` rather than a hardcoded path: Homebrew, nvm, Volta and the
// official installer all put it somewhere different, and a GUI launch does not
// get the user's interactive shell PATH.
const launcher = `#!/bin/bash
set -e
REPO="${root}"
LOG="$HOME/Library/Logs/BetterSlack.log"

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true; fi

NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  osascript -e 'display alert "BetterSlack" message "Node.js was not found. Install it from nodejs.org, then try again."'
  exit 1
fi
# Ask the operating system rather than guessing: under macOS's file gate the
# entry point is not missing, it is forbidden, and a -f test reports both as
# false. The error text is what tells them apart. (No backticks in here:
# this whole script is a JavaScript template literal, and one would end it.)
#
# The "|| true" is load-bearing. Under set -e an assignment takes the exit
# status of its command substitution, so WHY=$(cat missing-file) does not just
# leave WHY empty -- it ends the script, before the alert below can say why.
# Launching the app then did nothing at all, visibly or in the log.
WHY="$(cat "$REPO/bin/betterslack.mjs" 2>&1 >/dev/null)" || true
if [ -n "$WHY" ]; then
  case "$WHY" in
    *"Operation not permitted"*)
      osascript -e 'display alert "BetterSlack" message "macOS is blocking BetterSlack from reading its own folder, because the project is somewhere it protects: the Desktop, Documents or Downloads." & return & return & "Either move the project elsewhere and run pnpm build-app again, or give BetterSlack.app Full Disk Access in System Settings > Privacy & Security."' ;;
    *)
      osascript -e 'display alert "BetterSlack" message "BetterSlack could not be started from this folder." & return & return & "Check that the project is still where it was when the app was built."' ;;
  esac
  exit 1
fi
if [ ! -f "$REPO/dist/loader.mjs" ]; then
  osascript -e 'display alert "BetterSlack" message "BetterSlack is not built. Run pnpm install && pnpm build in the repository."'
  exit 1
fi

exec "$NODE" "$REPO/bin/betterslack.mjs" >>"$LOG" 2>&1
`;

await fs.writeFile(path.join(app, 'Contents', 'Info.plist'), plist, 'utf8');

/*
 * The binary first, the script beside it.
 *
 * If there is no compiler the old shape is written instead -- the script as the
 * executable -- which works everywhere except the folders macOS gates.
 */
let compiled = false;
try {
  await run('cc', [
    '-O2', '-o', path.join(app, 'Contents', 'MacOS', 'betterslack'),
    path.join(root, 'scripts', 'launcher.c'),
  ]);
  await fs.writeFile(path.join(app, 'Contents', 'Resources', 'launch.sh'), launcher, { mode: 0o755 });
  compiled = true;
} catch (err) {
  console.warn(`no C compiler (${err.message.split('\n')[0]}), falling back to a script launcher`);
  await fs.writeFile(path.join(app, 'Contents', 'MacOS', 'betterslack'), launcher, { mode: 0o755 });
}
await fs.copyFile(
  path.join(root, 'assets', 'icon.icns'),
  path.join(app, 'Contents', 'Resources', 'icon.icns'),
).catch(() => console.warn('no assets/icon.icns, the app will use the default icon'));

/*
 * Signed ad-hoc, which is not about trust.
 *
 * It gives the bundle a stable identity, so any access the user grants it in
 * System Settings survives the next `pnpm build-app`. Without one, macOS treats
 * each rebuild as a different application and the permission is lost.
 */
await run('codesign', ['--force', '--deep', '--sign', '-', app])
  .catch((err) => console.warn(`could not sign the app: ${err.message.split('\n')[0]}`));

console.log(`built ${app}`);

/*
 * Where it has to live to work.
 *
 * `dist/` is inside the repository, and if the repository is on the Desktop
 * then so is the app -- which cannot then read its own launcher, let alone the
 * project. Copied to ~/Applications it reads itself fine, and the only thing
 * left needing permission is the project, which macOS will ask about once.
 */
const installed = path.join(homedir(), 'Applications', 'BetterSlack.app');
if (process.argv.includes('--install')) {
  await fs.mkdir(path.dirname(installed), { recursive: true });
  await fs.rm(installed, { recursive: true, force: true });
  await fs.cp(app, installed, { recursive: true });
  await run('codesign', ['--force', '--deep', '--sign', '-', installed]).catch(() => undefined);
  console.log(`installed ${installed}`);
}

const GATED = ['Desktop', 'Documents', 'Downloads'].map((name) => path.join(homedir(), name));
const gated = GATED.some((dir) => root === dir || root.startsWith(`${dir}${path.sep}`));

if (!compiled && gated) {
  console.warn(
    '\nThis project is in a folder macOS gates per application, and without a\n'
    + 'compiler the app is a shell script, which that gate refuses outright. Install\n'
    + 'the Xcode command line tools (xcode-select --install) and build again, or move\n'
    + 'the project somewhere like ~/code.',
  );
} else if (gated && !process.argv.includes('--install')) {
  console.warn(
    `\nThis project is in a folder macOS gates per application, so the app cannot be\n`
    + `run from ${path.relative(root, app)} -- it cannot read its own launcher there, and a\n`
    + `double-click does nothing at all. Run "pnpm build-app --install" to put a copy in\n`
    + `~/Applications and open it from there; macOS will ask once about the project.`,
  );
}

if (gated) {
  console.log(
    '\nmacOS asks about the project the first time, and remembers the answer for as\n'
    + 'long as the app is not rebuilt: an ad-hoc signature identifies a bundle by its\n'
    + 'contents, so building again asks again.',
  );
}

console.log('Unsigned: the first launch needs right-click -> Open.');
console.log('Logs: ~/Library/Logs/BetterSlack.log');
