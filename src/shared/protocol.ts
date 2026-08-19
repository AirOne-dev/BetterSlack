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

  /**
   * A square mark for the mod, as a file in its folder -- `icon.svg`.
   *
   * SVG rather than a bitmap: it is drawn at four sizes between the panel's
   * rows and the site's cards, it has to sit on both a light and a dark
   * surface, and `currentColor` lets it take the theme's ink for free. The
   * catalogue inlines its markup, so a row can draw it before the mod is
   * installed.
   */
  icon?: string;

  /**
   * The one-liner in other languages, keyed the way `api.i18n` keys anything.
   *
   * `description` stays required and is the English one: it is what the
   * catalogue, the site and the pull request template all read, and a mod that
   * described itself only in a language the reader does not have would be a
   * mod nobody installs.
   */
  descriptions?: Record<string, string>;

  /**
   * Pictures of it working, in the mod's own folder.
   *
   * Fetched only when somebody opens the mod, since a catalogue that carried
   * twenty screenshots would be a megabyte before anybody asked for one.
   */
  screenshots?: Array<{
    file: string;
    caption?: string;
    captions?: Record<string, string>;
  }>;

  /**
   * A markdown file in the mod's folder, rendered in the panel and on the site.
   *
   * The description says what a user gets in a sentence; this is where the
   * rest goes -- what it does not do, what it costs, which setting to reach
   * for. `readmes` names the translations, the same way `descriptions` does.
   */
  readme?: string;
  readmes?: Record<string, string>;

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
 * What the catalogue carries beyond the manifest: the small things a row or a
 * card needs before anybody installs anything.
 *
 * Inlined because they are text and they are tiny -- an icon is a few hundred
 * bytes and a readme a few thousand. Screenshots are neither, and are fetched
 * one at a time through `mods.asset`.
 */
export interface ModAssets {
  iconSvg?: string;
  readmeText?: string;
  readmeTexts?: Record<string, string>;
}

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

/** What a mod from outside this repository looks like before it is installed. */
export interface RemoteMod {
  manifest: ModManifest;
  files: ModFiles;
  /** owner/name, for the record and for the warning. */
  repo: string;
  /** Where in it the mod was found. */
  folder: string;
  /** Files that will be executed, so the number is not a surprise. */
  scripts: string[];
  /** Total size, because "one small mod" and 400kB are different things. */
  bytes: number;
}

export interface ModRecord extends ModManifest, ModAssets {
  /**
   * Where the mod came from.
   *
   * `builtin` = shipped in this repository, so it went through review.
   * `installed` = written by the user or installed from the catalogue.
   * `third-party` = fetched from somebody else's repository, which nobody here
   * has read. The panel says so, permanently, on the row.
   */
  origin: 'builtin' | 'installed' | 'third-party';
  /** For a third-party mod: where it came from, shown wherever it is listed. */
  source?: string;
  /** Path relative to the mods root, e.g. "themes/midnight". */
  path: string;
}

/**
 * A Slack desktop preference a mod is allowed to read and write.
 *
 * `restart` says the value is read when a window is created, so it cannot take
 * effect in place; `defaults` says it must be mirrored into Slack's own
 * defaults snapshot, which is what it falls back to.
 */
export interface SlackPref {
  key: string;
  type: 'boolean' | 'string' | 'number';
  restart: boolean;
  defaults: boolean;
  note: string;
}

/**
 * The preferences BetterSlack will touch, and nothing else.
 *
 * Slack's `root-state.json` is not a preferences file: it also holds the
 * workspaces you are signed in to and how to reach them. A plugin runs
 * unsandboxed in an authenticated Slack, so this is a named list rather than
 * "the settings object" -- the loader refuses any other key by name, which is
 * a better failure than a mod quietly writing somewhere it should not.
 *
 * Shared rather than duplicated: the loader enforces it, `api.slack.desktop`
 * publishes it, and one list means a key cannot be offered and then refused.
 */
