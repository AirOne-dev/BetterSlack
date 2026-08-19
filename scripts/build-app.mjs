#!/usr/bin/env node
// Builds dist/BetterSlack.app — a thin macOS wrapper that starts the loader
// without leaving a terminal window open.
//
// It is a launcher, not a bundle: it runs the loader from this checkout, so the
// repository has to stay where it is. That is a deliberate simplification over
// vendoring a Node runtime into the app.
//
// **macOS gates Desktop, Documents and Downloads per application.** A terminal
// has been granted that access; a freshly built, unsigned app has not, and no
// prompt appears for one — the read just fails with EPERM. Measured with a
// throwaway bundle: the same script reads `~/anything` and is refused
// `~/Desktop/anything`. So a checkout in one of those folders produces an app
// that cannot read its own repository, which is worth saying at build time
// rather than leaving in a log file as a stack trace.

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
await fs.writeFile(path.join(app, 'Contents', 'MacOS', 'betterslack'), launcher, { mode: 0o755 });
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

const GATED = ['Desktop', 'Documents', 'Downloads'].map((name) => path.join(homedir(), name));
if (GATED.some((dir) => root === dir || root.startsWith(`${dir}${path.sep}`))) {
  console.warn(
    '\nThis project is in a folder macOS gates per application, so the app will not\n'
    + 'be able to read it: an unsigned app is refused, and no prompt is shown. Either\n'
    + 'move the project somewhere like ~/code and build again, or grant BetterSlack.app\n'
    + 'Full Disk Access in System Settings > Privacy & Security.',
  );
}

console.log('Unsigned: the first launch needs right-click -> Open.');
console.log('Logs: ~/Library/Logs/BetterSlack.log');
