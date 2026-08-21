// Runtime state: what is installed, what is on, and keeping the DOM in sync.

import {
  missingRequirements,
  type Event as PushEvent,
  type LoaderInfo,
  type ModFiles,
  type ModRecord,
  type RemoteMod,
  type Settings,
  type ModUpdate,
  type UpdateStatus,
} from '../shared/protocol.js';
import { createPluginApi } from './api.js';
import { PluginHost } from './plugins.js';
import type { Bridge } from './rpc.js';
import { inlineCssImports, StyleManager } from './themes.js';
import type { Command as PaletteCommand } from './ui/palette.js';

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
    /*
     * `document` and not `document.documentElement`: at document-start, which
     * is when the runtime is injected on a fresh navigation, there is no
     * documentElement yet and `observe(null)` throws -- taking boot down and
     * leaving the loader's re-injection to do the work every time. Observing
     * the Document node sees `<html>` itself arrive.
     */
    observer.observe(document.documentElement ?? document, { childList: true, subtree: true });
    const timer = setTimeout(() => {
      console.warn('[betterslack] Slack’s client never appeared; starting plugins anyway');
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
  /** What the loader's first mod sweep found, if it had finished by then. */
  modUpdates?: ModUpdate[];
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
  /**
   * Installed mods with a newer version published.
   *
   * Held here rather than in the panel, which is where it used to live: the
   * launcher's badge counts these and the panel is usually shut, so state that
   * only exists once somebody has opened the panel is state the badge can never
   * read. The loader sweeps hourly and pushes the answer.
   */
  modUpdates: ModUpdate[] = [];
  /** Why a mod is not running, keyed by id. Cleared when it applies cleanly. */
  readonly errors = new Map<string, string>();

  /**
   * What each mod cost to start, in milliseconds.
   *
   * Not profiling for its own sake: "Slack feels slow since I turned things on"
   * is unanswerable without it, and the answer is usually one mod.
   */
  readonly timings = new Map<string, number>();

  /**
   * Set by the runtime once the panel exists.
   *
   * The manager is built before the panel is, and a mod asking to open it
   * should not have to know that.
   */
  openPanel?: (tab?: 'themes' | 'plugins' | 'css' | 'about') => void;
  /** Set by the runtime: open the panel on one mod, settings unfolded. */
  openMod?: (id: string) => void;

  /** Everything a mod said it can do, for the palette. */
  readonly commands = new Map<string, PaletteCommand>();

  /** Plugins that asked to hear about their own settings changing. */
  private settingsListeners = new Map<string, Set<(values: Record<string, unknown>) => void>>();
  private headObserver?: MutationObserver;

  constructor(
    private readonly bridge: Bridge,
    private readonly boot: BootPayload,
  ) {
    this.settings = boot.settings;
    this.mods = boot.mods;
    this.sources = { ...boot.sources };
    this.update = boot.update;
    this.modUpdates = boot.modUpdates ?? [];
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

  /**
   * Write a mod's settings and let it know.
   *
   * A plugin that registered `settings.onChange` is told and left running --
   * for the ones where reloading would be visible. Everything else is reloaded,
   * so `start` simply runs again with the new values and no mod has to do
   * anything to respect a setting.
   */
  async setModSetting(id: string, key: string, value: unknown): Promise<void> {
    const bag = { ...(this.settings.modSettings[id] ?? {}), [key]: value };
    await this.patchSettings({ modSettings: { ...this.settings.modSettings, [id]: bag } });

    const listeners = this.settingsListeners.get(id);
    if (listeners?.size) {
      for (const listener of [...listeners]) {
        try {
          listener(bag);
        } catch (err) {
          console.error(`[betterslack] "${id}" threw handling a settings change`, err);
        }
      }
      this.notify();
      return;
    }

    const record = this.mods.find((m) => m.id === id);
    if (record?.type === 'theme') {
      // Repainted rather than reloaded: the stylesheet has not changed, only
      // the handful of properties on top of it, and rewriting those is instant
      // where re-applying a theme is a flash of the whole client.
      if (this.isEnabled(id)) this.applyThemeVars(record);
      this.notify();
      return;
    }
    if (!record || record.type !== 'plugin' || !this.isEnabled(id)) {
      this.notify();
      return;
    }
    const files = this.sources[id] ?? (await this.fetchSource(id));
    await this.unapply(record);
    await this.apply(record, files).catch((err) => {
      console.error(`[betterslack] could not reapply "${id}":`, err);
    });
    this.notify();
  }

  /**
   * One file out of a mod's folder, as a data URL.
   *
   * For the screenshots a mod's page shows. Asked for one at a time and only
   * once somebody opens that page: a catalogue that carried every picture
   * would be a megabyte before anybody looked at anything.
   */
  asset(id: string, file: string): Promise<string | null> {
    return this.bridge.request<string | null>({ type: 'mods.asset', id, file });
  }

  /** Read a mod from a URL without installing it, so the user can be asked. */
  inspectRemote(url: string): Promise<RemoteMod | { error: string }> {
    return this.bridge.request<RemoteMod | { error: string }>({ type: 'mods.inspectRemote', url });
  }

  /** Install one that was inspected and consented to. */
  async installRemote(remote: RemoteMod): Promise<void> {
    this.mods = await this.bridge.request<ModRecord[]>({
      type: 'mod.install',
      id: remote.manifest.id,
      manifest: remote.manifest,
      files: remote.files,
      source: `${remote.repo}${remote.folder ? `/${remote.folder}` : ''}`,
    });
    await this.setInstalled(remote.manifest.id, true);
    this.notify();
  }

  /** Everything in ~/.betterslack worth keeping, as one JSON document. */
  exportBackup(): Promise<string> {
    return this.bridge.request<string>({ type: 'backup.export' });
  }

  /** Put one back, then adopt whatever the loader says the state is now. */
  importBackup(archive: string): Promise<{ ok: boolean; detail: string }> {
    return this.bridge.request<{ ok: boolean; detail: string }>({ type: 'backup.import', archive });
  }

  /** Installed mods with a newer version published, or an empty list. */
  async refreshModUpdates(): Promise<ModUpdate[]> {
    const updates = await this.bridge
      .request<ModUpdate[]>({ type: 'mods.checkUpdates' })
      .catch(() => null);
    // Null is "the loader could not say", which is not the same as "there are
    // none": keeping what is known beats clearing a badge on a failed request.
    if (updates === null) return this.modUpdates;
    this.modUpdates = updates;
    this.notify();
    return updates;
  }

  /**
   * Replace one mod with the published version.
   *
   * Reapplied straight away when it is on, so an update is visible without a
   * restart -- which is the point of updating a mod on its own.
   */
  async updateMod(id: string): Promise<{ ok: boolean; detail: string }> {
    const result = await this.bridge.request<{ ok: boolean; detail: string }>({
      type: 'mods.update',
      id,
    });
    if (!result.ok) return result;

    // Its own badge, cleared by the thing that cleared its cause. Waiting for
    // the next hourly sweep would leave a dot on a mod that is already current.
    this.modUpdates = this.modUpdates.filter((update) => update.id !== id);
    delete this.sources[id];
    const record = this.mods.find((mod) => mod.id === id);
    if (record && this.isEnabled(id)) {
      const files = await this.fetchSource(id);
      await this.unapply(record);
      await this.applyWatched(record, files);
    }
    this.notify();
    return result;
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
        console.error('[betterslack] change listener threw', err);
      }
    }
  }

  /** Plugin ids the host has actually loaded. */
  loadedPluginIds(): string[] {
    return this.plugins.loadedIds();
  }

  get safeMode(): boolean {
    return this.boot.info.safeMode === true;
  }

  /** Apply everything that was already on when Slack started. */
  /**
   * @param onProgress Told what is being applied, for the start screen. Called
   * with the mod's name before it is started, so a mod that never returns is
   * the one still on screen -- which is the difference between "it is slow" and
   * "it is stuck, and it is that one".
   */
  async applyInitial(onProgress?: (name: string, done: number, total: number) => void): Promise<void> {
    if (this.safeMode) {
      // Nothing is applied, and nothing is written: safe mode is a way to get
      // to the panel, not a decision about what should be on.
      console.warn('[betterslack] safe mode — no mods applied');
      return;
    }

    const enabled = this.settings.enabled
      .map((id) => ({ record: this.mods.find((m) => m.id === id), files: this.sources[id], id }));
    const total = enabled.length;
    let done = 0;
    const announce = (record: ModRecord | undefined, id: string) => {
      onProgress?.(record?.name ?? id, done, total);
    };

    // Themes first, and without waiting for anything: they are CSS, and the
    // whole point of injecting at document-start is that Slack never flashes
    // its own colours before ours land.
    for (const { record, files, id } of enabled) {
      if (!record || files === undefined) {
        console.warn(`[betterslack] "${id}" is enabled but was not delivered by the loader`);
        continue;
      }
      if (record.type !== 'theme') continue;
      announce(record, id);
      await this.applyWatched(record, files);
      done += 1;
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
    // The client can take seconds to build, and the start screen should not sit
    // on the name of the last theme while it does.
    onProgress?.('', done, total);
    await waitForClient();

    /*
     * Watching <head> before the plugins run, not after.
     *
     * Slack rewrites <head> while it builds the client, which is exactly when
     * the plugins are starting and writing their stylesheets. With the observer
     * installed afterwards, anything detached in that window stayed detached
     * until the next rewrite -- a mod on screen with none of its own CSS.
     */
    this.headObserver = new MutationObserver(() => this.styles.reattachOrphans());
    this.headObserver.observe(document.head, { childList: true });

    for (const { record, files, id } of enabled) {
      if (!record || files === undefined || record.type === 'theme') continue;
      announce(record, id);
      await this.applyWatched(record, files);
      done += 1;
    }
    this.applyCustomCss();
    onProgress?.('', total, total);
  }

  /** Tear everything down, so a newer loader can inject a fresh runtime. */
  async dispose(): Promise<void> {
    this.headObserver?.disconnect();
    this.headObserver = undefined;
    this.listeners.clear();
    await this.plugins.unloadAll();
    this.styles.clear();
  }

  /**
   * Apply a mod, and remember it if it will not.
   *
   * A mod that throws used to leave a line in the console and a row in the
   * panel that still said it was on. Now the row says what happened, and the
   * second consecutive failure at startup takes it out of the running: a broken
   * mod should cost one bad start, not every start.
   */
  private async applyWatched(record: ModRecord, files: ModFiles): Promise<void> {
    const failures = this.settings.modFailures ?? {};
    const failed = failures[record.id] ?? 0;
    if (failed >= 2) {
      this.errors.set(
        record.id,
        `skipped after ${failed} failed starts — switch it off and on to try again`,
      );
      console.warn(`[betterslack] skipping "${record.id}": it failed ${failed} times`);
      return;
    }

    // Counted before the attempt, cleared after it: a mod that takes the
    // renderer down never gets to the line that would have recorded it.
    await this.recordFailure(record.id, failed + 1);
    const started = Date.now();
    try {
      await this.apply(record, files);
      this.timings.set(record.id, Date.now() - started);
      this.errors.delete(record.id);
      await this.recordFailure(record.id, 0);
    } catch (err) {
      const message = (err as Error).message;
      this.errors.set(record.id, message);
      console.error(`[betterslack] could not apply "${record.id}":`, err);
    }
  }

  private async recordFailure(id: string, count: number): Promise<void> {
    const failures = { ...(this.settings.modFailures ?? {}) };
    if (count === 0) {
      if (!(id in failures)) return;
      delete failures[id];
    } else {
      if (failures[id] === count) return;
      failures[id] = count;
    }
    await this.patchSettings({ modFailures: failures });
  }

  /**
   * A theme's settings, as the custom properties it named.
   *
   * This is the whole of how a theme has settings. It runs no code -- that is
   * the rule, and a `script` field was built once and taken out for being a
   * second, weaker plugin model -- so it declares which property each setting
   * writes and the runtime writes it. Only fields carrying `cssVar` produce
   * anything; the rest are stored and ignored, which is what a theme's author
   * asked for by not naming a property.
   *
   * A layer of its own, created after the theme's, so it lands after it in
   * `<head>` and the value wins on order rather than on specificity.
   */
  private applyThemeVars(record: ModRecord): void {
    const fields = (record.settings ?? []).filter((field) => 'cssVar' in field && field.cssVar);
    if (fields.length === 0) return;

    const values = this.settings.modSettings[record.id] ?? {};
    const declarations = fields
      .map((field) => {
        const value = field.key in values ? values[field.key] : field.default;
        // An unset setting is not a value: writing `--x: undefined` would break
        // the theme's own declaration rather than leave it alone.
        if (value === undefined || value === null || value === '') return null;
        // Only what a colour or a length can be. The panel writes these, but a
        // hand-edited settings file is still a file somebody can put anything
        // in, and this ends up inside a stylesheet.
        const text = String(value);
        if (/[;{}<>]/.test(text)) return null;

        const name = (field as { cssVar: string }).cssVar;
        const lines = [`  ${name}: ${text};`];
        /*
         * And the same colour as a bare `r, g, b` triplet, under `<name>-rgb`.
         *
         * Two of Slack's four token families take triplets rather than
         * colours: `--sk_*` and `--dt_color-plt-*`. A `var()` holding a hex
         * parses there, paints nothing and reports nothing -- so without this a
         * colour chosen in the panel would reach the modern tokens and silently
         * skip the legacy ones, which is a theme half-repainted and no error to
         * explain it. Themes that use neither simply never reference it.
         */
        const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim());
        if (hex) {
          const digits = hex[1]!.length === 3
            ? hex[1]!.split('').map((d) => d + d).join('')
            : hex[1]!;
          const rgb = [0, 2, 4].map((at) => parseInt(digits.slice(at, at + 2), 16));
          lines.push(`  ${name}-rgb: ${rgb.join(', ')};`);
        }
        return lines.join('\n');
      })
      .filter(Boolean);

    this.styles.set('theme', `${record.id}:vars`, declarations.length
      ? `:root, .sk-client-theme--light, .sk-client-theme--dark {\n${declarations.join('\n')}\n}`
      : '');
  }

  private async apply(record: ModRecord, files: ModFiles): Promise<void> {
    if (record.type === 'theme') {
      // Relative @import has no base URL inside an injected <style>, so the
      // folder is stitched together before it reaches the page.
      this.styles.set('theme', record.id, inlineCssImports(files, record.entry));
      this.applyThemeVars(record);
      return;
    }
    const api = createPluginApi(record, {
      version: this.boot.version,
      files,
      styles: this.styles,
      getSettings: () => this.settings,
      saveModSettings: (id, values) =>
        this.patchSettings({ modSettings: { ...this.settings.modSettings, [id]: values } }),
      // Stored here; the loader writes it into Slack's own settings before the
      // next launch, because the window's material is chosen when the window
      // is created and there is no way to change it afterwards.
      setSlackPrefs: (values) => this.patchSettings({ slackPrefs: values }),
      slackPrefsAtLaunch: this.boot.info.slackPrefsAtLaunch ?? {},
      // What the file says now is what the loader last wrote plus whatever
      // Slack had; the settings BetterSlack keeps are the part it owns, and
      // the launch snapshot is the rest.
      slackPrefsNow: () => ({ ...this.boot.info.slackPrefsAtLaunch, ...this.settings.slackPrefs }),
      restartSlack: async () => {
        await this.bridge.request({ type: 'slack.restart' });
      },
      listCommands: () => [...this.commands.values()],
      listMods: () => this.mods.map((mod) => ({
        id: mod.id,
        name: mod.name,
        description: mod.description,
        type: mod.type,
        installed: this.isInstalled(mod.id),
        enabled: this.isEnabled(mod.id),
        settings: mod.settings?.length ?? 0,
      })),
      setModEnabled: (id, enabled) => this.setEnabled(id, enabled),
      setModInstalled: (id, installed) => this.setInstalled(id, installed),
      openPanel: (tab) => this.openPanel?.(tab),
      openMod: (id) => this.openMod?.(id),
      addCommand: (command) => {
        this.commands.set(command.id, command);
        return () => this.commands.delete(command.id);
      },
      onSettingsChanged: (id, handler) => {
        let set = this.settingsListeners.get(id);
        if (!set) this.settingsListeners.set(id, (set = new Set()));
        set.add(handler);
        return () => set!.delete(handler);
      },
      screenshot: ({ size, filename }) =>
        this.bridge.request<{ path: string; bytes: number }>({
          type: 'app.screenshot',
          size,
          filename,
        }),
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
          betterslackApi: 1,
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
    if (record.type === 'theme') {
      this.styles.remove('theme', record.id);
      // Its variables go with it. Left behind they would keep painting a theme
      // that is no longer on -- and win over the next one, since they are
      // written after every theme's own stylesheet.
      this.styles.remove('theme', `${record.id}:vars`);
      return;
    }
    await this.plugins.unload(record.id);
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const record = this.mods.find((m) => m.id === id);
    if (!record) throw new Error(`unknown mod "${id}"`);

    if (enabled) {
      const files = this.sources[id] ?? (await this.fetchSource(id));
      // Switching a mod on by hand is the retry the panel offers a skipped one,
      // so the count goes back to zero first -- otherwise "switch it off and on
      // to try again" would be advice that does not work.
      await this.recordFailure(id, 0);
      this.errors.delete(id);
      await this.applyWatched(record, files);
      const failure = this.errors.get(id);
      // Thrown rather than swallowed: this one was asked for, so the panel
      // should say it did not work rather than quietly showing it as on.
      if (failure) throw new Error(failure);
    } else {
      this.errors.delete(id);
      await this.recordFailure(id, 0);
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
        console.error(`[betterslack] could not apply "${id}":`, err);
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
    if (event.type === 'mods.updates') {
      this.modUpdates = event.updates;
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
        console.error(`[betterslack] hot reload of "${event.id}" failed:`, err);
      });
      this.notify();
    }
  }
}
