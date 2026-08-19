// A thin, auditable client for Slack's own web API, exposed as `api.slack.web`.
//
// WHY THIS EXISTS IN ONE PLACE
//
// Slack's API refuses cookie-only requests ("not_authed"); the desktop client
// authenticates with an `xoxc-` token it keeps in localStorage. So any mod that
// wants profile data beyond what is painted on screen needs that token.
//
// The dangerous version of this is every mod reading localStorage for itself:
// a reviewer would then have to check each one for what it does with the token,
// and a malicious mod would look much like a legitimate one. Instead the token
// is read here, once, and mods only ever see a `call(method, params)` function.
//
// The guarantees this file makes, and that a reviewer can check by reading it:
//
//   - Requests only ever go to `/api/<method>` on Slack's own origin. There is
//     no parameter that can redirect them elsewhere.
//   - The method name is validated against Slack's naming, so it cannot be
//     used to escape that path.
//   - The token is never returned to callers, never logged, and never included
//     in anything this module hands back.
//
// A mod that reaches into localStorage itself, or that sends anything derived
// from these responses off the machine, is out of scope for this project --
// see CONTRIBUTING.md.

const CONFIG_KEY = 'localConfig_v2';
const METHOD_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$/;

export class WebApiError extends Error {
  constructor(
    readonly method: string,
    readonly slackError: string,
  ) {
    super(`${method} failed: ${slackError}`);
  }
}

interface TeamConfig {
  id: string;
  domain?: string;
  token?: string;
  user_id?: string;
}

/** Team id from the client URL: /client/<team>/<channel>. */
export function currentTeamId(): string | null {
  const match = location.pathname.match(/\/client\/(T[A-Z0-9]+)/i);
  return match ? match[1]! : null;
}

function readTeamConfig(): TeamConfig | null {
  const teamId = currentTeamId();
  if (!teamId) return null;
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { teams?: Record<string, TeamConfig> };
    return parsed.teams?.[teamId] ?? null;
  } catch {
    return null;
  }
}

export interface WebApi {
  /** True when a token for the current workspace was found. */
  readonly available: boolean;
  /** The workspace domain, e.g. "acme" for acme.slack.com. */
  readonly teamDomain: string | null;
  /** The signed-in user's id. */
  readonly selfId: string | null;

  /**
   * Call a Slack API method as the signed-in user.
   * Rejects with WebApiError when Slack answers `ok: false`.
   */
  call<T = Record<string, unknown>>(
    method: string,
    params?: Record<string, string | number | boolean>,
  ): Promise<T>;

  /** users.info, including locale. */
  userInfo(userId: string): Promise<SlackUser>;

  /**
   * Several users at once, cached for the session.
   *
   * `users.info` accepts a comma-separated `users` list and answers with a
   * `users` array. Undocumented, but it is what Slack's own client sends, and
   * it turns one request per member into one request. Anything already known is
   * served from the cache, so opening the same channel twice costs nothing.
   *
   * The cache is dropped when the workspace changes -- two workspaces can hold
   * different people behind the same id, and serving one's directory to the
   * other is the kind of bug that reads as Slack being wrong.
   */
  users(userIds: string[]): Promise<Map<string, SlackUser>>;

  /**
   * The workspace's custom emoji, by name, as image URLs.
   *
   * `emoji.list` answers with the custom ones only -- the standard set is not in
   * it, which is why a shortcode alone is not enough to draw one. Alias chains
   * (`alias:other-name`) are followed here, so every name in the map points at
   * an image. Cached per workspace for the same reason the directory is.
   */
  emoji(): Promise<Map<string, string>>;

  /** users.getPresence. */
  presence(userId: string): Promise<Record<string, unknown>>;
  /** team.info for the current workspace. */
  teamInfo(): Promise<Record<string, unknown>>;
  /** dnd.info for a user. */
  dndInfo(userId: string): Promise<Record<string, unknown>>;

  /**
   * Presence and do-not-disturb, as the one answer a UI actually wants.
   *
   * Both calls, and the rule between them: someone marked active who is in a
   * do-not-disturb window is *not* available, and every mod that shows a status
   * dot was deriving that for itself. Failures are absences, not errors -- a
   * dot that cannot be drawn is not a reason to fail whatever asked for it.
   */
  availability(userId: string): Promise<Availability>;
}

export interface Availability {
  /** What a dot should show. */
  state: 'active' | 'away' | 'dnd' | 'unknown';
  /** Raw `users.getPresence`, when it answered. */
  presence: Record<string, unknown> | null;
  /** Raw `dnd.info`, when it answered. */
  dnd: Record<string, unknown> | null;
}

