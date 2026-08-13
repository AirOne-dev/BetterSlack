// Wire format shared by the loader (Node) and the runtime (renderer).
//
// Renderer -> loader travels through a CDP Runtime binding, loader -> renderer
// through Runtime.evaluate. Both directions are plain JSON strings, so nothing
// here may reference Node or DOM types.

export const BINDING_NAME = '__slackmodSend';
export const RECEIVER_NAME = '__slackmodRecv';
export const MOD_API_VERSION = 1;

export type ModType = 'theme' | 'plugin';

/**
 * What a mod is allowed to do beyond its own kind.
 *
 * A theme is CSS, and CSS cannot move a node to a different parent, read who is
 * signed in, or press one of Slack's own buttons. Some looks genuinely need
 * that -- reproducing another app's layout is the honest example -- so a theme
 * may ship a companion script. Since that script is real code running in an
 * authenticated Slack tab, it has to say so, and the user has to agree before
 * it is ever loaded.
 *
 * Keep this list short. Every entry is a sentence someone has to read and
 * understand in a dialog, and a permission nobody can explain is a permission
 * nobody can refuse meaningfully.
 */
export type Permission = 'layout' | 'workspace';

export interface PermissionInfo {
  /** Shown as the heading of the consent row. Plain language, no jargon. */
  title: string;
  /** One or two sentences on what it actually allows, and what it does not. */
  detail: string;
}

export const PERMISSIONS: Record<Permission, PermissionInfo> = {
  layout: {
    title: 'Rearrange your Slack interface',
    detail:
      'Add, hide and reposition parts of Slack, and press its buttons on your behalf. ' +
      'It changes where things are, not only how they look.',
  },
  workspace: {
    title: 'Read your workspace from Slack',
    detail:
      'Look up people and channels through Slack, as you. It can read what you can already ' +
      'see in Slack; it cannot post, change anything, or send data off this machine.',
  },
};

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && value in PERMISSIONS;
}

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
   * Themes only: a companion ES module, relative to the mod directory, for the
   * parts of a look that CSS cannot express. Requires `permissions`, and is not
   * loaded at all until the user has granted them.
   */
  script?: string;
  /**
   * What this mod asks to be allowed to do. Absent or empty means "nothing
   * beyond its own kind", which is where almost every mod should stay.
   */
  permissions?: Permission[];
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
  /**
   * Permissions the user has agreed to, per mod id.
   *
   * Stored as what was granted rather than a yes/no, so a new version that asks
   * for more than last time stops matching and has to be approved again instead
   * of quietly inheriting the old answer.
   */
  grants: Record<string, Permission[]>;
}

export const DEFAULT_SETTINGS: Settings = {
  installed: [],
  enabled: [],
  modSettings: {},
  customCss: '',
  hotReload: true,
  grants: {},
};

/** Every permission the mod asks for has been granted. */
export function isGranted(manifest: ModManifest, settings: Settings): boolean {
  const asked = manifest.permissions ?? [];
  if (asked.length === 0) return true;
  const granted = settings.grants[manifest.id] ?? [];
  return asked.every((p) => granted.includes(p));
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
  /**
   * Record the user's answer to a consent dialog. Granting is always explicit;
   * passing an empty list revokes.
   */
  | { type: 'mod.grant'; id: string; permissions: Permission[] }
  | { type: 'mod.source'; id: string }
  /** A theme's companion script, kept separate from its stylesheet. */
  | { type: 'mod.script'; id: string }
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
  | { type: 'mod.changed'; id: string; source: string; script?: string }
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
