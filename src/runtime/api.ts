// The object every plugin receives in start().
//
// Anything a plugin registers through this API is tracked and torn down when
// the plugin is disabled, so toggling a plugin off really does leave the DOM as
// it was found.

import type { ModRecord, Settings } from '../shared/protocol.js';
import { h, keepMounted, onEach, onShortcut, waitFor, type Cleanup } from './dom.js';
import { collectCleanups } from './plugins.js';
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

  /**
   * Evaluate an expression through the loader.
   *
   * Slack's CSP has no 'unsafe-eval', so the page cannot evaluate a string at
   * all; the loader's CDP session can. This is what a console mod needs, and
   * the only thing in the API that grants more reach than the page has.
   */
  readonly devtools: {
    evaluate(expression: string): Promise<{ value?: unknown; type?: string; error?: string }>;
  };

  /** Stylesheet owned by this plugin; replaced wholesale on each call. */
  css(text: string): void;

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
  evaluate: (expression: string) => Promise<{ value?: unknown; type?: string; error?: string }>;
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

    devtools: {
      evaluate: (expression) => ctx.evaluate(expression),
    },

    css(text: string) {
      ctx.styles.set('plugin', record.id, text);
      cleanups.add(() => ctx.styles.remove('plugin', record.id));
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
