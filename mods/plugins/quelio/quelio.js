// Talking to quelio-api, through `api.net`.
//
// The conversation is one route: a POST to the server's address with
// `action=login` and either a password -- once, to sign in -- or the token
// Quelio handed back, and the answer is the person's weeks. Nothing else is
// ever sent: no Slack id, no message, no workspace, nothing read off the
// screen. The address is the one the user typed into this plugin's settings,
// and `api.net` refuses any other.
//
// Every call makes Quelio sign in to Kelio, which is why quelio-api asks for
// no more than one an hour, and why a refused sign-in is never retried here:
// five failures in five minutes lock out the whole office's address.

import { DEFAULT_OBJECTIVE } from './lib/rules.js';
import { readBadges } from './lib/day.js';
import { dayKey, parseDuration, workingDaysOf } from './lib/time.js';

/**
 * The address as typed, made into the one to call -- or null.
 *
 * https only, since a password crosses it. And a folder gets its trailing
 * slash: quelio-api answers `/api` with a 301 to `/api/`, and a POST that
 * followed it would arrive as a GET.
 */
export function normaliseAddress(text) {
  let url;
  try {
    url = new URL(String(text ?? '').trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  url.hash = '';
  url.search = '';
  const last = url.pathname.split('/').pop() ?? '';
  if (!last.includes('.') && !url.pathname.endsWith('/')) url.pathname += '/';
  return url.href;
}

/** What to show the reader of an address: its host, which is what they would recognise. */
export function hostOf(address) {
  try {
    return new URL(address).host;
  } catch {
    return '';
  }
}

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The parts of an answer this plugin uses, for the week holding `today`.
 *
 * Quelio returns every week it has ever stored; only Monday to Friday of this
 * one are kept, both because nothing else is drawn and because what is kept
 * is written to disk, to the plugin's own hours.json, after every answer. Days are found by
 * their date rather than by Quelio's week key, so a key written another way
 * cannot hide one. PHP encodes an empty map as `[]`, which is an answer with
 * no weeks rather than a broken one.
 */
export function readAnswer(json, today = new Date()) {
  if (!isRecord(json)) return null;
  const weeks = json.weeks;
  if (!isRecord(weeks) && !(Array.isArray(weeks) && weeks.length === 0)) return null;

  // A number, or a number written as text: PHP keeps whatever was posted.
  const raw = isRecord(json.preferences) ? json.preferences.minutes_objective : undefined;
  const minutes = typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw) : raw;
  const reported = Number.isInteger(minutes) && minutes > 0;
  const wanted = new Set(workingDaysOf(today).map(dayKey));
  const days = {};
  for (const week of Object.values(isRecord(weeks) ? weeks : {})) {
    if (!isRecord(week) || !isRecord(week.days)) continue;
    for (const [key, day] of Object.entries(week.days)) {
      if (!wanted.has(key) || !isRecord(day)) continue;
      days[key] = { badges: readBadges(day.hours), paid: parseDuration(day.paid) };
    }
  }
  return {
    objective: reported ? minutes : DEFAULT_OBJECTIVE,
    objectiveReported: reported,
    token: typeof json.token === 'string' && json.token ? json.token : null,
    days,
  };
}

/** quelio-api's message for a refused sign-in ends "(4 attempts remaining)". */
function attemptsLeft(json) {
  const match = /\((\d+) attempts? remaining\)/.exec(String(json?.error ?? ''));
  return match ? Number(match[1]) : null;
}

/**
 * Sort what `api.net` handed back into what to do next.
 *
 * `signingIn` changes what a 401 means: refused credentials when they were
 * just typed, a session that is over when they were a token. quelio-api sends
 * `token_invalidated` with some of those and not others -- "Invalid or expired
 * token" carries nothing -- so the status decides, not the flag.
 */
export function classify(answer, { signingIn, today }) {
  if (!answer || typeof answer !== 'object') return { ok: false, reason: 'unreachable' };
  if ('error' in answer) {
    switch (answer.error) {
      case 'timeout': return { ok: false, reason: 'timeout' };
      case 'blocked': return { ok: false, reason: 'address' };
      case 'network': return { ok: false, reason: 'unreachable' };
      default: return { ok: false, reason: 'malformed' };
    }
  }
  const { status, json } = answer;
  if (status === 401 || (isRecord(json) && json.token_invalidated === true)) {
    return signingIn
      ? { ok: false, reason: 'credentials', attemptsLeft: attemptsLeft(json) }
      : { ok: false, reason: 'expired' };
  }
  if (status === 429) {
    const seconds = Number(isRecord(json) ? json.retry_after : NaN);
    return { ok: false, reason: 'rateLimited', retryAfter: Number.isFinite(seconds) && seconds > 0 ? seconds : 300 };
  }
  if (status >= 300 && status < 400) return { ok: false, reason: 'redirect' };
  if (status === 404) return { ok: false, reason: 'notFound' };
  if (status === 400 || status === 403 || status === 422) return { ok: false, reason: 'refused' };
  if (status >= 500) return { ok: false, reason: 'server' };
  if (status !== 200) return { ok: false, reason: 'server' };

  const data = readAnswer(json, today);
  if (!data) return { ok: false, reason: 'malformed' };
  return { ok: true, data };
}

export function createClient(api, clock = () => new Date()) {
  const ask = async (address, form, signingIn) => {
    let answer;
    try {
      answer = await api.net.request(address, { method: 'POST', form: { action: 'login', ...form } });
    } catch {
      // `api.net` answers rather than throws; this is a loader that is gone.
      answer = { error: 'network' };
    }
    return classify(answer, { signingIn, today: clock() });
  };

  return {
    /** The only request that carries a password. */
    signIn: (address, username, password) => ask(address, { username, password }, true),
    refresh: (address, session) => ask(address, { username: session.username, token: session.token }, false),
  };
}
