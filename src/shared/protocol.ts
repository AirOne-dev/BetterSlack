// Wire format shared by the loader (Node) and the runtime (renderer).
//
// Renderer -> loader travels through a CDP Runtime binding, loader -> renderer
// through Runtime.evaluate. Both directions are plain JSON strings, so nothing
// here may reference Node or DOM types.

export const BINDING_NAME = '__betterslackSend';
export const RECEIVER_NAME = '__betterslackRecv';
export const MOD_API_VERSION = 1;

export type ModType = 'theme' | 'plugin';

export interface ModManifest {
  id: string;
  name: string;
  type: ModType;
  version: string;
  author: string;
  description: string;
  /** File to load, relative to the mod directory: a .css for themes, .js for plugins. */
  entry: string;
  /**
   * Themes only: plugin ids this theme needs to look right.
   *
   * A theme is CSS and nothing else. When a look genuinely needs behaviour --
   * reading who is signed in, adding a column Slack does not have -- that
   * behaviour belongs in a plugin, which is reviewed and installed as one, and
   * the theme points at it here. The panel offers to install and enable them
   * with the theme, and says so plainly when one is missing.
   *
   * Only themes may declare this, and only plugin ids, so there is no way to
   * build a cycle.
   */
  requires?: string[];
  /**
   * Settings the panel should offer, and their defaults.
   *
   * A mod reads the same keys through `api.settings`; this only says what the
   * panel should draw and what the value is when nobody has chosen one. Before
   * this, every adjustable thing was either a constant in the source or a
   * control the mod had to build for itself, which is why almost none of them
   * were adjustable at all.
   */
  settings?: ModSettingField[];

  /** Manifest schema version. Mods declaring a newer version are refused. */
  betterslackApi: number;
  /** Optional: minimum tested Slack version, informational only. */
  slackVersion?: string;
  tags?: string[];
}

/**
 * A mod's files, keyed by path relative to its folder.
 *
 * Mods are folders, not files: `index.js` may import `./colour.js`, and a theme
 * may `@import './rail.css'`. The loader reads the whole folder and the runtime
 * stitches it back together, because the alternative -- one file per mod -- is
 * what made the theme builder a two-thousand-line wall.
 */
export type ModFiles = Record<string, string>;

/**
 * One setting, as the panel will draw it.
 *
 * Deliberately few types. Anything a mod can express with a checkbox, a number,
 * a word, a colour or a choice belongs here; anything more belongs in the mod's
 * own window, where it can be explained properly.
 */
export type ModSettingField =
  | { key: string; type: 'boolean'; label: string; hint?: string; default?: boolean }
  | {
    key: string;
    type: 'number';
    label: string;
    hint?: string;
    default?: number;
    min?: number;
    max?: number;
    step?: number;
  }
  | { key: string; type: 'text'; label: string; hint?: string; default?: string; placeholder?: string }
  | { key: string; type: 'colour'; label: string; hint?: string; default?: string }
  | {
    key: string;
    type: 'choice';
    label: string;
    hint?: string;
    default?: string;
    options: Array<{ value: string; label: string }>;
  };

export interface ModRecord extends ModManifest {
  /** Where the mod came from. `builtin` = shipped in this repo's mods/ folder. */
  origin: 'builtin' | 'installed';
  /** Path relative to the mods root, e.g. "themes/midnight". */
  path: string;
}

export interface Settings {
  /**
   * Mod ids the user has installed. The repository is a catalogue, not a set of
   * pre-installed mods: a fresh install starts empty and you install what you
   * want. `enabled` is always a subset of this.
   */
  installed: string[];
  /** Mod ids that are currently on. */
  enabled: string[];
  /** Per-mod key/value bags, owned by the mod itself. */
  modSettings: Record<string, Record<string, unknown>>;
  /** User's own CSS, applied last so it always wins. */
  customCss: string;
  /** Reapply mods automatically when their file changes on disk. */
  hotReload: boolean;
  /**
   * Consecutive failures per mod, cleared as soon as one applies cleanly.
   *
   * A mod that throws on start is skipped after the second time rather than
   * being retried at every launch: a broken mod should cost you one bad start,
   * not every start.
   */
  modFailures?: Record<string, number>;
}

