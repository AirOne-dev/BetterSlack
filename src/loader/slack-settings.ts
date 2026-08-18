// Slack's own preferences file, and the one flag BetterSlack writes in it.
//
// Everything else this project does leaves Slack's data alone -- it drives the
// renderer over CDP and keeps its own state in ~/.betterslack. This is the
// exception, and it is deliberately the narrowest one that could work: a single
// boolean, in a file that is plain JSON, backed up before the first write.
//
// Why it is worth the exception: Slack already knows how to draw a translucent
// window and simply has it switched off. Read out of app.asar (readable; it is
// only patching that the code signature prevents), its main process builds the
// window options like this --
//
//   const { userTheme, windowVibrancy } = settings;
//   isMac && windowVibrancy && (vibrancy = 'titlebar');
//   const acrylic = windowVibrancy && isWin11 ? 'acrylic' : undefined;
//   return {
//     backgroundColor: !!(vibrancy || acrylic) ? undefined : themeColour(...),
//     backgroundMaterial: acrylic, transparent: !!acrylic, vibrancy,
//   };
//
// -- so the flag both asks for the material and removes the opaque background
// behind the page. Measured on 4.51: with the page's own backgrounds cleared,
// the darkest pixel of the window goes from 27 to 43 with the flag on, over an
// identical backdrop. An opaque window with no backgroundColor would be white.
//
// It must be written *before Slack starts*: the option is read when the window
// is created, and Slack rewrites this file for its own reasons, including on
// quit. So the loader applies the wanted state at every launch rather than
// once.

import { promises as fs } from 'node:fs';
import { homedir, platform } from 'node:os';
import path from 'node:path';
import { SLACK_PREFS, type SlackPref } from '../shared/protocol.js';
import { USER_ROOT, ensureUserRoot } from './store.js';

/** The list, by key, since every lookup here is by key. */
const BY_KEY: Record<string, SlackPref> = Object.fromEntries(
  SLACK_PREFS.map((pref) => [pref.key, pref]),
);

/** Where Slack keeps the file, per platform. Linux Slack has no vibrancy. */
export function slackStatePath(): string | null {
  const home = homedir();
  switch (platform()) {
    case 'darwin':
      return path.join(home, 'Library/Application Support/Slack/storage/root-state.json');
    case 'win32':
      return path.join(process.env.APPDATA ?? path.join(home, 'AppData/Roaming'),
        'Slack/storage/root-state.json');
    default:
      return null;
  }
}

/**
 * The preferences a mod may read and write, and nothing else.
 *
 * `root-state.json` is not a preferences file: it also holds the workspaces
 * you are signed in to and how to reach them. A plugin runs unsandboxed in an
 * authenticated Slack, so the API deliberately reaches a named list rather
 * than "the settings object" -- a key that is not here is refused by name,
 * which is a better failure than a mod quietly writing somewhere it should
 * not.
 *
 * `restart` says whether the value is read when a window is created. Those
 * cannot take effect in place, and a mod that changes one should offer
 * `api.slack.restart()` rather than leave someone waiting.
 *
 * `defaults` mirrors the value into Slack's own defaults snapshot, which is
 * what it falls back to; measured as necessary for the window material.
 */
/** True where there is a Slack settings file to read at all. */
export function prefsSupported(): boolean {
  return slackStatePath() !== null;
}

/** Refuse anything outside the list, or of the wrong type, by name. */
export function checkPref(key: string, value: unknown): string | null {
  const spec = BY_KEY[key];
  if (!spec) return `"${key}" is not a Slack preference BetterSlack will touch`;
  if (typeof value !== spec.type) return `"${key}" is a ${spec.type}, not a ${typeof value}`;
  return null;
}

/**
 * Merge wanted values into a parsed settings file.
 *
 * Pure, so the shape of the change can be tested without a Slack
 * installation, and so what it does and does not touch is readable in one
 * place: named keys under `settings`, their mirror in `slackDefaults` where
 * the list says so, and nothing else in the document.
 */
export function withPrefs(state: unknown, wanted: Record<string, unknown>): {
  changed: boolean;
  state: unknown;
} {
  if (state === null || typeof state !== 'object') return { changed: false, state };
  const settings = (state as Record<string, any>).settings;
  if (settings === null || typeof settings !== 'object') return { changed: false, state };

  let changed = false;
  for (const [key, value] of Object.entries(wanted)) {
    if (checkPref(key, value) !== null) continue;
    if (settings[key] !== value) {
      settings[key] = value;
      changed = true;
    }
    const spec = BY_KEY[key]!;
    if (spec.defaults && settings.slackDefaults && typeof settings.slackDefaults === 'object') {
      if (settings.slackDefaults[key] !== value) {
        settings.slackDefaults[key] = value;
        changed = true;
      }
    }
  }
  return { changed, state };
}

/** What the file says now, for the keys on the list. */
export async function readDesktopPrefs(): Promise<Record<string, unknown>> {
  const file = slackStatePath();
  if (!file) return {};
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, any>;
    const settings = parsed?.settings;
    if (!settings || typeof settings !== 'object') return {};
    const out: Record<string, unknown> = {};
    for (const { key } of SLACK_PREFS) {
      if (key in settings) out[key] = settings[key];
    }
    return out;
  } catch {
    return {};
  }
}

const BACKUP = () => path.join(USER_ROOT, 'slack-root-state.backup.json');

/**
 * Put the wanted preferences into Slack's file. Returns what happened.
 *
 * Quiet about a missing file: Slack writes it on first run, and somebody who
 * has never launched Slack has nothing to configure yet.
 */
export async function applyDesktopPrefs(wanted: Record<string, unknown>): Promise<
  'unsupported' | 'no-file' | 'unchanged' | 'written' | 'failed'
> {
  if (!Object.keys(wanted).length) return 'unchanged';
  const file = slackStatePath();
  if (!file) return 'unsupported';
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch {
    return 'no-file';
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 'failed';
  }

  const { changed, state } = withPrefs(parsed, wanted);
  if (!changed) return 'unchanged';

  // One backup, kept for ever: the first time this project touches somebody
  // else's settings file is the moment to make the original recoverable, and
  // overwriting it later would only ever replace the pristine copy with a
  // modified one.
  await ensureUserRoot();
  const backup = BACKUP();
  if (!(await fs.stat(backup).then(() => true).catch(() => false))) {
    await fs.writeFile(backup, raw, 'utf8');
  }

  // Written through a temporary file: a half-written root-state.json is a
  // Slack that comes up with no workspaces.
  const temp = `${file}.betterslack-tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(state), 'utf8');
    await fs.rename(temp, file);
    return 'written';
  } catch {
    await fs.rm(temp).catch(() => undefined);
    return 'failed';
  }
}
