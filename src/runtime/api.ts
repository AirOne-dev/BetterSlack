// The object every plugin receives in start().
//
// Anything a plugin registers through this API is tracked and torn down when
// the plugin is disabled, so toggling a plugin off really does leave the DOM as
// it was found.

import { SLACK_PREFS, type ModFiles, type ModRecord, type Settings } from '../shared/protocol.js';
import { h, keepMounted, onEach, onShortcut, waitFor, type Cleanup } from './dom.js';
import { collectCleanups } from './plugins.js';
import { createHelpers, type Helpers } from './helpers.js';
import { createI18n, type I18n } from './i18n.js';
import { createSlackApi, type SlackApi } from './slack-api.js';
import type { StyleManager } from './themes.js';
import { attachTooltip, type TooltipOptions } from './ui/tooltip.js';
import { createKit, type Kit } from './ui/kit.js';
import { openMenu, type MenuItem, type MenuOptions } from './ui/menu.js';
import {
  openPalette,
  type Command,
  type PaletteHandle,
  type PaletteLabels,
  type PaletteSource,
} from './ui/palette.js';
import { KIT_CSS } from './ui/kit-css.js';
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

    /**
     * Slack's overflow menu, against an anchor you give it.
     *
     * Borrowed rather than drawn: it wears `c-menu`, so it follows every theme,
     * including one being edited. One menu is open at a time, Escape and a
     * click outside close it, and it flips above the anchor when there is no
     * room below -- which is always, for a button in the control strip.
     */
    menu(anchor: HTMLElement, items: MenuItem[], options?: MenuOptions): Cleanup;

    /**
     * Slack's design system, as components, bound to a document.
     *
     * Inside the client, Slack's own classes are the right answer -- the Mods
     * panel wears `.c-dialog` and follows every theme for free. They are not
     * available anywhere else: a mod that opens a window of its own gets a
     * blank document with no stylesheet in it. This is that gap filled once,
     * rather than once per mod.
     *
     *   const kit = api.ui.kit(childWindow.document);
     *   style.textContent = api.ui.kitCss;
     *   kit.card('Palette', [kit.button('Save', { variant: 'primary' })]);
     *
     * Everything is prefixed `sm-`, so the stylesheet is safe to inject into
     * the client itself.
     */
    kit(doc?: Document): Kit;

    /** The kit's stylesheet. Put it in the document the kit is building in. */
    readonly kitCss: string;

    /**
     * The command palette, as a component.
     *
     * The list is yours: this draws it, ranks it as you type, moves with the
     * arrow keys and closes on Escape. Nothing about what belongs in it is
     * decided here -- the mod that opens it decides, which is what lets one
     * plugin put Slack's own conversations and BetterSlack's actions in the
     * same list.
     */
    palette(source: PaletteSource, labels: PaletteLabels): PaletteHandle;
  };

  /**
   * BetterSlack itself, for the mods that extend it rather than Slack.
   *
   * Deliberately small and deliberately here: a mod that wants to list the
   * catalogue or open the panel should not be reaching into `window` for it.
   */
  readonly app: {
    /** Every mod in the catalogue, with what the user has done about it. */
    mods(): Array<{
      id: string;
      name: string;
      description: string;
      type: 'theme' | 'plugin';
      installed: boolean;
      enabled: boolean;
      /**
       * How many settings it declares in its manifest -- 0 for a mod there is
       * nothing to configure. Offering "Configure" for one of those is how a
       * list of actions stops meaning anything.
       */
      settings: number;
    }>;
    setEnabled(id: string, enabled: boolean): Promise<void>;
    setInstalled(id: string, installed: boolean): Promise<void>;
    /** Open the Mods panel, optionally straight to a tab. */
    openPanel(tab?: 'themes' | 'plugins' | 'css' | 'about'): void;
    /**
     * Open the panel on one mod, with its settings unfolded.
     *
     * The panel is where a setting is drawn from the manifest, checked and
     * saved; this points at the mod's own page there -- description, picture,
     * readme, settings -- rather than reimplementing any of it somewhere with
     * less room.
     */
    openMod(id: string): void;
    /** What every other mod has registered, so a palette can show them all. */
    commands(): Command[];
  };

  /**
   * Ask the loader to fetch a URL and save it to the download folder.
   * The renderer cannot do this itself for Slack's CDN, which serves without
   * CORS headers. https only; the file name is sanitised loader-side.
   */
  readonly files: {
    save(url: string, filename: string): Promise<{ path: string; bytes: number }>;
    /**
     * Photograph the Slack window and put the picture in the download folder.
     *
     * A page cannot photograph itself, so the loader does it over CDP. `size`
     * is "<width>x<height>" and forces the viewport first, which is the only
     * way to get a frame that needs no cropping afterwards -- cropping takes
     * from the middle, and the top bar and the composer go missing. Defaults
     * to 1600x1000, the size every mod's picture in the catalogue uses.
     *
     * Anything of your own that should not be in the picture has to be hidden
     * before you call this and put back after: the shutter is on the loader's
     * side, and it photographs whatever is on screen.
     */
    screenshot(options?: { size?: string; filename?: string }):
      Promise<{ path: string; bytes: number }>;
  };

  /**
   * The plugin's own files, as shipped in its folder.
   *
   * A mod is a folder, and everything in it that the runtime can read is here:
   * the modules it loaded plus any `.css` next to them. That is what lets a
   * plugin keep its stylesheet in a real `.css` file -- with an editor that
   * highlights it -- instead of a template literal:
   *
   *   api.css(api.assets.text('panel.css'));
   *
   * Paths are folder-relative and forward-slashed ("ui/panel.css"), the same
   * strings you would import.
   */
  readonly assets: {
    /** Every readable file in the folder. */
    list(): string[];
    /** One file's contents. Throws if the folder has no such file. */
    text(path: string): string;
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
    /**
     * Hold every enabled theme back, or let them through again.
     *
     * For a tool that has to show the app without them for a while -- a theme
     * editor working on top of a chosen base cannot show its own work while
     * whatever is switched on is still painting. Nothing is enabled or disabled
     * by this: the settings are untouched and the stylesheets come straight
     * back. Undone automatically when the plugin stops.
     */
    suspend(on: boolean): void;
  };

  /**
   * Per-plugin persisted settings, stored by the loader in ~/.betterslack.
   *
   * A key declared in `mod.json` under `settings` is drawn by the Mods panel,
   * and its `default` is what `get` answers before anyone has chosen: the mod
   * reads the same key either way, and does not have to know which happened.
   */
  readonly settings: {
    get<T = unknown>(key: string, fallback?: T): T | undefined;
    set(key: string, value: unknown): Promise<void>;
    all(): Record<string, unknown>;
    /**
     * Called when the panel changes one of the declared settings.
     *
     * A plugin that does nothing here is still correct: the runtime reloads it
     * after a change, so `start` simply runs again with the new values. This is
     * for the ones where reloading would be visible -- a list that would flicker,
     * a window that would close.
     */
    onChange(handler: (values: Record<string, unknown>) => void): Cleanup;
  };

  /**
   * Things this mod can do, findable by typing.
   *
   * Every idea so far has meant another button in Slack's rail, which is
   * Slack's and not ours. A command costs no chrome at all: it appears in the
   * palette (⌘K), it says where it came from, and it goes when the mod does.
   *
   *   api.commands.add({ id: 'open', title: 'Theme builder', run: open });
   */
  readonly commands: {
    add(command: {
      id: string;
      title: string;
      subtitle?: string;
      /** An emoji, a short glyph, or an image URL -- the palette draws it. */
      icon?: string;
      run: () => void | Promise<void>;
    }): Cleanup;
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
  /** The mod's folder, as read by the loader. */
  files: ModFiles;
  styles: StyleManager;
  getSettings: () => Settings;
  setSlackPrefs: (values: Record<string, unknown>) => Promise<void>;
  restartSlack: () => Promise<void>;
  /** What Slack was launched with, from the boot payload. */
  slackPrefsAtLaunch: Record<string, unknown>;
  /** What is in Slack's file now, refreshed when the loader answers. */
  slackPrefsNow: () => Record<string, unknown>;
  saveModSettings: (id: string, values: Record<string, unknown>) => Promise<void>;
  /** Tell a plugin its settings changed, for the ones that would rather not reload. */
  onSettingsChanged: (id: string, handler: (values: Record<string, unknown>) => void) => Cleanup;
  /** Put a command in the palette until the plugin goes away. */
  addCommand: (command: Command) => Cleanup;
  listCommands: () => Command[];
  listMods: () => Array<{
    id: string;
    name: string;
    description: string;
    type: 'theme' | 'plugin';
    installed: boolean;
    enabled: boolean;
    settings: number;
  }>;
  setModEnabled: (id: string, enabled: boolean) => Promise<void>;
  setModInstalled: (id: string, installed: boolean) => Promise<void>;
  openPanel: (tab?: 'themes' | 'plugins' | 'css' | 'about') => void;
  openMod: (id: string) => void;
  download: (url: string, filename: string) => Promise<{ path: string; bytes: number }>;
  screenshot: (options: { size?: string; filename?: string }) =>
    Promise<{ path: string; bytes: number }>;
  saveTheme: (options: { id: string; name: string; description: string; css: string }) => Promise<void>;
  listThemes: () => Array<{ id: string; name: string; description: string; enabled: boolean }>;
  themeSource: (id: string) => Promise<string>;
}