export const DEFAULT_SETTINGS: Settings = {
  installed: [],
  enabled: [],
  modSettings: {},
  customCss: '',
  hotReload: true,
  modFailures: {},
};

/** Requirements of `manifest` that are not currently enabled. */
export function missingRequirements(manifest: ModManifest, settings: Settings): string[] {
  return (manifest.requires ?? []).filter((id) => !settings.enabled.includes(id));
}

/** Requests the renderer sends to the loader. */
export type Request =
  | { type: 'catalog' }
  | { type: 'settings.get' }
  | { type: 'settings.set'; settings: Partial<Settings> }
  /**
   * Deliberately granular. Sending the whole `enabled` array back would make
   * two Slack windows overwrite each other: whichever wrote last would erase
   * anything the other had turned on since it last read.
   */
  | { type: 'mod.enable'; id: string; enabled: boolean }
  /** Add or remove a catalogue mod from the installed set. */
  | { type: 'mod.setInstalled'; id: string; installed: boolean }
  /** Every file of a mod, keyed by relative path. */
  | { type: 'mod.source'; id: string }
  | { type: 'mod.install'; id: string; manifest: ModManifest; files: ModFiles }
  | { type: 'mod.uninstall'; id: string }
  | { type: 'loader.info' }
  /**
   * Fetch a URL and save it. The renderer cannot do this itself: Slack's CDN
   * serves avatars without CORS headers, so `fetch` from the page fails even
   * though an <img> loads fine. The loader has no such restriction.
   */
  | { type: 'file.download'; url: string; filename: string }
  /** Pull, rebuild and relaunch. Answers before it restarts, or with why not. */
  | { type: 'app.update' }
  /** Which installed mods have a newer version published. */
  | { type: 'mods.checkUpdates' }
  /** Fetch one mod's folder from the branch and install it over the old one. */
  | { type: 'mods.update'; id: string }
  /** The renderer saying it got all the way up, which clears the crash marker. */
  | { type: 'app.ready' }
  | { type: 'log'; level: 'log' | 'warn' | 'error'; message: string };

/** Push notifications the loader sends to the renderer unprompted. */
export type Event =
  | { type: 'mod.changed'; id: string; files: ModFiles }
  | { type: 'catalog.changed'; mods: ModRecord[] }
  | { type: 'settings.changed'; settings: Settings }
  /** Sent once the version check finishes, which is after boot: it goes out on
   *  the network and nothing should wait for it. */
  | { type: 'update.status'; status: UpdateStatus };

export interface Envelope {
  /** Correlation id; absent on pushed events. */
  rid?: number;
  payload: unknown;
}

/**
 * What the loader knows about this copy being current.
 *
 * `behind` is only ever true when the check is certain. Offline, on a fork, on
 * a branch that tracks nothing: all of those answer "do not know", and the
 * panel shows nothing rather than a badge nobody can act on.
 */
export interface UpdateStatus {
  kind: 'git' | 'package' | 'unknown';
  behind: boolean;
  commits?: number;
  latest?: string;
  headline?: string;
  note?: string;
  updatable: boolean;
}

export interface LoaderInfo {
  version: string;
  /**
   * Identifies one loader run. A runtime injected by a previous run survives in
   * the page after that loader exits, so the new one uses this to recognise a
   * stale instance and replace it instead of trusting its state.
   */
  sessionId: string;
  modsRoot: string;
  userModsRoot: string;
  slackPath: string;
  /** How the loader talks to Slack, shown in the About tab. */
  transport: string;
  /**
   * Nothing was applied this run.
   *
   * Either asked for (`--safe`) or decided: a run that never reported itself
   * healthy is assumed to have been taken down by a mod, and the next one comes
   * up bare so there is something to click. Twice now a mod has frozen the
   * renderer outright, and the only way out was killing Slack and editing the
   * settings file by hand.
   */
  safeMode: boolean;
  /** Why, when it was not asked for. */
  safeModeReason?: string;
  /** Where this copy lives, so the panel can say what it would update. */
  root: string;
}
