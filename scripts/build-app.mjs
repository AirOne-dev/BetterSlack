#!/usr/bin/env node
// Builds dist/BetterSlack.app -- the macOS launcher for an installed
// BetterSlack, and puts it in /Applications with --install.
//
// install.sh calls this; it is not something a user runs directly. It makes a
// launcher, not a bundle: the app starts what install.sh staged into
// ~/.betterslack/app, so this file's only job is to be a double-clickable thing
// that finds it.
//
// **The bundle's executable is a real binary, and that is the whole point.**
//
// macOS gates Desktop, Documents and Downloads per application, and BetterSlack
// writes to Downloads -- that is where api.files.save puts a saved avatar or a
// screenshot. An app whose executable is a shell script is not an application
// as far as that gate is concerned: the process it sees is /bin/bash, a
// platform binary with no identity of its own, so the write is refused outright
// with no prompt, and tccutil does not even have a record of the bundle to
// reset. Measured with four throwaway bundles:
//
//   script executable, unsigned            -> refused
//   script executable, ad-hoc signed       -> refused
//   script executable + usage descriptions -> refused
//   Mach-O executable                      -> allowed, no prompt at all
//   Mach-O executable exec'ing the script  -> allowed
//
// So Contents/MacOS/betterslack is a small C stub that execs
// Contents/Resources/launch.sh, and everything below it inherits the app's
// identity. Without a compiler the old shape still gets built, and then the
// gate applies again -- which is what the warning at the end is about.

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
  <!-- Shown when a mod saves a file: api.files.save writes to Downloads, which
       is one of the folders macOS asks about. -->
  <key>NSDesktopFolderUsageDescription</key><string>BetterSlack saves files you ask a mod to download.</string>
  <key>NSDocumentsFolderUsageDescription</key><string>BetterSlack saves files you ask a mod to download.</string>
  <key>NSDownloadsFolderUsageDescription</key><string>BetterSlack saves files you ask a mod to download.</string>
</dict>
</plist>
`;

/*
 * The launcher reads the Node the installer settled on; it does not go looking.
 *
 * A GUI process gets none of the user's shell PATH, and the first node on the
 * PATH it does get is nvm's default alias -- an old one on plenty of machines,
 * and on some too old to parse the loader at all, which fails as a SyntaxError
 * in a log file nothing puts on screen. install.sh has already found a Node that
 * satisfies engines; ~/.betterslack/app/node-path is where it wrote it down.
 *
 * The fallback exists because that Node can go away -- an nvm version pruned, a
 * Homebrew upgrade -- and "reinstall" is a poor answer when another perfectly
 * good Node is sitting right there. node-ok.cjs, staged beside the app, is the
 * same judge the installer used, so the two cannot disagree.
 *
 * No backticks anywhere below: this is a JavaScript template literal and one
 * would end it.
 */
const launcher = `#!/bin/bash
set -e
APP="$HOME/.betterslack/app"
LOG="$HOME/Library/Logs/BetterSlack.log"

NODE="$(cat "$APP/node-path" 2>/dev/null || true)"

if [ ! -x "$NODE" ] && [ -f "$APP/scripts/node-ok.cjs" ]; then
  for CANDIDATE in \\
    "$HOME"/.betterslack/runtime/node/bin/node \\
    "$(command -v node || true)" \\
    "$HOME"/.nvm/versions/node/*/bin/node \\
    /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node
  do
    if [ -x "$CANDIDATE" ] && "$CANDIDATE" "$APP/scripts/node-ok.cjs" >/dev/null 2>&1; then
      NODE="$CANDIDATE"
      printf '%s\\n' "$NODE" > "$APP/node-path"
      break
    fi
  done
fi

if [ ! -f "$APP/bin/betterslack.mjs" ]; then
  osascript -e 'display alert "BetterSlack" message "BetterSlack is not installed." & return & return & "Clone the repository and run ./install.sh again."'
  exit 1
fi
if [ ! -x "$NODE" ]; then
  osascript -e 'display alert "BetterSlack" message "BetterSlack cannot find a Node.js it can run on." & return & return & "Run ./install.sh again from the repository; it fetches one if this machine has none."'
  exit 1
fi

exec "$NODE" "$APP/bin/betterslack.mjs" >>"$LOG" 2>&1
`;

await fs.writeFile(path.join(app, 'Contents', 'Info.plist'), plist, 'utf8');

/*
 * The binary first, the script beside it.
 *
 * If there is no compiler the old shape is written instead -- the script as the
 * executable -- which launches fine and is refused access to Downloads.
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
 * System Settings survives the next build. Without one, macOS treats each
 * rebuild as a different application and the permission is lost.
 */
