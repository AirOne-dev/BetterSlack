// The object every plugin receives in start().
//
// Anything a plugin registers through this API is tracked and torn down when
// the plugin is disabled, so toggling a plugin off really does leave the DOM as
// it was found.

import type { ModRecord, Settings } from '../shared/protocol.js';
import { h, keepMounted, onEach, onShortcut, waitFor, type Cleanup } from './dom.js';
import { collectCleanups } from './plugins.js';
import { createHelpers, type Helpers } from './helpers.js';
import { createI18n, type I18n } from './i18n.js';
import { createSlackApi, type SlackApi } from './slack-api.js';
import type { StyleManager } from './themes.js';
import { attachTooltip, type TooltipOptions } from './ui/tooltip.js';
import {
  confirm,
  modal,
  toast,
  type ConfirmOptions,
  type ModalHandle,
  type ModalOptions,
  type ToastHandle,
  type ToastOptions,
} from './ui/widgets.js';

export interface PluginApi {
  readonly id: string;
  readonly manifest: ModRecord;
  readonly version: string;

  /** DOM helpers that are safe against Slack's re-renders. */
  readonly dom: {
    waitFor: typeof waitFor;
    keepMounted: (containerSelector: string, nodeId: string, factory: () => HTMLElement, position?: 'append' | 'prepend') => Cleanup;
    onEach: <T extends Element = Element>(selector: string, handler: (element: T) => void) => Cleanup;
    onShortcut: (match: (event: KeyboardEvent) => boolean, handler: (event: KeyboardEvent) => void) => Cleanup;
    h: typeof h;
  };

  /** Slack-aware helpers: toolbars, message actions, permalinks, the composer. */
  readonly slack: SlackApi;

  /**
   * The app's language, and translations for your own strings.
   *
   * Slack ships in many languages and an English-only mod stands out inside a
   * French client. `strings()` takes one object of dictionaries and returns a
   * lookup; English is required and is what a missing language or key falls
   * back to.
   */
  readonly i18n: I18n;

  /**
   * Higher-level shortcuts for the shapes most mods need: a persisted toggle,
   * a hotkey, a badge, a copy-and-confirm, Slack-styled buttons, fields and
   * sections. All of it is built on the rest of this API, and all of it is
   * torn down with the plugin.
   */
  readonly helpers: Helpers;

  /**
   * Ready-made widgets, so a mod never has to write its own CSS for common UI.
   * They live in shadow roots (a broken theme cannot make them unusable) and
   * read Slack's design tokens, so they follow the active theme.
   */
  readonly ui: {
    /** Transient message at the bottom of the window. */
    toast(message: string, options?: ToastOptions): ToastHandle;
    /** A dialog. Returns a handle so you can update or close it later. */
    modal(options: ModalOptions): ModalHandle;
    /** Yes/no dialog; resolves false if dismissed. */
    confirm(options: ConfirmOptions): Promise<boolean>;
    /** Slack-style tooltip on any element you built yourself. */
    tooltip(element: HTMLElement, options: TooltipOptions): Cleanup;
  };

  /**
   * Ask the loader to fetch a URL and save it to the download folder.
   * The renderer cannot do this itself for Slack's CDN, which serves without
   * CORS headers. https only; the file name is sanitised loader-side.
   */
  readonly files: {
    save(url: string, filename: string): Promise<{ path: string; bytes: number }>;
  };

  /** Stylesheet owned by this plugin; replaced wholesale on each call. */
  css(text: string): void;

  /**
   * Write a theme into the user's own mods folder, where it appears in the
   * panel like any other and survives a restart.
   *
   * Deliberately themes only. A theme is CSS and the loader re-validates the
   * manifest it is handed, so the worst a mod can do here is add an ugly
   * stylesheet the user can switch off -- which is not true of plugins, and is
   * why there is no equivalent for them.
   */
  saveTheme(options: { id: string; name: string; description: string; css: string }): Promise<void>;

  /**
   * The themes the user has, for tools that build on top of them.
   *
   * Read-only and themes-only: a plugin can see what stylesheets exist and read
   * one, which is what a theme editor needs and nothing more.
   */
  readonly themes: {
    list(): Array<{ id: string; name: string; description: string; enabled: boolean }>;
    source(id: string): Promise<string>;
  };

