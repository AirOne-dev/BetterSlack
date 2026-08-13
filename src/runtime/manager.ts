// Runtime state: what is installed, what is on, and keeping the DOM in sync.

import {
  isGranted,
  type Event as PushEvent,
  type LoaderInfo,
  type ModRecord,
  type Permission,
  type Settings,
} from '../shared/protocol.js';
import { createPluginApi, type PluginApi } from './api.js';
import { createLayoutApi, scriptStyleId, type LayoutApi } from './layout-api.js';
import { PluginHost } from './plugins.js';
import type { Bridge } from './rpc.js';
import { StyleManager } from './themes.js';

export interface BootPayload {
  version: string;
  settings: Settings;
  mods: ModRecord[];
  sources: Record<string, string>;
  /** Companion scripts of themes that declare one, keyed by mod id. */
  scripts?: Record<string, string>;
  info: LoaderInfo;
}

export class ModManager {
  readonly styles = new StyleManager();
  private readonly plugins = new PluginHost<PluginApi>('plugin');
  // Separate host, so a theme script and a plugin can never collide on an id
  // and so switching a theme off tears down only its own script.
  private readonly themeScripts = new PluginHost<LayoutApi>('theme script');
  private settings: Settings;
  private mods: ModRecord[];
  private sources: Record<string, string>;
  private scripts: Record<string, string>;
  private listeners = new Set<() => void>();
  private headObserver?: MutationObserver;

  constructor(
    private readonly bridge: Bridge,
    private readonly boot: BootPayload,
  ) {
    this.settings = boot.settings;
    this.mods = boot.mods;
    this.sources = { ...boot.sources };
    this.scripts = { ...(boot.scripts ?? {}) };
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

  /** Permissions a mod asks for; empty for the overwhelming majority. */
  permissionsFor(id: string): Permission[] {
    return this.mods.find((m) => m.id === id)?.permissions ?? [];
  }

  /**
   * Whether everything this mod asks for has been granted. True for a mod that
   * asks for nothing, which is why callers can use it unconditionally.
   */
  isGranted(id: string): boolean {
    const record = this.mods.find((m) => m.id === id);
    return record ? isGranted(record, this.settings) : false;
  }

  /** Record the answer to a consent dialog, and apply the consequences now. */
  async grant(id: string, permissions: Permission[]): Promise<void> {
    this.settings = await this.bridge.request<Settings>({ type: 'mod.grant', id, permissions });
    // A theme already on screen must react to the answer immediately: newly
    // granted means its script should start, revoked means it should stop.
    const record = this.mods.find((m) => m.id === id);
    if (record && this.isEnabled(id)) {
      await this.unapply(record);
      const source = this.sources[id] ?? (await this.fetchSource(id).catch(() => null));
      if (source !== null) await this.apply(record, source).catch((err) => {
        console.error(`[slackmod] could not reapply "${id}" after a permission change:`, err);
      });
    }
    this.notify();
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
    await this.themeScripts.unloadAll();
    this.styles.clear();
  }

  private async apply(record: ModRecord, source: string): Promise<void> {
    if (record.type === 'theme') {
      this.styles.set('theme', record.id, source);
      await this.applyThemeScript(record);
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
    });
    await this.plugins.load(record, source, api);
  }

  /**
   * Load a theme's companion script, if it has one and may run it.
   *
   * The grant is checked here rather than where the script is fetched: the
   * loader ships the file with the rest of the theme, and having exactly one
   * place that decides whether it runs is what makes that safe to reason about.
   */
  private async applyThemeScript(record: ModRecord): Promise<void> {
    if (!record.script) return;
    if (!isGranted(record, this.settings)) {
      console.warn(
        `[slackmod] "${record.id}" ships a layout script but has not been granted ` +
          `${(record.permissions ?? []).join(', ')}; the stylesheet is applied on its own`,
      );
      return;
    }
    const source = this.scripts[record.id] ?? (await this.fetchScript(record.id).catch(() => null));
    if (source === null || source === undefined) return;
    const api = createLayoutApi(record, {
      styles: this.styles,
      granted: record.permissions ?? [],
    });
    await this.themeScripts.load(record, source, api).catch((err: Error) => {
      // A theme whose script fails is still a working theme. Say so and keep
      // the colours rather than throwing the whole thing away.
      console.error(`[slackmod] layout script of "${record.id}" failed: ${err.message}`);
    });
  }

  private async unapply(record: ModRecord): Promise<void> {
    if (record.type === 'theme') {
      this.styles.remove('theme', record.id);
      this.styles.remove('theme', scriptStyleId(record.id));
      await this.themeScripts.unload(record.id);
    } else {
      await this.plugins.unload(record.id);
    }
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

  private async fetchScript(id: string): Promise<string | null> {
    const script = await this.bridge.request<string | null>({ type: 'mod.script', id });
    if (typeof script === 'string') this.scripts[id] = script;
    return script;
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
      // A permission answered in another window changes what should be running
      // here too, without the enabled list moving at all.
      for (const record of this.mods) {
        if (!record.script || !this.isEnabled(record.id)) continue;
        const before = isGranted(record, previous);
        if (before === isGranted(record, event.settings)) continue;
        if (before) await this.themeScripts.unload(record.id);
        else await this.applyThemeScript(record);
      }
      this.notify();
      return;
    }
    if (event.type === 'mod.changed') {
      this.sources[event.id] = event.source;
      if (event.script !== undefined) this.scripts[event.id] = event.script;
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
