#!/usr/bin/env node
// The Linux launcher for an installed BetterSlack.
//
// install.sh calls this; it is not something a user runs directly. Three files,
// all under ~/.local, all following the XDG layout that every desktop
// environment reads without being told:
//
//   ~/.local/bin/betterslack                              the command
//   ~/.local/share/applications/betterslack.desktop       the menu entry
//   ~/.local/share/icons/.../betterslack.svg              the icon it draws
//
// Nothing is written outside the home directory, so no step of this needs a
// password, and uninstalling is deleting three files and ~/.betterslack.

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function flag(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at !== -1 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

const home = flag('home', process.env.BETTERSLACK_HOME ?? path.join(homedir(), '.betterslack'));
const binDir = path.join(homedir(), '.local', 'bin');
const appsDir = path.join(homedir(), '.local', 'share', 'applications');
const iconDir = path.join(homedir(), '.local', 'share', 'icons', 'hicolor', 'scalable', 'apps');
const command = path.join(binDir, 'betterslack');

/*
 * The same shape as the macOS launcher, and for the same reason.
 *
 * Started from a desktop menu there is no shell profile and no nvm, so the Node
 * that runs the loader is the one the installer wrote down -- never whatever a
 * bare PATH happens to offer, which on a machine with nvm is its default alias
 * and can be far too old to parse the loader at all. node-ok.cjs is staged
 * beside the app so a launcher whose recorded Node has gone can find another
 * and judge it by the same engines rather than giving up.
 *
 * Output goes to a log file because a menu entry has no terminal to print to,
 * and an error nobody can see is the failure this installer exists to prevent.
 */
const launcher = `#!/bin/sh
set -eu
APP="${home}/app"
LOG="${home}/betterslack.log"

NODE="$(cat "$APP/node-path" 2>/dev/null || true)"

if [ ! -x "$NODE" ] && [ -f "$APP/scripts/node-ok.cjs" ]; then
  for CANDIDATE in \\
    "${home}"/runtime/node/bin/node \\
    "$(command -v node 2>/dev/null || true)" \\
    "$HOME"/.nvm/versions/node/*/bin/node \\
    /usr/local/bin/node /usr/bin/node
  do
    if [ -x "$CANDIDATE" ] && "$CANDIDATE" "$APP/scripts/node-ok.cjs" >/dev/null 2>&1; then
      NODE="$CANDIDATE"
      printf '%s\\n' "$NODE" > "$APP/node-path"
      break
    fi
  done
fi

fail() {
  # A desktop launch has no terminal, so say it where somebody will see it --
  # and still print it, for the case where this was run from one.
  printf 'betterslack: %s\\n' "$1" >&2
  for TELL in notify-send zenity kdialog; do
    command -v "$TELL" >/dev/null 2>&1 || continue
    case "$TELL" in
      notify-send) notify-send "BetterSlack" "$1" ;;
      zenity)      zenity --error --text="$1" ;;
      kdialog)     kdialog --error "$1" ;;
    esac
    break
  done
  exit 1
}

[ -f "$APP/bin/betterslack.mjs" ] || fail "BetterSlack is not installed. Run ./install.sh from the repository."
[ -x "$NODE" ] || fail "No usable Node.js was found. Run ./install.sh again; it fetches one if this machine has none."

# Run in the foreground when there is a terminal, in the background when there
# is not: from a menu entry nothing waits for it, and a launcher that blocks
# would keep a desktop's "starting" cursor spinning until Slack is closed.
if [ -t 1 ]; then
  exec "$NODE" "$APP/bin/betterslack.mjs" "$@"
fi
exec "$NODE" "$APP/bin/betterslack.mjs" "$@" >>"$LOG" 2>&1
`;

/*
 * StartupNotify=false because the loader drives Slack rather than opening a
 * window of its own: with it on, the desktop waits for a window that never
 * arrives and shows a busy cursor for twenty seconds before giving up.
 */
const desktop = `[Desktop Entry]
Type=Application
Name=BetterSlack
GenericName=Slack with themes and plugins
Comment=Start Slack with your themes and plugins applied
Exec=${command}
Icon=betterslack
Terminal=false
StartupNotify=false
Categories=Network;InstantMessaging;
Keywords=slack;theme;plugin;mod;
`;

await fs.mkdir(binDir, { recursive: true });
await fs.mkdir(appsDir, { recursive: true });
await fs.mkdir(iconDir, { recursive: true });

await fs.writeFile(command, launcher, { mode: 0o755 });
await fs.writeFile(path.join(appsDir, 'betterslack.desktop'), desktop, 'utf8');
await fs
  .copyFile(path.join(root, 'assets', 'mark.svg'), path.join(iconDir, 'betterslack.svg'))
  .catch(() => console.warn('no assets/mark.svg, the menu entry will use a default icon'));

console.log(`installed ${command}`);
console.log(`installed ${path.join(appsDir, 'betterslack.desktop')}`);

/*
 * ~/.local/bin is on PATH by default on most distributions and on none of the
 * others, and "command not found" right after a successful install reads as a
 * broken install. Say it here rather than letting them find out.
 */
const onPath = (process.env.PATH ?? '').split(':').includes(binDir);
if (!onPath) {
  console.warn(
    `\n${binDir} is not on your PATH, so the betterslack command will not be found.`
    + '\nThe menu entry works either way. To get the command too, add this to your shell profile:'
    + `\n\n  export PATH="${binDir}:$PATH"`,
  );
}
