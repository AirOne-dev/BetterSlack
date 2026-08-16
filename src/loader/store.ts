// Settings and installed mods on disk.
//
// Settings live outside the repo (~/.betterslack) so that pulling the repo never
// clobbers what the user has enabled, and so a mod author's working copy and
// their real config stay separate.

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { DEFAULT_SETTINGS, type Settings } from '../shared/protocol.js';

export const USER_ROOT = process.env.BETTERSLACK_HOME ?? path.join(homedir(), '.betterslack');
export const USER_MODS_ROOT = path.join(USER_ROOT, 'mods');
const SETTINGS_FILE = path.join(USER_ROOT, 'settings.json');

/** Where this lived when the project was called SlackMod. */
const LEGACY_ROOT = path.join(homedir(), '.slackmod');

export async function ensureUserRoot(): Promise<void> {
  /*
   * Carry the old home over rather than starting empty.
   *
   * The rename moved this directory, and everything a person has -- which mods
   * they installed, which are on, their custom CSS, their own themes -- lives
   * in it. Coming back to an empty catalogue after an update would read as the
   * update having wiped them. Moved only when there is nothing at the new
   * place, so a second run cannot clobber real state with a stale copy.
   */
  if (!process.env.BETTERSLACK_HOME) {
    const arrived = await fs.stat(USER_ROOT).then(() => true).catch(() => false);
    const legacy = await fs.stat(LEGACY_ROOT).then(() => true).catch(() => false);
    if (!arrived && legacy) {
      await fs.rename(LEGACY_ROOT, USER_ROOT).catch(() => undefined);
      console.log(`[betterslack] moved ${LEGACY_ROOT} to ${USER_ROOT}`);
    }
  }
  await fs.mkdir(USER_MODS_ROOT, { recursive: true });
}

export async function readSettings(): Promise<Settings> {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<Settings>;
    // Merge rather than trust: a hand-edited or older file must not crash boot.
    const installed = Array.isArray(parsed.installed)
      ? parsed.installed.filter((x) => typeof x === 'string')
      : [];
    return {
      installed,
      // A mod can only be on if it is installed; a hand-edited file must not be
      // able to produce an enabled-but-not-installed state.
      enabled: (Array.isArray(parsed.enabled) ? parsed.enabled.filter((x) => typeof x === 'string') : [])
        .filter((id) => installed.includes(id)),
      modSettings:
        parsed.modSettings && typeof parsed.modSettings === 'object' ? parsed.modSettings : {},
      customCss: typeof parsed.customCss === 'string' ? parsed.customCss : '',
      hotReload: typeof parsed.hotReload === 'boolean' ? parsed.hotReload : true,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[betterslack] settings unreadable, falling back to defaults: ${err}`);
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
      // Enabling implies installing: the UI never offers one without the other.
      installed: enabled ? [...new Set([...current.installed, id])] : current.installed,
      enabled: enabled
        ? [...new Set([...current.enabled, id])]
        : current.enabled.filter((x) => x !== id),
    };
    await writeSettings(next);
    return next;
  });
}

/** Install or remove a catalogue mod. Removing also turns it off. */
export function setModInstalled(id: string, installed: boolean): Promise<Settings> {
  return serialize(async () => {
    const current = await readSettings();
    const next: Settings = {
      ...current,
      installed: installed
        ? [...new Set([...current.installed, id])]
        : current.installed.filter((x) => x !== id),
      enabled: installed ? current.enabled : current.enabled.filter((x) => x !== id),
    };
    await writeSettings(next);
    return next;
  });
}
