// Runtime state: what is installed, what is on, and keeping the DOM in sync.

import {
  missingRequirements,
  type Event as PushEvent,
  type LoaderInfo,
  type ModRecord,
  type Settings,
} from '../shared/protocol.js';
import { createPluginApi } from './api.js';
import { PluginHost } from './plugins.js';
import type { Bridge } from './rpc.js';
import { StyleManager } from './themes.js';

export interface BootPayload {
  version: string;
  settings: Settings;
  mods: ModRecord[];
  sources: Record<string, string>;
  info: LoaderInfo;
}

export class ModManager {
  readonly styles = new StyleManager();
  private readonly plugins = new PluginHost();
  private settings: Settings;
  private mods: ModRecord[];
  private sources: Record<string, string>;
  private listeners = new Set<() => void>();
  private headObserver?: MutationObserver;

  constructor(
    private readonly bridge: Bridge,
    private readonly boot: BootPayload,
  ) {
    this.settings = boot.settings;
    this.mods = boot.mods;
    this.sources = { ...boot.sources };
    bridge.onEvent((event) => void this.onLoaderEvent(event));
  }

  get version(): string {
    return this.boot.version;
  }
  get info(): BootPayload['info'] {
    return this.boot.info;
  }
  getSettings(): Settings {
    return this.settings;
  }
  list(): ModRecord[] {
    return this.mods;
  }
  isEnabled(id: string): boolean {
    return this.settings.enabled.includes(id);
  }
  isInstalled(id: string): boolean {
    return this.settings.installed.includes(id);
  }

  /** Plugin ids a theme needs to look right; empty for almost every mod. */
  requirementsFor(id: string): string[] {
    return this.mods.find((m) => m.id === id)?.requires ?? [];
  }

  /** Of those, the ones that are not switched on right now. */
  missingRequirements(id: string): string[] {
    const record = this.mods.find((m) => m.id === id);
    return record ? missingRequirements(record, this.settings) : [];
  }

  /** Add a catalogue mod to the installed set, or remove it. */
  async setInstalled(id: string, installed: boolean): Promise<void> {
    if (!installed && this.isEnabled(id)) {
      const record = this.mods.find((m) => m.id === id);
      if (record) await this.unapply(record);
    }
    this.settings = await this.bridge.request<Settings>({
      type: 'mod.setInstalled',
      id,
      installed,
    });
    this.notify();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private notify(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (err) {
        console.error('[slackmod] change listener threw', err);
      }
    }
  }

  /** Apply everything that was already on when Slack started. */
  async applyInitial(): Promise<void> {
    for (const id of this.settings.enabled) {
      const record = this.mods.find((m) => m.id === id);
      const source = this.sources[id];
      if (!record || source === undefined) {
        console.warn(`[slackmod] "${id}" is enabled but was not delivered by the loader`);
        continue;
      }
      await this.apply(record, source).catch((err) => {
        console.error(`[slackmod] could not apply "${id}":`, err);
      });
    }
    this.applyCustomCss();

    // Slack rewrites <head> on some navigations; keep our layers attached.
    this.headObserver = new MutationObserver(() => this.styles.reattachOrphans());
    this.headObserver.observe(document.head, { childList: true });
  }

  /** Tear everything down, so a newer loader can inject a fresh runtime. */
  async dispose(): Promise<void> {
    this.headObserver?.disconnect();
    this.headObserver = undefined;
    this.listeners.clear();
    await this.plugins.unloadAll();
    this.styles.clear();
  }

  private async apply(record: ModRecord, source: string): Promise<void> {
    if (record.type === 'theme') {
      this.styles.set('theme', record.id, source);
      return;
    }
    const api = createPluginApi(record, {
      version: this.boot.version,
      styles: this.styles,
      getSettings: () => this.settings,
      saveModSettings: (id, values) =>
        this.patchSettings({ modSettings: { ...this.settings.modSettings, [id]: values } }),
      download: (url, filename) =>
        this.bridge.request<{ path: string; bytes: number }>({
          type: 'file.download',
          url,
          filename,
        }),
      saveTheme: async ({ id, name, description, css }) => {
        // Through the same route the Browse shelf uses, so the loader validates
        // the manifest it writes exactly as it would for anything installed.
        const manifest = {
          id,
          name,
          type: 'theme' as const,
          version: '1.0.0',
          author: 'you',
          description,
          entry: 'theme.css',
          slackmodApi: 1,
        };
        this.mods = await this.bridge.request<ModRecord[]>({
          type: 'mod.install',
          id,
          manifest,
          source: css,
        });
        this.notify();
      },
    });
    await this.plugins.load(record, source, api);
  }