/** What the manifest says a setting should be before anyone has chosen. */
function declaredDefaults(record: ModRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of record.settings ?? []) {
    if (field.default !== undefined) out[field.key] = field.default;
  }
  return out;
}

export function createPluginApi(record: ModRecord, ctx: ApiContext): PluginApi {
  const cleanups = collectCleanups();
  const prefix = `[betterslack:${record.id}]`;

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
      /*
       * Slack's own desktop preferences.
       *
       * A named list and not the settings object: that file also holds the
       * workspaces you are signed in to, and a plugin runs unsandboxed in an
       * authenticated Slack. `SLACK_PREFS` is the same list the loader
       * enforces -- it refuses anything else by name, so a mod cannot reach
       * past it even if this copy were edited.
       */
      const desktop = {
        supported: /Mac OS X|Windows NT/.test(navigator.userAgent),
        keys: () => SLACK_PREFS.map((pref) => ({ ...pref })),
        get: (key: string) => ctx.slackPrefsNow()[key],
        launched: (key: string) => ctx.slackPrefsAtLaunch[key],
        needsRestart: (key: string) =>
          SLACK_PREFS.find((pref) => pref.key === key)?.restart === true,
        set: (key: string, value: unknown) =>
          ctx.setSlackPrefs({ ...ctx.getSettings().slackPrefs, [key]: value }),
        clear: (key: string) => {
          const next = { ...ctx.getSettings().slackPrefs };
          delete next[key];
          return ctx.setSlackPrefs(next);
        },
        managed: () => ({ ...ctx.getSettings().slackPrefs }),
        // Live, and not through the loader: this one is a method on the window
        // that is already open, reached through Slack's own preload bridge.
        materials: slack.desktop.materials,
        setMaterial: slack.desktop.setMaterial,
      };
      return {
        ...slack,
        desktop,
        restart: () => ctx.restartSlack(),
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
      /*
       * A style node of the helpers' own, not the plugin's.
       *
       * `api.css` replaces the plugin's stylesheet whole, which is the
       * documented contract and the right one -- a mod that recomputes its CSS
       * on a settings change would otherwise stack copies of it forever. But
       * `helpers.toggle({ whenOn })`, `helpers.badge` and `helpers.tooltip`
       * all wrote through that same node, so a mod that used one of them *and*
       * called `api.css` silently kept only whichever went last. A mod did
       * exactly that and shipped: it put its class on <html>, drew its
       * indicator, and folded nothing away, because its own indicator
       * stylesheet had overwritten the rules that hide the sidebar. Its tests
       * passed throughout -- they asserted on every call made, and the bug is
       * that only one of them survives.
       *
       * Two nodes, one per author, and neither can erase the other.
       */
      css: (text) => {
        ctx.styles.set('plugin', `${record.id}:helpers`, text);
        cleanups.add(() => ctx.styles.remove('plugin', `${record.id}:helpers`));
      },
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
      menu: track(openMenu) as PluginApi['ui']['menu'],
      palette: track(openPalette) as PluginApi['ui']['palette'],
      kit: (doc?: Document) => createKit(doc ?? document),
      kitCss: KIT_CSS,
    },

    files: {
      save: (url, filename) => ctx.download(url, filename),
      screenshot: (options) => ctx.screenshot(options ?? {}),
    },

    app: {
      mods: () => ctx.listMods(),
      setEnabled: (id, enabled) => ctx.setModEnabled(id, enabled),
      setInstalled: (id, installed) => ctx.setModInstalled(id, installed),
      openPanel: (tab) => ctx.openPanel(tab),
      openMod: (id) => ctx.openMod(id),
      commands: () => ctx.listCommands(),
    },

    commands: {
      add: (command) => {
        // Prefixed and attributed here rather than by the caller: two mods
        // will pick the same id eventually, and the palette should say which
        // mod it is offering without every mod remembering to.
        const entry: Command = {
          id: `${record.id}:${command.id}`,
          title: command.title,
          subtitle: command.subtitle,
          source: record.name,
          run: command.run,
        };
        const cleanup = ctx.addCommand(entry);
        cleanups.add(cleanup);
        return cleanup;
      },
    },

    assets: {
      list: () => Object.keys(ctx.files),
      text: (path: string) => {
        // Accept the specifier form as well, since that is what a plugin author
        // has just typed one line above in an import.
        const name = path.replace(/^\.\//, '');
        const source = ctx.files[name];
        if (source === undefined) {
          throw new Error(`"${path}" is not in the ${record.id} folder`);
        }
        return source;
      },
    },

    css(text: string) {
      ctx.styles.set('plugin', record.id, text);
      cleanups.add(() => ctx.styles.remove('plugin', record.id));
    },

    saveTheme: (options) => ctx.saveTheme(options),

    themes: {
      suspend: (on: boolean) => {
        ctx.styles.suppress('theme', on);
        // A plugin switched off while it had the app's themes held back would
        // leave the user staring at an unthemed Slack with nothing to click.
        if (on) cleanups.add(() => ctx.styles.suppress('theme', false));
      },
      list: () => ctx.listThemes(),
      source: (id) => ctx.themeSource(id),
    },

    settings: {
      all: () => ({ ...declaredDefaults(record), ...(ctx.getSettings().modSettings[record.id] ?? {}) }),
      get<T = unknown>(key: string, fallback?: T): T | undefined {
        const bag = ctx.getSettings().modSettings[record.id] ?? {};
        if (key in bag) return bag[key] as T;
        // The manifest's default comes before the caller's: it is the one the
        // panel shows, so answering something else would make the control and
        // the behaviour disagree.
        const declared = declaredDefaults(record);
        return (key in declared ? (declared[key] as T) : fallback);
      },
      async set(key: string, value: unknown) {
        const bag = { ...(ctx.getSettings().modSettings[record.id] ?? {}), [key]: value };
        await ctx.saveModSettings(record.id, bag);
      },
      onChange(handler) {
        const cleanup = ctx.onSettingsChanged(record.id, handler);
        cleanups.add(cleanup);
        return cleanup;
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
