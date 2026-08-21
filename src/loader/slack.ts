// Locating, stopping and starting the Slack desktop app.

import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { existsSync, promises as fsp } from 'node:fs';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
import path from 'node:path';
import { sleep } from './cdp.js';

const execFileAsync = promisify(execFile);

export class SlackNotFoundError extends Error {}

/**
 * Candidate install locations per platform, most likely first.
 * BETTERSLACK_SLACK_PATH overrides everything, which is also how users on exotic
 * installs (Nix, portable builds) get unblocked without patching this list.
 */
function candidatePaths(): string[] {
  const override = process.env.BETTERSLACK_SLACK_PATH;
  if (override) return [override];

  const home = homedir();
  switch (process.platform) {
    case 'darwin':
      return [
        '/Applications/Slack.app/Contents/MacOS/Slack',
        path.join(home, 'Applications/Slack.app/Contents/MacOS/Slack'),
      ];
    case 'win32': {
      const localAppData = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');
      const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
      return [
        path.join(localAppData, 'slack', 'slack.exe'),
        path.join(programFiles, 'Slack', 'slack.exe'),
      ];
    }
    default:
      return [
        '/usr/bin/slack',
        '/usr/lib/slack/slack',
        '/opt/slack/slack',
        '/snap/bin/slack',
        path.join(home, '.local/share/flatpak/exports/bin/com.slack.Slack'),
        '/var/lib/flatpak/exports/bin/com.slack.Slack',
      ];
  }
}

export function findSlack(): string {
  for (const candidate of candidatePaths()) {
    if (existsSync(candidate)) return candidate;
  }
  throw new SlackNotFoundError(
    `Could not find the Slack desktop app. Looked in:\n` +
      candidatePaths()
        .map((p) => `  - ${p}`)
        .join('\n') +
      `\n\nSet BETTERSLACK_SLACK_PATH to the executable if Slack lives elsewhere.`,
  );
}

/**
 * Which Slack this is, where that can be read honestly.
 *
 * Mods declare the Slack they were written against, and until now nothing
 * compared it -- the field was carried all the way into the registry and read
 * by no one. Comparing needs a number, and there is one on macOS and Windows:
 *
 * - macOS keeps it in the bundle's Info.plist, which is XML text, so it is
 *   read here rather than shelled out to PlistBuddy or `defaults`.
 * - Windows installs each version into its own `app-4.51.191` directory, and
 *   the executable's path therefore carries it.
 * - Linux packages it a dozen ways and none of them are on the executable's
 *   path, so this answers null.
 *
 * **Null must stay null.** An unknown version compared against anything invents
 * a mismatch, and a warning that fires on a machine where nothing is wrong is
 * worse than no warning at all: it teaches people to ignore the one that is
 * real. Every caller treats null as "say nothing".
 */
export async function slackVersion(slackPath: string): Promise<string | null> {
  if (process.platform === 'darwin') {
    // .../Slack.app/Contents/MacOS/Slack -> .../Slack.app/Contents/Info.plist
    const plist = path.resolve(path.dirname(slackPath), '..', 'Info.plist');
    const text = await fsp.readFile(plist, 'utf8').catch(() => null);
    const found = text?.match(
      /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/,
    );
    return found?.[1]?.trim() || null;
  }
  if (process.platform === 'win32') {
    return slackPath.match(/[\\/]app-(\d+(?:\.\d+)*)[\\/]/)?.[1] ?? null;
  }
  return null;
}

const PROCESS_NAME = process.platform === 'win32' ? 'slack.exe' : 'Slack';

export async function isSlackRunning(): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync('tasklist', ['/FI', `IMAGENAME eq ${PROCESS_NAME}`]);
      return stdout.toLowerCase().includes('slack.exe');
    }
    await execFileAsync('pgrep', ['-x', PROCESS_NAME]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Slack only opens a debugging port if the switch is present at launch, so an
 * already-running instance has to go. We ask politely, then insist.
 */
export async function stopSlack(timeoutMs = 8000): Promise<void> {
  if (!(await isSlackRunning())) return;

  const term = process.platform === 'win32'
    ? ['taskkill', ['/IM', PROCESS_NAME]]
    : ['pkill', ['-x', PROCESS_NAME]];
  await execFileAsync(term[0] as string, term[1] as string[]).catch(() => undefined);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isSlackRunning())) return;
    await sleep(200);
  }

  const force = process.platform === 'win32'
    ? ['taskkill', ['/IM', PROCESS_NAME, '/F']]
    : ['pkill', ['-9', '-x', PROCESS_NAME]];
  await execFileAsync(force[0] as string, force[1] as string[]).catch(() => undefined);
  await sleep(500);
}

export interface LaunchOptions {
  slackPath: string;
  /** Extra switches, e.g. --startup for a tray-only start. */
  extraArgs?: string[];
}

/**
 * Start Slack with the CDP pipe rather than a debugging port.
 *
 * fd 3 is the channel Chromium reads commands from, fd 4 the one it writes
 * events to. Nothing listens on the network, so unlike --remote-debugging-port
 * there is no local endpoint for another process to connect to.
 */
export function launchSlack({ slackPath, extraArgs = [] }: LaunchOptions): ChildProcess {
  const child = spawn(slackPath, ['--remote-debugging-pipe', ...extraArgs], {
    detached: false,
    // stdin, stdout, stderr, then the two CDP descriptors.
    stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });
  child.on('error', (err) => {
    console.error(`[betterslack] failed to start Slack: ${err.message}`);
  });
  return child;
}
