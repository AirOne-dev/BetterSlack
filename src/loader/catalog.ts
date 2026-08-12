// Discovery and validation of mods on disk.
//
// Two roots are scanned: the repo's own mods/ folder (everything that went
// through a pull request review) and ~/.slackmod/mods (what the user installed
// or is writing themselves). Same layout in both:
//
//   <root>/<themes|plugins>/<id>/mod.json
//   <root>/<themes|plugins>/<id>/<entry file>

import { promises as fs, watch as fsWatch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { MOD_API_VERSION, type ModManifest, type ModRecord, type ModType } from '../shared/protocol.js';

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,48}$/;

export class ManifestError extends Error {
  constructor(public readonly file: string, message: string) {
    super(`${file}: ${message}`);
  }
}

function assertString(value: unknown, field: string, file: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ManifestError(file, `"${field}" must be a non-empty string`);
  }
  return value;
}

export function parseManifest(raw: string, file: string, expectedType: ModType): ModManifest {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new ManifestError(file, `invalid JSON (${(err as Error).message})`);
  }
  if (typeof data !== 'object' || data === null) throw new ManifestError(file, 'not an object');
  const m = data as Record<string, unknown>;

  const id = assertString(m.id, 'id', file);
  if (!ID_PATTERN.test(id)) {
    throw new ManifestError(file, `"id" must match ${ID_PATTERN} (got "${id}")`);
  }
  if (m.type !== expectedType) {
    throw new ManifestError(file, `"type" must be "${expectedType}" inside ${expectedType}s/`);
  }
  // Entries come from pull requests; refuse anything that could read outside
  // its own directory even if a review misses it.
  const assertContained = (value: string, field: string): string => {
    if (path.isAbsolute(value) || value.split(/[\\/]/).includes('..')) {
      throw new ManifestError(file, `"${field}" must stay inside the mod directory (got "${value}")`);
    }
    return value;
  };

  const entry = assertContained(assertString(m.entry, 'entry', file), 'entry');
  const expectedExt = expectedType === 'theme' ? '.css' : '.js';
  if (!entry.endsWith(expectedExt)) {
    throw new ManifestError(file, `"entry" must end in ${expectedExt} for a ${expectedType}`);
  }

  let requires: string[] | undefined;
  if (m.requires !== undefined) {
    if (!Array.isArray(m.requires)) throw new ManifestError(file, '"requires" must be an array');
    if (expectedType !== 'theme') {
      // Only themes may require. A plugin requiring a plugin would let two mods
      // depend on each other, and there is no case for it worth that.
      throw new ManifestError(file, '"requires" is for themes only');
    }
    for (const value of m.requires) {
      if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
        throw new ManifestError(file, `"requires" entries must be mod ids (got ${JSON.stringify(value)})`);
      }
      if (value === id) throw new ManifestError(file, 'a theme cannot require itself');
    }
    const unique = [...new Set(m.requires as string[])];
    requires = unique.length > 0 ? unique : undefined;
  }

  const api = typeof m.slackmodApi === 'number' ? m.slackmodApi : 0;
  if (api < 1) throw new ManifestError(file, '"slackmodApi" is missing or below 1');
  if (api > MOD_API_VERSION) {
    throw new ManifestError(
      file,
      `needs SlackMod API v${api} but this build speaks v${MOD_API_VERSION}`,
    );
  }

  return {
    id,
    name: assertString(m.name, 'name', file),
    type: expectedType,
    version: assertString(m.version, 'version', file),
    author: assertString(m.author, 'author', file),
    description: assertString(m.description, 'description', file),
    entry,
    requires,
    slackmodApi: api,
    slackVersion: typeof m.slackVersion === 'string' ? m.slackVersion : undefined,
    tags: Array.isArray(m.tags) ? m.tags.filter((t): t is string => typeof t === 'string') : undefined,
  };
}

export interface ScanResult {
  mods: ModRecord[];
  errors: string[];
}

