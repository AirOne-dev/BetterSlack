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
  /** users.getPresence. */
  presence(userId: string): Promise<Record<string, unknown>>;
  /** team.info for the current workspace. */
  teamInfo(): Promise<Record<string, unknown>>;
  /** dnd.info for a user. */
  dndInfo(userId: string): Promise<Record<string, unknown>>;
}

export interface SlackProfile {
  real_name?: string;
  display_name?: string;
  title?: string;
  phone?: string;
  status_text?: string;
  status_emoji?: string;
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

export function createWebApi(): WebApi {
  let cached: TeamConfig | null | undefined;
  const config = () => (cached === undefined ? (cached = readTeamConfig()) : cached);

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
    presence: (userId) => call('users.getPresence', { user: userId }),
    teamInfo: () => call('team.info'),
    dndInfo: (userId) => call('dnd.info', { user: userId }),
  };
}

/**
 * Slack serves avatars as `<base>-<size>`, and `image_original` is the file as
 * uploaded. Ordered best first.
 */
export function bestAvatarUrl(profile: SlackProfile | undefined): string | null {
  if (!profile) return null;
  for (const key of ['image_original', 'image_1024', 'image_512', 'image_192', 'image_72'] as const) {
    const value = profile[key];
    if (typeof value === 'string' && value) return value;
  }
  return null;
}

/** Pull a user id out of any Slack avatar URL: `<team>-<user>-<hash>-<size>`. */
export function userIdFromAvatarUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(/\/T[A-Z0-9]+-(U[A-Z0-9]+)-/i);
  return match ? match[1]!.toUpperCase() : null;
}