  private async unapply(record: ModRecord): Promise<void> {
    if (record.type === 'theme') this.styles.remove('theme', record.id);
    else await this.plugins.unload(record.id);
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const record = this.mods.find((m) => m.id === id);
    if (!record) throw new Error(`unknown mod "${id}"`);

    if (enabled) {
      const source = this.sources[id] ?? (await this.fetchSource(id));
      await this.apply(record, source);
    } else {
      await this.unapply(record);
    }

    // Send the single flip, not the whole list: the loader owns the authoritative
    // copy, and another Slack window may have changed it since this one loaded.
    this.settings = await this.bridge.request<Settings>({ type: 'mod.enable', id, enabled });
    this.notify();
  }

  /** Apply or drop mods so this window matches `next`. */
  private async reconcile(previous: string[], next: string[]): Promise<void> {
    for (const id of previous.filter((x) => !next.includes(x))) {
      const record = this.mods.find((m) => m.id === id);
      if (record) await this.unapply(record);
    }
    for (const id of next.filter((x) => !previous.includes(x))) {
      const record = this.mods.find((m) => m.id === id);
      if (!record) continue;
      const source = this.sources[id] ?? (await this.fetchSource(id).catch(() => null));
      if (source === null) continue;
      await this.apply(record, source).catch((err) => {
        console.error(`[slackmod] could not apply "${id}":`, err);
      });
    }
  }

  private async fetchSource(id: string): Promise<string> {
    const source = await this.bridge.request<string>({ type: 'mod.source', id });
    this.sources[id] = source;
    return source;
  }

  async patchSettings(patch: Partial<Settings>): Promise<void> {
    this.settings = { ...this.settings, ...patch };
    this.notify();
    const saved = await this.bridge.request<Settings>({ type: 'settings.set', settings: patch });
    if (saved) this.settings = saved;
    this.notify();
  }

  applyCustomCss(): void {
    const css = this.settings.customCss.trim();
    if (css) this.styles.set('user', 'custom', css);
    else this.styles.remove('user', 'custom');
  }

  async setCustomCss(css: string): Promise<void> {
    await this.patchSettings({ customCss: css });
    this.applyCustomCss();
  }

  async install(record: ModRecord, source: string): Promise<void> {
    const mods = await this.bridge.request<ModRecord[]>({
      type: 'mod.install',
      id: record.id,
      manifest: record,
      source,
    });
    this.sources[record.id] = source;
    this.mods = mods;
    this.notify();
  }

  async uninstall(id: string): Promise<void> {
    if (this.isEnabled(id)) await this.setEnabled(id, false);
    this.mods = await this.bridge.request<ModRecord[]>({ type: 'mod.uninstall', id });
    delete this.sources[id];
    this.notify();
  }

  private async onLoaderEvent(event: PushEvent): Promise<void> {
    if (event.type === 'catalog.changed') {
      this.mods = event.mods;
      this.notify();
      return;
    }
    if (event.type === 'settings.changed') {
      // Another window changed something. Adopt the new list, then bring this
      // window's DOM in line with it.
      const previous = this.settings;
      this.settings = event.settings;
      await this.reconcile(previous.enabled, event.settings.enabled);
      this.notify();
      return;
    }
    if (event.type === 'mod.changed') {
      this.sources[event.id] = event.source;
      if (!this.isEnabled(event.id)) return;
      const record = this.mods.find((m) => m.id === event.id);
      if (!record) return;
      // Hot reload: tear the old one down before the new one goes in, or two
      // copies of the plugin end up fighting over the same DOM.
      await this.unapply(record);
      await this.apply(record, event.source).catch((err) => {
        console.error(`[slackmod] hot reload of "${event.id}" failed:`, err);
      });
      this.notify();
    }
  }
}