export interface SlackProfile {
  real_name?: string;
  display_name?: string;
  title?: string;
  phone?: string;
  status_text?: string;
  /** A shortcode, `:coffee:` -- with the colons. */
  status_emoji?: string;
  /**
   * What Slack's own client draws the status emoji from.
   *
   * Present when Slack has something better than the name to offer: a
   * `display_url` for a custom emoji, and the unicode for a standard one. It is
   * an array because a status emoji can be an alias chain; the first entry is
   * the one that resolves.
   */
  status_emoji_display_info?: Array<{
    emoji_name?: string;
    display_url?: string;
    unicode?: string;
    display_alias?: string;
  }>;
  /** Unix seconds, or 0 for a status with no end. */
  status_expiration?: number;
  image_original?: string;
  image_1024?: string;
  image_512?: string;
  image_192?: string;
  image_72?: string;
  is_custom_image?: boolean;
  avatar_hash?: string;
  fields?: Record<string, { value?: string; alt?: string }> | null;
  [key: string]: unknown;
}

export interface SlackUser {
  id: string;
  name?: string;
  real_name?: string;
  tz?: string;
  tz_label?: string;
  tz_offset?: number;
  is_admin?: boolean;
  is_owner?: boolean;
  is_primary_owner?: boolean;
  is_bot?: boolean;
  is_app_user?: boolean;
  deleted?: boolean;
  is_restricted?: boolean;
  is_ultra_restricted?: boolean;
  is_email_confirmed?: boolean;
  updated?: number;
  color?: string;
  locale?: string;
  team_id?: string;
  profile?: SlackProfile;
  [key: string]: unknown;
}

/**
 * How long a cached profile is trusted.
 *
 * One minute, which is the palette's own cache and so the two agree rather than
 * one holding a profile the other has already replaced. A status changes
 * several times a day and a mod that never notices is the bug this exists to
 * avoid; a member list redrawn on every channel change must not mean a request
 * per member per change.
 *
 * Your *own* status does not wait for this. Slack swaps the emoji in its user
 * button the moment you change it, and the account strip reads that -- there is
 * no such signal for anybody else, which is why theirs is a cache and not an
 * observation.
 */
const DIRECTORY_TTL = 60 * 1000;