  /** Per-plugin persisted settings, stored by the loader in ~/.slackmod. */
  readonly settings: {
    get<T = unknown>(key: string, fallback?: T): T | undefined;
    set(key: string, value: unknown): Promise<void>;
    all(): Record<string, unknown>;
  };

  /** Register a teardown callback; runs when the plugin is disabled. */
  onDispose(fn: Cleanup): void;

  readonly log: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };

  /** @internal - used by the host, not by plugins. */
  __disposeAll(): void;
}

export interface ApiContext {
  version: string;
  styles: StyleManager;
  getSettings: () => Settings;
  saveModSettings: (id: string, values: Record<string, unknown>) => Promise<void>;
  download: (url: string, filename: string) => Promise<{ path: string; bytes: number }>;
  saveTheme: (options: { id: string; name: string; description: string; css: string }) => Promise<void>;
  listThemes: () => Array<{ id: string; name: string; description: string; enabled: boolean }>;
  themeSource: (id: string) => Promise<string>;
}

export function createPluginApi(record: ModRecord, ctx: ApiContext): PluginApi {
  const cleanups = collectCleanups();
  const prefix = `[slackmod:${record.id}]`;

  const track = <T extends (...args: never[]) => Cleanup>(fn: T): T =>
    ((...args: never[]) => {
      const cleanup = fn(...args);
      cleanups.add(cleanup);
      return cleanup;
    }) as T;

  const api: PluginApi = {
    id: record.id,
    manifest: record,
    version: ctx.version,

    dom: {
      waitFor,
      keepMounted: track(keepMounted),
      onEach: track(onEach) as PluginApi['dom']['onEach'],
      onShortcut: track(onShortcut),
      h,
    },

    slack: (() => {
      const slack = createSlackApi(record.id);
      return {
        ...slack,
        // Both install observers; tie them to the plugin lifecycle so disabling
        // the plugin really does remove its buttons.
        addMessageAction: track(slack.addMessageAction.bind(slack)),
        addToolbarButton: track(slack.addToolbarButton.bind(slack)) as SlackApi['addToolbarButton'],
        addProfileButton: track(slack.addProfileButton.bind(slack)),
        onProfilePane: track(slack.onProfilePane.bind(slack)),
      };
    })(),

    i18n: createI18n(),

    helpers: createHelpers({
      pluginId: record.id,
      css: (text) => api.css(text),
      toast: (message, options) => api.ui.toast(message, options),
      settings: {
        get: (key, fallback) => api.settings.get(key, fallback),
        set: (key, value) => api.settings.set(key, value),
      },
      track: (cleanup) => {
        cleanups.add(cleanup);
        return cleanup;
      },
    }),

    ui: {
      toast,
      // Modals and toasts are dismissed by the user, but a plugin disabled
      // while one is open should not leave it stranded on screen.
      modal: (modalOptions) => {
        const handle = modal(modalOptions);
        cleanups.add(() => handle.close());
        return handle;
      },
      confirm,
      tooltip: track(attachTooltip),
    },

    files: {
      save: (url, filename) => ctx.download(url, filename),
    },

    css(text: string) {
      ctx.styles.set('plugin', record.id, text);
      cleanups.add(() => ctx.styles.remove('plugin', record.id));
    },

    saveTheme: (options) => ctx.saveTheme(options),

    themes: {
      list: () => ctx.listThemes(),
      source: (id) => ctx.themeSource(id),
    },

    settings: {
      all: () => ctx.getSettings().modSettings[record.id] ?? {},
      get<T = unknown>(key: string, fallback?: T): T | undefined {
        const bag = ctx.getSettings().modSettings[record.id] ?? {};
        return (key in bag ? (bag[key] as T) : fallback);
      },
      async set(key: string, value: unknown) {
        const bag = { ...(ctx.getSettings().modSettings[record.id] ?? {}), [key]: value };
        await ctx.saveModSettings(record.id, bag);
      },
    },

    onDispose(fn: Cleanup) {
      cleanups.add(fn);
    },

    log: {
      info: (...args) => console.log(prefix, ...args),
      warn: (...args) => console.warn(prefix, ...args),
      error: (...args) => console.error(prefix, ...args),
    },

    __disposeAll: cleanups.disposeAll,
  };

  return api;
}
