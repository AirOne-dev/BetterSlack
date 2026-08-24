// Plugin host.
//
// Slack's CSP has no 'unsafe-eval', so eval() and new Function() are dead ends
// inside the page -- verified against Slack 4.51: both throw
// "Evaluating a string as JavaScript violates the following Content Security
// Policy". `blob:` *is* listed in script-src though, so a plugin is turned into
// a blob URL and pulled in with a dynamic import(). That runs the plugin as a
// real ES module, with no string evaluation anywhere.

import type { ModFiles, ModRecord } from '../shared/protocol.js';
import { replaceOutsideComments, resolvePath } from './themes.js';
import type { PluginApi } from './api.js';
import type { Cleanup } from './dom.js';

export interface PluginModule {
  start?: (api: PluginApi) => void | Promise<void>;
  stop?: () => void | Promise<void>;
}

interface LoadedPlugin {
  record: ModRecord;
  module: PluginModule;
  api: PluginApi;
  /** Every blob made for this mod, entry and imports alike. */
  blobUrls: string[];
}

/**
 * Turn a mod's folder into one loadable module graph.
 *
 * A blob URL has no directory, so `import './colour.js'` inside one resolves to
 * `blob:https://app.slack.com/colour.js` and fails. The way through is to build
 * the graph leaves-first: every imported file becomes its own blob, and the
 * specifier in the importing source is rewritten to that blob's URL before it
 * is turned into a blob itself.
 *
 * Only relative specifiers are touched. A bare one ("lodash") is left as it is
 * and will fail loudly at import time, which is the correct outcome: a mod has
 * no package manager and never will.
 *
 * Returns the entry's URL plus every URL created, so they can all be revoked.
 */
export function buildModuleGraph(files: ModFiles, entry: string): { url: string; urls: string[] } {
  const built = new Map<string, string>();
  const urls: string[] = [];

  const build = (name: string, stack: string[]): string => {
    const existing = built.get(name);
    if (existing) return existing;
    if (stack.includes(name)) {
      throw new Error(`circular import: ${[...stack, name].join(' -> ')}`);
    }
    const source = files[name];
    if (source === undefined) {
      throw new Error(`"${name}" is imported but not in the mod folder`);
    }
    // `from './x.js'`, `import './x.js'` and `import('./x.js')`, static or not.
    // Comments are skipped: mods type their `api` parameter with a JSDoc
    // `{import('../../../src/runtime/api.js').PluginApi}`, which is not an
    // import at all and would otherwise fail the whole mod to load.
    const rewritten = replaceOutsideComments(
      source,
      /(\bfrom\s*|\bimport\s*\(?\s*)(['"])(\.[^'"]*)\2/g,
      ([, prefix, quote, spec]) => {
        const target = resolvePath(name, spec!);
        return `${prefix}${quote}${build(target, [...stack, name])}${quote}`;
      },
    );
    const url = URL.createObjectURL(new Blob([rewritten], { type: 'text/javascript' }));
    built.set(name, url);
    urls.push(url);
    return url;
  };

  const url = build(entry, []);
  return { url, urls };
}

export class PluginHost {
  private loaded = new Map<string, LoadedPlugin>();

  loadedIds(): string[] {
    return [...this.loaded.keys()];
  }

  async load(record: ModRecord, files: ModFiles, api: PluginApi): Promise<void> {
    if (this.loaded.has(record.id)) await this.unload(record.id);

    let graph: { url: string; urls: string[] };
    try {
      graph = buildModuleGraph(files, record.entry);
    } catch (err) {
      throw new Error(`could not load plugin "${record.id}": ${(err as Error).message}`);
    }
    const revoke = () => graph.urls.forEach((url) => URL.revokeObjectURL(url));

    let module: PluginModule;
    try {
      // Every load gets fresh blob URLs, which is also what makes hot reload
      // work: the module cache is keyed by URL.
      const namespace = (await import(/* @vite-ignore */ graph.url)) as {
        default?: PluginModule;
      } & PluginModule;
      module = namespace.default ?? namespace;
    } catch (err) {
      revoke();
      throw new Error(`could not load plugin "${record.id}": ${(err as Error).message}`);
    }

    if (typeof module.start !== 'function') {
      revoke();
      throw new Error(`plugin "${record.id}" has no start() export`);
    }

    this.loaded.set(record.id, { record, module, api, blobUrls: graph.urls });
    try {
      await module.start(api);
    } catch (err) {
      this.loaded.delete(record.id);
      revoke();
      throw new Error(`plugin "${record.id}" threw during start(): ${(err as Error).message}`);
    }
  }

  async unload(id: string): Promise<void> {
    const plugin = this.loaded.get(id);
    if (!plugin) return;
    this.loaded.delete(id);
    try {
      await plugin.module.stop?.();
    } catch (err) {
      console.error(`[betterslack] plugin "${id}" threw during stop():`, err);
    }
    // Run whatever the plugin registered through the api, even if stop() failed
    // or never existed: a plugin that leaks observers degrades the whole app.
    plugin.api.__disposeAll();
    for (const url of plugin.blobUrls) URL.revokeObjectURL(url);
  }

  async unloadAll(): Promise<void> {
    await Promise.all(this.loadedIds().map((id) => this.unload(id)));
  }
}

export function collectCleanups(): { add: (fn: Cleanup) => void; disposeAll: () => void } {
  const cleanups: Cleanup[] = [];
  return {
    add: (fn) => cleanups.push(fn),
    disposeAll: () => {
      while (cleanups.length > 0) {
        try {
          cleanups.pop()!();
        } catch (err) {
          console.error('[betterslack] cleanup threw', err);
        }
      }
    },
  };
}