export function createWebApi(): WebApi {
  /**
   * Cached per team, not once.
   *
   * Switching workspace does not reload the client: the same page, the same
   * mods and the same api objects carry on with a new team id in the URL. A
   * config read once at boot then belongs to the workspace you have left, so
   * every call goes out with the wrong token and Slack answers with errors
   * that read like missing features -- "Slack does not list members for this
   * conversation" was this bug, and so was every other plugin quietly dying on
   * a workspace switch.
   */
  let cachedTeam: string | null | undefined;
  /**
   * users.info answers, the workspace they belong to, and when each arrived.
   *
   * Cached for a session was too long. A profile is mostly stable, but the one
   * field on it that changes several times a day is the status -- and a mod
   * showing a status that never updates is worse than one showing none. Held
   * for a few minutes instead: long enough that opening the same channel twice
   * still costs nothing, short enough that a status somebody set is not stale
   * for the rest of the day.
   */
  const directory = new Map<string, { user: SlackUser; at: number }>();
  let directoryTeam: string | null | undefined;
  /** emoji.list for this workspace, and the request while it is in flight. */
  let emojiTeam: string | null | undefined;
  let emojiMap: Promise<Map<string, string>> | null = null;
  let cached: TeamConfig | null = null;
  const config = () => {
    const team = currentTeamId();
    if (team !== cachedTeam) {
      cachedTeam = team;
      cached = readTeamConfig();
    }
    return cached;
  };

  const call = async <T>(
    method: string,
    params: Record<string, string | number | boolean> = {},
  ): Promise<T> => {
    if (!METHOD_PATTERN.test(method)) {
      throw new WebApiError(method, 'invalid method name');
    }
    const token = config()?.token;
    if (!token) throw new WebApiError(method, 'no session token for this workspace');

    const body = new FormData();
    body.append('token', token);
    for (const [key, value] of Object.entries(params)) body.append(key, String(value));

    // Same-origin by construction: no caller-supplied host, ever.
    const response = await fetch(`/api/${method}`, {
      method: 'POST',
      body,
      credentials: 'include',
    });
    if (!response.ok) throw new WebApiError(method, `HTTP ${response.status}`);

    const payload = (await response.json()) as { ok: boolean; error?: string };
    if (!payload.ok) throw new WebApiError(method, payload.error ?? 'unknown error');
    return payload as T;
  };

  return {
    get available() {
      return typeof config()?.token === 'string';
    },
    get teamDomain() {
      return config()?.domain ?? null;
    },
    get selfId() {
      return config()?.user_id ?? null;
    },
    call,
    async userInfo(userId) {
      const res = await call<{ user: SlackUser }>('users.info', {
        user: userId,
        include_locale: true,
      });
      return res.user;
    },
    async users(userIds) {
      const team = currentTeamId();
      if (team !== directoryTeam) {
        directoryTeam = team;
        directory.clear();
      }

      const wanted = [...new Set(userIds)].filter((id) => id);
      const now = Date.now();
      const missing = wanted.filter((id) => {
        const held = directory.get(id);
        return !held || now - held.at > DIRECTORY_TTL;
      });
      if (missing.length) {
        try {
          const res = await call<{ users?: SlackUser[] }>('users.info', {
            users: missing.join(','),
            include_locale: true,
          });
          for (const user of res.users ?? []) directory.set(user.id, { user, at: now });
        } catch {
          // The batch form is undocumented. If Slack ever stops accepting it,
          // one request each still works and is only slower.
          const each = await Promise.all(
            missing.map((id) =>
              call<{ user: SlackUser }>('users.info', { user: id, include_locale: true })
                .then((res) => res.user)
                .catch(() => null),
            ),
          );
          for (const user of each) if (user) directory.set(user.id, { user, at: now });
        }
      }

      const out = new Map<string, SlackUser>();
      for (const id of wanted) {
        const held = directory.get(id);
        if (held) out.set(id, held.user);
      }
      return out;
    },
    emoji() {
      const team = currentTeamId();
      if (team !== emojiTeam) {
        emojiTeam = team;
        emojiMap = null;
      }
      if (emojiMap) return emojiMap;

      emojiMap = (async () => {
        const out = new Map<string, string>();
        let raw: Record<string, string> = {};
        try {
          const res = await call<{ emoji?: Record<string, string> }>('emoji.list');
          raw = res.emoji ?? {};
        } catch {
          // An emoji nobody can draw is not a reason to fail whatever asked.
          return out;
        }
        /*
         * `alias:other` points at another name, and the chain can be longer than
         * one. Followed with a seen-set: a workspace can hold a pair of aliases
         * that name each other, and a loop here would hang every caller.
         */
        for (const name of Object.keys(raw)) {
          const seen = new Set<string>();
          let target = name;
          let value = raw[target];
          while (typeof value === 'string' && value.startsWith('alias:') && !seen.has(target)) {
            seen.add(target);
            target = value.slice('alias:'.length);
            value = raw[target];
          }
          if (typeof value === 'string' && !value.startsWith('alias:')) out.set(name, value);
        }
        return out;
      })();
      return emojiMap;
    },
    presence: (userId) => call('users.getPresence', { user: userId }),
    teamInfo: () => call('team.info'),
    dndInfo: (userId) => call('dnd.info', { user: userId }),
    async availability(userId) {
      const [presence, dnd] = await Promise.all([
        call<Record<string, unknown>>('users.getPresence', { user: userId }).catch(() => null),
        call<Record<string, unknown>>('dnd.info', { user: userId }).catch(() => null),
      ]);
      const snoozed = Boolean(dnd?.snooze_enabled) || Boolean(dnd?.dnd_enabled && isInDndWindow(dnd));
      if (snoozed) return { state: 'dnd', presence, dnd };
      if (!presence) return { state: 'unknown', presence, dnd };
      return { state: presence.presence === 'active' ? 'active' : 'away', presence, dnd };
    },
  };
}

/** dnd.info gives a window in epoch seconds; "enabled" alone is a schedule, not a state. */
function isInDndWindow(dnd: Record<string, unknown>): boolean {
  const start = Number(dnd.next_dnd_start_ts ?? 0);
  const end = Number(dnd.next_dnd_end_ts ?? 0);
  if (!start || !end) return false;
  const now = Date.now() / 1000;
  return now >= start && now < end;
}


/** Pull a user id out of any Slack avatar URL: `<team>-<user>-<hash>-<size>`. */
export function userIdFromAvatarUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(/\/T[A-Z0-9]+-(U[A-Z0-9]+)-/i);
  return match ? match[1]!.toUpperCase() : null;
}