await run('codesign', ['--force', '--deep', '--sign', '-', app])
  .catch((err) => console.warn(`could not sign the app: ${err.message.split('\n')[0]}`));

console.log(`built ${app}`);

const installed = '/Applications/BetterSlack.app';

/*
 * Two quotings, and both are needed.
 *
 * do shell script takes an AppleScript string and hands it to /bin/sh, so a
 * path travels through two parsers. Escaping only the AppleScript literal leaves
 * the shell to split a path with a space in it into several arguments and delete
 * something else; quoting only for the shell leaves the AppleScript literal
 * unterminated.
 */
const forShell = (text) => `'${text.replace(/'/g, `'\\''`)}'`;
const asAppleScript = (text) => `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/**
 * Copy it in, asking for an administrator only if the plain copy is refused.
 *
 * /Applications is root:admin and group-writable, so on a Mac whose owner is an
 * administrator -- which is most of them -- this needs no password at all.
 * Asking for one up front would be a password prompt for something that does not
 * need one, so the escalation happens only after the ordinary copy has actually
 * been refused, and the terminal says what is about to be asked and why before
 * macOS puts its own dialog on screen.
 *
 * Everything the elevated shell does is done there: removing the old bundle,
 * copying the new one and signing it. Split across the two, the copy would be
 * root-owned and the signature would then fail as the user.
 */
async function install() {
  /*
   * A bundle in ~/Applications, where an older BetterSlack installed itself.
   * Left behind it is a second launcher with the same name, and Spotlight
   * offers whichever it indexed first -- one of which runs an older build.
   */
  const previous = path.join(homedir(), 'Applications', 'BetterSlack.app');
  await fs.rm(previous, { recursive: true, force: true }).catch(() => undefined);

  try {
    await fs.rm(installed, { recursive: true, force: true });
    await fs.cp(app, installed, { recursive: true });
    await run('codesign', ['--force', '--deep', '--sign', '-', installed]).catch(() => undefined);
    console.log(`installed ${installed}`);
    return;
  } catch (err) {
    const code = err?.code;
    if (code !== 'EACCES' && code !== 'EPERM' && code !== 'EROFS') throw err;
  }

  console.log(
    '\n/Applications is owned by root, and this account cannot write to it.'
    + '\nmacOS is about to ask for your password. It is used for one thing: to'
    + `\ncopy BetterSlack.app into ${installed} and sign it there.`
    + '\nNothing else is run with those rights, and nothing outside that folder'
    + '\nis touched. Cancelling leaves the app in dist/ and changes nothing.',
  );

  const script = [
    `rm -rf ${forShell(installed)}`,
    `cp -R ${forShell(app)} ${forShell(installed)}`,
    `codesign --force --deep --sign - ${forShell(installed)}`,
  ].join(' && ');

  try {
    await run('osascript', ['-e', `do shell script ${asAppleScript(script)} with administrator privileges`]);
    console.log(`installed ${installed}`);
  } catch (err) {
    console.error(
      `\ncould not install into /Applications: ${err.message.split('\n')[0]}`
      + `\nThe app is still built at ${app}. Move it yourself, or run install.sh`
      + '\nagain and allow the prompt.',
    );
    process.exitCode = 1;
  }
}

if (process.argv.includes('--install')) await install();

if (!compiled) {
  console.warn(
    '\nThere is no C compiler on this machine, so the app is a shell script. It\n'
    + 'launches fine, but macOS refuses it access to Downloads, which is where a\n'
    + 'mod saves a file. Install the Xcode command line tools\n'
    + '(xcode-select --install) and run install.sh again to fix that.',
  );
}