export const SLACK_PREFS: readonly SlackPref[] = [
  { key: 'windowVibrancy', type: 'boolean', restart: true, defaults: true, note: 'A translucent window: macOS vibrancy, Windows 11 acrylic. Off by default.' },
  { key: 'userTheme', type: 'string', restart: false, defaults: false, note: 'Slack\'s own light/dark choice.' },
  { key: 'systemThemeSyncEnabled', type: 'boolean', restart: false, defaults: false, note: 'Follow the operating system\'s light/dark setting.' },
  { key: 'launchOnStartup', type: 'boolean', restart: false, defaults: false, note: 'Start Slack when you sign in.' },
  { key: 'runFromTray', type: 'boolean', restart: false, defaults: false, note: 'Keep Slack in the menu bar or tray when its window closes.' },
  { key: 'hideOnStartup', type: 'boolean', restart: false, defaults: false, note: 'Start without showing the window.' },
  { key: 'autoHideMenuBar', type: 'boolean', restart: false, defaults: false, note: 'Windows and Linux: hide the menu bar until Alt.' },
  { key: 'useHwAcceleration', type: 'boolean', restart: true, defaults: true, note: 'GPU acceleration.' },
  { key: 'shouldUseHighContrastColors', type: 'boolean', restart: false, defaults: false, note: 'Higher-contrast colours throughout.' },
  { key: 'spellcheckerLanguage', type: 'string', restart: false, defaults: false, note: 'Language tag the spell checker uses.' },
  { key: 'notificationMethod', type: 'string', restart: false, defaults: false, note: 'How desktop notifications are delivered.' },
  { key: 'notificationPlayback', type: 'string', restart: false, defaults: false, note: 'Notification sound behaviour.' },
  { key: 'zoomLevel', type: 'number', restart: true, defaults: false, note: 'Interface zoom, in Chromium steps.' },
];

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
  /**
   * Slack's own desktop preferences, as BetterSlack keeps them.
   *
   * Slack has this built in and switched off: on macOS its main process passes
   * `vibrancy: "titlebar"` -- and drops the opaque `backgroundColor` -- when
   * `settings.windowVibrancy` is true in its own root-state.json, and on
   * Windows 11 the same flag turns on `backgroundMaterial: "acrylic"` with
   * `transparent: true`. That file is plain JSON in Application Support, well
   * outside the signed `app.asar`, so this changes a preference rather than
   * patching anything.
   *
   * Only the keys a mod has actually set are in here, and only keys from the
   * allow-list in `src/loader/slack-settings.ts` -- that file holds a great
   * deal more than preferences, including the workspaces you are signed in to.
   * The loader writes them through as they change and again before every
   * launch, so "set" means "keep it this way" rather than "poke it once".
   */
  slackPrefs?: Record<string, unknown>;
}

export const DEFAULT_SETTINGS: Settings = {
  installed: [],
  enabled: [],
  modSettings: {},
  customCss: '',
  hotReload: true,
  modFailures: {},
  slackPrefs: {},
};

/** Requirements of `manifest` that are not currently enabled. */
export function missingRequirements(manifest: ModManifest, settings: Settings): string[] {
  return (manifest.requires ?? []).filter((id) => !settings.enabled.includes(id));
}

/** Requests the renderer sends to the loader. */
export type Request =
  /**
   * Stop Slack and start it again, keeping this loader.
   *
   * For the settings that are read when a window is created and can therefore
   * never take effect in place. The renderer asking for this is about to be
   * torn down with the page, so the answer goes out before anything happens.
   */
  /** One file out of a mod's folder, as a data URL. For screenshots. */
  | { type: 'mods.asset'; id: string; file: string }
  | { type: 'slack.restart' }
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
  /** `source` marks it as coming from outside this repository, for good. */
  | { type: 'mod.install'; id: string; manifest: ModManifest; files: ModFiles; source?: string }
  | { type: 'mod.uninstall'; id: string }
  /**
   * Fetch a URL and save it. The renderer cannot do this itself: Slack's CDN
   * serves avatars without CORS headers, so `fetch` from the page fails even
   * though an <img> loads fine. The loader has no such restriction.
   */
  | { type: 'file.download'; url: string; filename: string }
  /** Pull, rebuild and relaunch. Answers before it restarts, or with why not. */
  /**
   * Photograph the window and put the picture in the download folder.
   *
   * The renderer cannot photograph itself, so this is the loader doing it over
   * CDP -- the same call `pnpm shoot` makes, at the same forced size, which is
   * the only way to get a frame the site and the READMEs can use without
   * cropping it afterwards.
   */
  | { type: 'app.screenshot'; size?: string; filename?: string }
  | { type: 'app.update' }
  /** Everything in ~/.betterslack worth keeping, as one JSON document. */
  | { type: 'backup.export' }
  /** Put one back. Replaces settings and user mods; never touches the install. */
  | { type: 'backup.import'; archive: string }
  /**
   * Read a mod from a GitHub URL, without installing it.
   *
   * Two steps on purpose: this fetches and describes, the panel asks, and only
   * then does `mod.install` write anything. Consent has to come between reading
   * and installing, or it is not consent.
   */
  | { type: 'mods.inspectRemote'; url: string }
  /** Which installed mods have a newer version published. */
  | { type: 'mods.checkUpdates' }
  /** Fetch one mod's folder from the branch and install it over the old one. */
  | { type: 'mods.update'; id: string }
  /** The renderer saying it got all the way up, which clears the crash marker. */
  | { type: 'app.ready' };

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
  /**
   * Mod folders that were found and refused, with the reason.
   *
   * A mod that fails to parse is dropped from the catalogue, so it is simply
   * not in Browse -- and the explanation only existed in the loader's terminal,
   * which is not where somebody wondering why a mod is missing is looking.
   * Carried here so the panel can say it where the mod would have been.
   */
  skipped: string[];
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
  /**
   * Slack's desktop preferences as they were when this Slack was launched.
   *
   * Not the same as what is wanted now: several of them -- the window's
   * material above all -- are read when a window is created, so the two
   * disagree exactly when a restart would change something. That is the only
   * honest moment to offer one.
   */
  slackPrefsAtLaunch: Record<string, unknown>;
}