async function scanKind(
  root: string,
  kind: ModType,
  origin: ModRecord['origin'],
  out: ScanResult,
): Promise<void> {
  const dir = path.join(root, `${kind}s`);
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return; // a missing themes/ or plugins/ folder is not an error
  }

  for (const dirent of entries) {
    if (!dirent.isDirectory()) continue;
    const manifestPath = path.join(dir, dirent.name, 'mod.json');
    try {
      const manifest = parseManifest(await fs.readFile(manifestPath, 'utf8'), manifestPath, kind);
      if (manifest.id !== dirent.name) {
        out.errors.push(`${manifestPath}: "id" ("${manifest.id}") must match the folder name ("${dirent.name}")`);
        continue;
      }
      // Fail here rather than at enable-time in the UI.
      await fs.access(path.join(dir, dirent.name, manifest.entry));
      out.mods.push({ ...manifest, origin, path: `${kind}s/${dirent.name}` });
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOENT' && e.path?.endsWith('mod.json')) continue; // not a mod folder
      out.errors.push(err instanceof ManifestError ? err.message : `${manifestPath}: ${e.message}`);
    }
  }
}

export async function scanRoot(root: string, origin: ModRecord['origin']): Promise<ScanResult> {
  const out: ScanResult = { mods: [], errors: [] };
  await scanKind(root, 'theme', origin, out);
  await scanKind(root, 'plugin', origin, out);
  return out;
}

export class Catalog {
  private records = new Map<string, { record: ModRecord; root: string }>();
  private watchers: FSWatcher[] = [];
  errors: string[] = [];

  constructor(
    private readonly builtinRoot: string,
    private readonly userRoot: string,
  ) {}

  async refresh(): Promise<ModRecord[]> {
    const builtin = await scanRoot(this.builtinRoot, 'builtin');
    const user = await scanRoot(this.userRoot, 'installed');
    this.errors = [...builtin.errors, ...user.errors];
    this.records.clear();
    // User copies shadow repo copies, so a contributor can iterate on a mod
    // that already shipped without editing the checked-in files.
    for (const record of builtin.mods) this.records.set(record.id, { record, root: this.builtinRoot });
    for (const record of user.mods) this.records.set(record.id, { record, root: this.userRoot });
    return this.list();
  }

  list(): ModRecord[] {
    return [...this.records.values()]
      .map((e) => e.record)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string): ModRecord | undefined {
    return this.records.get(id)?.record;
  }

  /** Absolute path of a mod's entry file, or undefined if unknown. */
  entryPath(id: string): string | undefined {
    const entry = this.records.get(id);
    if (!entry) return undefined;
    return path.join(entry.root, entry.record.path, entry.record.entry);
  }

  async readSource(id: string): Promise<string> {
    const file = this.entryPath(id);
    if (!file) throw new Error(`unknown mod "${id}"`);
    return fs.readFile(file, 'utf8');
  }

  /**
   * Watch both roots and report which mod ids changed. fs.watch is recursive on
   * macOS and Windows; on Linux it is not, so there we re-scan on any event at
   * the root level and accept the coarser granularity.
   */
  watch(onChange: (changedIds: string[]) => void): void {
    const debounce = new Map<string, NodeJS.Timeout>();
    const schedule = (key: string, fn: () => void) => {
      clearTimeout(debounce.get(key));
      debounce.set(key, setTimeout(fn, 150));
    };

    for (const root of [this.builtinRoot, this.userRoot]) {
      try {
        const watcher = fsWatch(root, { recursive: true }, (_event, filename) => {
          if (!filename) return;
          schedule(String(filename), async () => {
            const before = new Set(this.list().map((m) => m.id));
            await this.refresh();
            const after = this.list().map((m) => m.id);
            const parts = String(filename).split(/[\\/]/);
            // <kind>s/<id>/<file> -> the id is the second segment.
            const touched = parts.length >= 2 ? parts[1]! : '';
            const changed = new Set<string>();
            if (this.records.has(touched)) changed.add(touched);
            for (const id of after) if (!before.has(id)) changed.add(id);
            onChange([...changed]);
          });
        });
        this.watchers.push(watcher);
      } catch (err) {
        console.warn(`[slackmod] cannot watch ${root}: ${(err as Error).message}`);
      }
    }
  }

  dispose(): void {
    for (const w of this.watchers) w.close();
    this.watchers = [];
  }
}
