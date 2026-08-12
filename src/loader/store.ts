// Settings and installed mods on disk.
//
// Settings live outside the repo (~/.slackmod) so that pulling the repo never
// clobbers what the user has enabled, and so a mod author's working copy and
// their real config stay separate.

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { DEFAULT_SETTINGS, type Settings } from '../shared/protocol.js';

export const USER_ROOT = process.env.SLACKMOD_HOME ?? path.join(homedir(), '.slackmod');
export const USER_MODS_ROOT = path.join(USER_ROOT, 'mods');
const SETTINGS_FILE = path.join(USER_ROOT, 'settings.json');

export async function ensureUserRoot(): Promise<void> {
  await fs.mkdir(USER_MODS_ROOT, { recursive: true });
}

export async function readSettings(): Promise<Settings> {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<Settings>;
    // Merge rather than trust: a hand-edited or older file must not crash boot.
    return {
      enabled: Array.isArray(parsed.enabled) ? parsed.enabled.filter((x) => typeof x === 'string') : [],
      modSettings:
        parsed.modSettings && typeof parsed.modSettings === 'object' ? parsed.modSettings : {},
      customCss: typeof parsed.customCss === 'string' ? parsed.customCss : '',
      hotReload: typeof parsed.hotReload === 'boolean' ? parsed.hotReload : true,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[slackmod] settings unreadable, falling back to defaults: ${err}`);
    }
    return { ...DEFAULT_SETTINGS };
  }
}

export async function writeSettings(settings: Settings): Promise<void> {
  await ensureUserRoot();
  // Write-then-rename so a crash mid-write cannot leave a truncated file.
  const tmp = `${SETTINGS_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(settings, null, 2), 'utf8');
  await fs.rename(tmp, SETTINGS_FILE);
}

// Every mutation goes through one chain. Two Slack windows can flip switches at
// the same moment, and a read-modify-write that interleaves would silently drop
// one of the changes.
let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => undefined);
  return run;
}

export function mergeSettings(patch: Partial<Settings>): Promise<Settings> {
  return serialize(async () => {
    const current = await readSettings();
    const next: Settings = { ...current, ...patch };
    await writeSettings(next);
    return next;
  });
}

/**
 * Flip one mod on or off against the current on-disk list, rather than letting
 * a caller send a whole array computed from a snapshot it may have taken a
 * while ago.
 */
export function setModEnabled(id: string, enabled: boolean): Promise<Settings> {
  return serialize(async () => {
    const current = await readSettings();
    const next: Settings = {
      ...current,
      enabled: enabled
        ? [...new Set([...current.enabled, id])]
        : current.enabled.filter((x) => x !== id),
    };
    await writeSettings(next);
    return next;
  });
}
