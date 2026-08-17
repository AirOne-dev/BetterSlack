#!/usr/bin/env node
// Builds dist/BetterSlack.app — a thin macOS wrapper that starts the loader
// without leaving a terminal window open.
//
// It is a launcher, not a bundle: it runs the loader from this checkout, so the
// repository has to stay where it is. That is a deliberate simplification over
// vendoring a Node runtime into the app.

import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

if (process.platform !== 'darwin') {
  console.error('build-app only works on macOS.');
  process.exit(1);
}

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

console.log(`built ${app}`);
console.log('Unsigned: the first launch needs right-click -> Open.');
console.log('Logs: ~/Library/Logs/BetterSlack.log');
