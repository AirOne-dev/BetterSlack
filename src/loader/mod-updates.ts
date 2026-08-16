// Newer versions of individual mods, without updating the whole project.
//
// A mod carries its own version in mod.json, but until now the only way to get
// a newer one was to update BetterSlack itself: a one-line fix to a theme meant
// pulling the loader, the runtime and every other mod with it. That is backwards
// for the part of this repository that changes most often.
//
// So the catalogue is compared against the one published on the default branch,
// and a mod that has moved on can be replaced on its own. The files come down
// through the same install path the Browse shelf uses, which re-validates the
// manifest loader-side -- what arrives from the network is untrusted whichever
// button asked for it.

import type { ModFiles, ModManifest, ModRecord } from '../shared/protocol.js';

const HTTP_TIMEOUT_MS = 15_000;

/** What the registry file holds; only the fields this needs are described. */
interface RegistryEntry {
  id: string;
  type: 'theme' | 'plugin';
  version: string;
  path?: string;
}

export interface ModUpdate {
  id: string;
  name: string;
  /** What is installed now. */
  from: string;
  /** What the branch has. */
  to: string;
}

export interface RemoteSource {
  repo: string;
  branch: string;
}

function raw(source: RemoteSource, file: string): string {
  return `https://raw.githubusercontent.com/${source.repo}/${source.branch}/${file}`;
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/** `1.2.10` is newer than `1.2.9`; string order disagrees. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (value: string) => value.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const [a, b] = [parse(candidate), parse(current)];
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left !== right) return left > right;
  }
  return false;
}

/**
 * Which installed mods have a newer version published.
 *
 * Only installed ones: a catalogue entry nobody has is not an update, it is a
 * mod they have not chosen, and offering it here would turn a list of "things
 * that changed under you" into a second Browse shelf.
 */
export async function findModUpdates(
  installed: ModRecord[],
  source: RemoteSource,
): Promise<ModUpdate[]> {
  const registry = await getJson<{ mods?: RegistryEntry[] }>(raw(source, 'mods/registry.json'));
  if (!registry?.mods) return [];

  const published = new Map(registry.mods.map((entry) => [entry.id, entry]));
  const updates: ModUpdate[] = [];
  for (const mod of installed) {
    const entry = published.get(mod.id);
    if (!entry || !isNewerVersion(entry.version, mod.version)) continue;
    updates.push({ id: mod.id, name: mod.name, from: mod.version, to: entry.version });
  }
  return updates;
}

interface ContentEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  download_url: string | null;
}

/**
 * Every file of one mod, read from the branch.
 *
 * The folder is walked through GitHub's contents API rather than guessed from
 * the manifest: a mod is a folder now, and its entry file is only where the
 * runtime starts reading. Tests are skipped -- they run in Node against the
 * shared harness and would never load in the app anyway.
 */
export async function fetchModFiles(
  source: RemoteSource,
  folder: string,
): Promise<ModFiles | null> {
  const files: ModFiles = {};

  const walk = async (path: string, prefix: string): Promise<boolean> => {
    const listing = await getJson<ContentEntry[]>(
      `https://api.github.com/repos/${source.repo}/contents/${path}?ref=${source.branch}`,
    );
    if (!Array.isArray(listing)) return false;

    for (const entry of listing) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.type === 'dir') {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        if (!(await walk(entry.path, name))) return false;
        continue;
      }
      if (entry.name === 'test.mjs' || entry.name.endsWith('.test.mjs')) continue;
      if (!/\.(js|mjs|css|json)$/.test(entry.name) || !entry.download_url) continue;

      const response = await fetch(entry.download_url, {
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      }).catch(() => null);
      if (!response?.ok) return false;
      files[name] = await response.text();
    }
    return true;
  };

  if (!(await walk(folder, ''))) return null;
  return 'mod.json' in files ? files : null;
}

/**
 * The manifest out of the files just fetched.
 *
 * Read from what was downloaded rather than from the registry: the registry is
 * a summary, and the thing being installed should be described by itself.
 */
export function manifestFrom(files: ModFiles): ModManifest | null {
  try {
    return JSON.parse(files['mod.json'] ?? '') as ModManifest;
  } catch {
    return null;
  }
}

/** Where a mod's folder lives in the repository, for a given record. */
export function folderFor(mod: Pick<ModRecord, 'type' | 'id'>): string {
  return `mods/${mod.type === 'theme' ? 'themes' : 'plugins'}/${mod.id}`;
}
