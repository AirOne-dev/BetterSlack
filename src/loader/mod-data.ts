// A mod's own files on disk: what api.data reads and writes.
//
// settings.json is the wrong place for anything bigger than a preference. It
// is read whole at every launch and rewritten whole whenever any mod changes
// any setting, so a mod keeping a sound or a picture there would make every
// other mod's toggle rewrite megabytes. This is a folder per mod instead,
// beside the settings: ~/.betterslack/data/<mod id>/.
//
// Like download.ts it writes to disk on a mod's say-so, so everything below is
// a constraint a reviewer can check:
//
//   - one folder per mod, named by the mod's id, which the runtime supplies
//     rather than the mod -- a mod cannot name another's folder
//   - a file name reduced to a safe basename, so no path escapes the folder
//   - a cap per file and a cap per mod, so a mod cannot fill the disk
//
// Nothing here is removed when a mod is switched off or uninstalled. What a
// mod keeps is usually something the person made -- a sound they recorded, a
// note they wrote -- and losing it to a misclick in the panel is worse than a
// folder that outlives its mod.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { USER_ROOT } from './store.js';

const DATA_ROOT = path.join(USER_ROOT, 'data');

/** Big enough for a song-length sound or a photo; small enough for the bridge. */
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_MOD_BYTES = 64 * 1024 * 1024;

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,48}$/;

class ModDataError extends Error {}

export interface DataEntry {
  name: string;
  bytes: number;
  /** Last written, in milliseconds since the epoch. */
  modified: number;
}

/**
 * Reduce what a mod asked for to a plain file name, keeping its extension.
 *
 * The extension matters here more than in a download: it is how `read` knows
 * what kind of file it is handing back, which is what lets an <audio> play it.
 */
export function safeDataName(input: string): string {
  const base = path.basename(String(input ?? '').trim());
  const cleaned = base
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.\-]+/, '')
    .slice(0, 120);
  if (!cleaned) throw new ModDataError(`"${input}" is not a usable file name`);
  return cleaned;
}

function folderOf(id: string): string {
  if (!ID_PATTERN.test(id)) throw new ModDataError(`"${id}" is not a mod id`);
  return path.join(DATA_ROOT, id);
}

export async function listData(id: string): Promise<DataEntry[]> {
  const folder = folderOf(id);
  const names = await fs.readdir(folder).catch(() => [] as string[]);
  const entries: DataEntry[] = [];
  for (const name of names) {
    const stat = await fs.stat(path.join(folder, name)).catch(() => null);
    if (stat?.isFile()) entries.push({ name, bytes: stat.size, modified: stat.mtimeMs });
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/** Write a file, replacing one of the same name. Answers with the name it got. */
export async function writeData(id: string, name: string, base64: string): Promise<DataEntry> {
  const folder = folderOf(id);
  const safe = safeDataName(name);
  const bytes = Buffer.from(String(base64 ?? ''), 'base64');
  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new ModDataError(`a file may be at most ${MAX_FILE_BYTES / 1024 / 1024} MB`);
  }
  // The file being replaced does not count against the cap it is replacing.
  const others = (await listData(id)).filter((entry) => entry.name !== safe);
  const used = others.reduce((sum, entry) => sum + entry.bytes, 0);
  if (used + bytes.byteLength > MAX_MOD_BYTES) {
    throw new ModDataError(`a mod may keep at most ${MAX_MOD_BYTES / 1024 / 1024} MB`);
  }
  await fs.mkdir(folder, { recursive: true });
  const target = path.join(folder, safe);
  // Written beside and renamed over, so a crash mid-write never leaves half a
  // file under the real name.
  const temporary = `${target}.${process.pid}.partial`;
  await fs.writeFile(temporary, bytes);
  await fs.rename(temporary, target);
  const stat = await fs.stat(target);
  return { name: safe, bytes: stat.size, modified: stat.mtimeMs };
}

/** A file's bytes as base64, or null when there is no such file. */
export async function readData(id: string, name: string): Promise<string | null> {
  const target = path.join(folderOf(id), safeDataName(name));
  const bytes = await fs.readFile(target).catch(() => null);
  return bytes ? bytes.toString('base64') : null;
}

/** True when a file was there to remove. */
export async function removeData(id: string, name: string): Promise<boolean> {
  const target = path.join(folderOf(id), safeDataName(name));
  try {
    await fs.unlink(target);
    return true;
  } catch {
    return false;
  }
}
