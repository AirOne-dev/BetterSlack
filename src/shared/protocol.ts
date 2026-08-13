// Wire format shared by the loader (Node) and the runtime (renderer).
//
// Renderer -> loader travels through a CDP Runtime binding, loader -> renderer
// through Runtime.evaluate. Both directions are plain JSON strings, so nothing
// here may reference Node or DOM types.

export const BINDING_NAME = '__slackmodSend';
export const RECEIVER_NAME = '__slackmodRecv';
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
  /** Manifest schema version. Mods declaring a newer version are refused. */
  slackmodApi: number;
  /** Optional: minimum tested Slack version, informational only. */
  slackVersion?: string;
  tags?: string[];
}

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
}

export const DEFAULT_SETTINGS: Settings = {
  installed: [],
  enabled: [],
  modSettings: {},
  customCss: '',
  hotReload: true,
};

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
  | { type: 'mod.source'; id: string }
  | { type: 'mod.install'; id: string; manifest: ModManifest; source: string }
  | { type: 'mod.uninstall'; id: string }
  | { type: 'loader.info' }
  /**
   * Fetch a URL and save it. The renderer cannot do this itself: Slack's CDN
   * serves avatars without CORS headers, so `fetch` from the page fails even
   * though an <img> loads fine. The loader has no such restriction.
   */
  | { type: 'file.download'; url: string; filename: string }
  | { type: 'log'; level: 'log' | 'warn' | 'error'; message: string };

/** Push notifications the loader sends to the renderer unprompted. */
export type Event =
  | { type: 'mod.changed'; id: string; source: string }
  | { type: 'catalog.changed'; mods: ModRecord[] }
  | { type: 'settings.changed'; settings: Settings };

export interface Envelope {
  /** Correlation id; absent on pushed events. */
  rid?: number;
  payload: unknown;
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
}
