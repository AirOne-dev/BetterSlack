// The icon Slack wears in the Dock while BetterSlack runs it -- and the one
// BetterSlack.app wears too.
//
// macOS only. A running app's Dock tile is drawn by the app, and nothing that
// reaches Slack can draw it differently: there is no setDockTile over CDP, the
// desktop bridge only bounces, and the main process cannot be opened. What does
// work, measured on Slack 4.51 / macOS 27, is a custom Finder icon on the
// bundle: the Dock reads it when Slack starts and keeps that tile for as long
// as Slack runs, even once the custom icon is taken off again. So it is put on
// just before Slack launches and taken off once it has started, which leaves
// Slack.app exactly as it was for the rest of the session -- a custom icon is a
// file in the bundle root, and `codesign --strict` calls that detritus.
//
// Writing into Slack.app is App Management (kTCCServiceSystemPolicyAppBundles),
// which BetterSlack only has if the user granted it in System Settings; without
// it tccd refuses and nothing changes. Every step here fails soft for that.
//
// The same icon goes on BetterSlack.app, whose own .icns is only rebuilt by
// install.sh: this is how an install updated from the panel gets it. Measured
// first that it costs nothing: with the custom icon on, a save into Downloads
// through BetterSlack's identity was still allowed.
//
// A theme brings its own icon by declaring it in its stylesheet:
//
//   :root { --betterslack-app-icon: url("data:image/svg+xml,..."); }
//
// In the stylesheet rather than as a file beside it, because a stylesheet is
// what every update path carries -- the panel's mod update fetches .css and
// leaves an .svg behind -- and a manifest key would be dropped by older
// loaders, which rewrite manifests with only the keys they know.

import { execFile } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import DEFAULT_ICON from '../../assets/app-icon.svg';
import { USER_ROOT } from './store.js';

const run = promisify(execFile);

export const DEFAULT_APP_ICON: string = DEFAULT_ICON;

const DECLARATION = /--betterslack-app-icon\s*:\s*url\(\s*(["'])(data:image\/svg\+xml[^"']*)\1\s*\)/i;

/** The SVG a stylesheet declares as the app icon, or null. */
export function iconFromCss(css: string): string | null {
  const match = DECLARATION.exec(css.replace(/\/\*[\s\S]*?\*\//g, ''));
  if (!match) return null;
  const uri = match[2]!;
  const comma = uri.indexOf(',');
  if (comma < 0) return null;
  const head = uri.slice(0, comma);
  const body = uri.slice(comma + 1);
  try {
    const svg = /;base64$/i.test(head)
      ? Buffer.from(body, 'base64').toString('utf8')
      : decodeURIComponent(body);
    return /<svg[\s>]/i.test(svg) ? svg : null;
  } catch {
    return null;
  }
}

/**
 * Which icon: the last switched-on theme that declares one, which is the theme
 * whose stylesheet wins in the client as well -- or BetterSlack's own.
 */
export function chooseIcon(themesInOrder: Array<{ css: string }>): string {
  for (const theme of [...themesInOrder].reverse()) {
    const icon = iconFromCss(theme.css);
    if (icon) return icon;
  }
  return DEFAULT_APP_ICON;
}

/** The .app around an executable path, or null. */
export function bundleOf(executable: string): string | null {
  const at = executable.indexOf('.app/');
  return at < 0 ? null : executable.slice(0, at + 4);
}

/** Where BetterSlack.app may be, newest location first. */
export function launcherBundles(): string[] {
  return ['/Applications/BetterSlack.app', path.join(homedir(), 'Applications', 'BetterSlack.app')]
    .filter((bundle) => existsSync(bundle));
}

/*
 * NSWorkspace does the work, through osascript, which every Mac has: it draws
 * an SVG without any rasteriser installed (NSImage reads SVG), and it writes
 * the icon the way Finder's Get Info does. No tool to ship, nothing to compile.
 */
const SET_ICON = `
ObjC.import('AppKit');
function run(argv) {
  const [file, bundle] = argv;
  const image = file ? $.NSImage.alloc.initWithContentsOfFile(file) : $();
  if (file && (image.isNil() || !image.isValid)) return 'unreadable';
  return $.NSWorkspace.sharedWorkspace.setIconForFileOptions(image, bundle, 0) ? 'ok' : 'refused';
}`;

async function setIcon(file: string | null, bundle: string): Promise<boolean> {
  if (process.platform !== 'darwin') return false;
  try {
    const { stdout } = await run('osascript', ['-l', 'JavaScript', '-e', SET_ICON, file ?? '', bundle], {
      timeout: 15_000,
    });
    return stdout.trim() === 'ok';
  } catch {
    return false;
  }
}

/** Put an SVG on each bundle as its icon. Answers which bundles took it. */
export async function applyIcon(svg: string, bundles: string[]): Promise<string[]> {
  if (process.platform !== 'darwin' || bundles.length === 0) return [];
  const dir = path.join(USER_ROOT, 'cache');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'app-icon.svg');
  await fs.writeFile(file, svg, 'utf8');
  const took: string[] = [];
  for (const bundle of bundles) if (await setIcon(file, bundle)) took.push(bundle);
  return took;
}

/** Take a custom icon off again, leaving the bundle as it shipped. */
export async function clearIcon(bundle: string): Promise<boolean> {
  return setIcon(null, bundle);
}
