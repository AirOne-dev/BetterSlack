// Locating, stopping and starting the Slack desktop app.

import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
import path from 'node:path';
import { sleep } from './cdp.js';

const execFileAsync = promisify(execFile);

export class SlackNotFoundError extends Error {}

/**
 * Candidate install locations per platform, most likely first.
 * SLACKMOD_SLACK_PATH overrides everything, which is also how users on exotic
 * installs (Nix, portable builds) get unblocked without patching this list.
 */
function candidatePaths(): string[] {
  const override = process.env.SLACKMOD_SLACK_PATH;
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
      `\n\nSet SLACKMOD_SLACK_PATH to the executable if Slack lives elsewhere.`,
  );
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
    console.error(`[slackmod] failed to start Slack: ${err.message}`);
  });
  return child;
}
