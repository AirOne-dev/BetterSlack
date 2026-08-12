// Plugin host.
//
// Slack's CSP has no 'unsafe-eval', so eval() and new Function() are dead ends
// inside the page -- verified against Slack 4.51: both throw
// "Evaluating a string as JavaScript violates the following Content Security
// Policy". `blob:` *is* listed in script-src though, so a plugin is turned into
// a blob URL and pulled in with a dynamic import(). That runs the plugin as a
// real ES module, with no string evaluation anywhere.

import type { ModRecord } from '../shared/protocol.js';
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
  blobUrl: string;
}

export class PluginHost {
  private loaded = new Map<string, LoadedPlugin>();

  isLoaded(id: string): boolean {
    return this.loaded.has(id);
  }

  loadedIds(): string[] {
    return [...this.loaded.keys()];
  }

  async load(record: ModRecord, source: string, api: PluginApi): Promise<void> {
    if (this.loaded.has(record.id)) await this.unload(record.id);

    const blobUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    let module: PluginModule;
    try {
      // Each load gets a fresh blob URL, which is also what makes hot reload
      // work: the module cache is keyed by URL.
      const namespace = (await import(/* @vite-ignore */ blobUrl)) as {
        default?: PluginModule;
      } & PluginModule;
      module = namespace.default ?? namespace;
    } catch (err) {
      URL.revokeObjectURL(blobUrl);
      throw new Error(`could not load plugin "${record.id}": ${(err as Error).message}`);
    }

    if (typeof module.start !== 'function') {
      URL.revokeObjectURL(blobUrl);
      throw new Error(`plugin "${record.id}" has no start() export`);
    }

    this.loaded.set(record.id, { record, module, api, blobUrl });
    try {
      await module.start(api);
    } catch (err) {
      this.loaded.delete(record.id);
      URL.revokeObjectURL(blobUrl);
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
      console.error(`[slackmod] plugin "${id}" threw during stop():`, err);
    }
    // Run whatever the plugin registered through the api, even if stop() failed
    // or never existed: a plugin that leaks observers degrades the whole app.
    plugin.api.__disposeAll();
    URL.revokeObjectURL(plugin.blobUrl);
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
          console.error('[slackmod] cleanup threw', err);
        }
      }
    },
  };
}
