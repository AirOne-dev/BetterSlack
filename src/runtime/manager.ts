// Runtime state: what is installed, what is on, and keeping the DOM in sync.

import {
  missingRequirements,
  type Event as PushEvent,
  type LoaderInfo,
  type ModFiles,
  type ModRecord,
  type Settings,
  type UpdateStatus,
} from '../shared/protocol.js';
import { createPluginApi } from './api.js';
import { PluginHost } from './plugins.js';
import type { Bridge } from './rpc.js';
import { inlineCssImports, StyleManager } from './themes.js';

/** Slack's client shell. Present once the app has rendered, absent while it boots. */
const CLIENT_SELECTOR = '.p-client_container';
const CLIENT_TIMEOUT_MS = 20_000;

/**
 * Resolve once Slack has built its client, or after CLIENT_TIMEOUT_MS -- never
 * later. Written with one observer and one timer rather than polling, so it
 * costs nothing while it waits.
 */
function waitForClient(): Promise<void> {
  if (document.querySelector(CLIENT_SELECTOR)) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      observer.disconnect();
      clearTimeout(timer);
      resolve();
    };
    const observer = new MutationObserver(() => {
      if (document.querySelector(CLIENT_SELECTOR)) finish();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    const timer = setTimeout(() => {
      console.warn('[slackmod] Slack’s client never appeared; starting plugins anyway');
      finish();
    }, CLIENT_TIMEOUT_MS);
  });
}

export interface BootPayload {
  version: string;
  settings: Settings;
  mods: ModRecord[];
  sources: Record<string, ModFiles>;
  info: LoaderInfo;
  /** Absent when the loader's version check has not answered yet. */
  update?: UpdateStatus;
}

export class ModManager {
  readonly styles = new StyleManager();
  private readonly plugins = new PluginHost();
  private settings: Settings;
  private mods: ModRecord[];
  private sources: Record<string, ModFiles>;
  private listeners = new Set<() => void>();
  /** What the loader last said about this copy being current. */
  update: UpdateStatus | undefined;
  private headObserver?: MutationObserver;

  constructor(
    private readonly bridge: Bridge,
    private readonly boot: BootPayload,
  ) {
    this.settings = boot.settings;
    this.mods = boot.mods;
    this.sources = { ...boot.sources };
    this.update = boot.update;
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

  /** Pull, rebuild and restart. The window goes away with the loader. */
  updateApp(): Promise<{ ok: boolean; detail: string }> {
    return this.bridge.request<{ ok: boolean; detail: string }>({ type: 'app.update' });
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
    const enabled = this.settings.enabled
      .map((id) => ({ record: this.mods.find((m) => m.id === id), files: this.sources[id], id }));

    // Themes first, and without waiting for anything: they are CSS, and the
    // whole point of injecting at document-start is that Slack never flashes
    // its own colours before ours land.
    for (const { record, files, id } of enabled) {
      if (!record || files === undefined) {
        console.warn(`[slackmod] "${id}" is enabled but was not delivered by the loader`);
        continue;
      }
      if (record.type !== 'theme') continue;
      await this.apply(record, files).catch((err) => {
        console.error(`[slackmod] could not apply "${id}":`, err);
      });
    }

    /*
     * Plugins wait for Slack to have built its client.
     *
     * The runtime can be injected at any moment -- at document-start on a fresh
     * navigation, or straight into a page the loader found mid-boot. In that
     * second case the mods used to start against a half-built DOM: their mount
     * observers fire on every node Slack adds while it renders the client, and
     * a mount that reacts to Slack's own re-render can keep the microtask queue
     * from ever draining. The renderer then blocks outright -- a grey window,
     * no error, and Runtime.evaluate never returning, which is how this was
     * finally caught.
     *
     * Themes do not wait, because CSS cannot loop. If the container never
     * appears -- Slack renamed it, or this is not the client at all -- the
     * plugins still start, since refusing to load them would be a worse failure
     * than the one being avoided.
     */
    await waitForClient();

    for (const { record, files, id } of enabled) {
      if (!record || files === undefined || record.type === 'theme') continue;
      await this.apply(record, files).catch((err) => {
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

  private async apply(record: ModRecord, files: ModFiles): Promise<void> {
    if (record.type === 'theme') {
      // Relative @import has no base URL inside an injected <style>, so the
      // folder is stitched together before it reaches the page.
      this.styles.set('theme', record.id, inlineCssImports(files, record.entry));
      return;
    }
    const api = createPluginApi(record, {
      version: this.boot.version,
      files,
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
      listThemes: () =>
        this.mods
          .filter((m) => m.type === 'theme')
          .map((m) => ({
            id: m.id,
            name: m.name,
            description: m.description,
            enabled: this.isEnabled(m.id),
          })),
      themeSource: async (id) => {
        // One stylesheet, not a folder: a tool reading a theme wants what the
        // page would get, with its @imports already pasted in.
        const record = this.mods.find((m) => m.id === id);
        const files = this.sources[id] ?? (await this.fetchSource(id));
        return inlineCssImports(files, record?.entry ?? 'theme.css');
      },
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
          files: { 'theme.css': css },
        });
        this.notify();
      },
    });
    await this.plugins.load(record, files, api);
  }

  private async unapply(record: ModRecord): Promise<void> {
    if (record.type === 'theme') this.styles.remove('theme', record.id);
    else await this.plugins.unload(record.id);
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const record = this.mods.find((m) => m.id === id);
    if (!record) throw new Error(`unknown mod "${id}"`);

    if (enabled) {
      const files = this.sources[id] ?? (await this.fetchSource(id));
      await this.apply(record, files);
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
      const files = this.sources[id] ?? (await this.fetchSource(id).catch(() => null));
      if (files === null) continue;
      await this.apply(record, files).catch((err) => {
        console.error(`[slackmod] could not apply "${id}":`, err);
      });
    }
  }

  private async fetchSource(id: string): Promise<ModFiles> {
    const files = await this.bridge.request<ModFiles>({ type: 'mod.source', id });
    this.sources[id] = files;
    return files;
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

  async install(record: ModRecord, files: ModFiles): Promise<void> {
    const mods = await this.bridge.request<ModRecord[]>({
      type: 'mod.install',
      id: record.id,
      manifest: record,
      files,
    });
    this.sources[record.id] = files;
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
    if (event.type === 'update.status') {
      // It arrives after boot, because it went out on the network. Notifying
      // is what puts the badge on the button without anything polling for it.
      this.update = event.status;
      this.notify();
      return;
    }
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
      this.sources[event.id] = event.files;
      if (!this.isEnabled(event.id)) return;
      const record = this.mods.find((m) => m.id === event.id);
      if (!record) return;
      // Hot reload: tear the old one down before the new one goes in, or two
      // copies of the plugin end up fighting over the same DOM.
      await this.unapply(record);
      await this.apply(record, event.files).catch((err) => {
        console.error(`[slackmod] hot reload of "${event.id}" failed:`, err);
      });
      this.notify();
    }
  }
}
