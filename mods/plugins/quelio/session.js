// Who is signed in, what Quelio last said, and when to ask it again.
//
// Two kinds of value meet on screen and are kept apart here. What Quelio
// answered -- badges, its count of each day, the weekly objective -- changes
// only when it is asked, and it is asked rarely: every call signs in to Kelio.
// Everything that moves with the clock -- how long lunch has lasted, what is
// left today -- is recomputed from that answer on every repaint and costs
// nothing. So the screen moves every few seconds and the network is touched
// about once an hour.
//
// Where each thing is kept, and why there:
//
//   api.data      session.json  { server, username, token } -- never a password
//                 hours.json    this week's days and when they were read, so a
//                               restart draws at once instead of waiting on Kelio
//   api.settings  lastUser      the name to put back in the sign-in form
//                 daysOff       which days of this week were marked as not worked
//
// The token and the hours are files of this plugin's own rather than settings
// because settings.json travels: it is copied whole into every BetterSlack
// backup, embedded in the script that starts every page, and sent to every
// window whenever any mod changes anything. The data folder does none of
// that. It is still a plain file on disk -- ~/.betterslack/data/quelio/ -- and
// nothing here pretends otherwise: it is not encrypted, the token is a
// credential for quelio-api until it is invalidated there, and anyone who can
// read the file can use it. Removing the plugin does not delete it; signing
// out does.

import { anchorOffset } from './lib/day.js';
import { SCHEDULE } from './lib/rules.js';
import { dayKey, isoWeek, minutesOf, weekdayOf } from './lib/time.js';
import { normaliseAddress } from './quelio.js';

const MINUTE = 60_000;
const SESSION_FILE = 'session.json';
const HOURS_FILE = 'hours.json';
/** The least time between two refreshes asked for by hand. */
export const MANUAL_COOLDOWN = 5 * MINUTE;
/** The first wait after a failure that may clear up on its own, doubled each time after. */
export const FIRST_BACKOFF = 15 * MINUTE;

/** Failures that will not clear up by asking again: something in the setup is wrong. */
const PERMANENT = new Set(['address', 'redirect', 'notFound', 'refused']);

export function createSession({ api, client, clock = () => new Date(), onChange = () => {} }) {
  const address = normaliseAddress(api.settings.get('apiUrl', ''));
  const interval = Math.max(60, Number(api.settings.get('refreshMinutes', 60)) || 60) * MINUTE;

  const state = {
    address,
    /** False until the kept files have been read: nothing is drawn as signed out before. */
    ready: false,
    session: null,
    hours: null,
    daysOff: [],
    lastUser: '',
    /** The last refresh that failed: { reason, at, retryAt, count }. */
    failure: null,
    busy: false,
    /** Signed out by Quelio rather than by the reader -- worth a word on screen. */
    expired: false,
  };

  // -- what was kept --------------------------------------------------------

  const thisWeek = () => isoWeek(clock());
  const lastUser = api.settings.get('lastUser', '');
  state.lastUser = typeof lastUser === 'string' ? lastUser : '';
  const off = api.settings.get('daysOff', null);
  if (off && off.week === thisWeek() && Array.isArray(off.days)) {
    state.daysOff = off.days.filter((day) => Number.isInteger(day) && day >= 0 && day < 5);
  }

  const save = (key, value) => api.settings.set(key, value).catch((err) => {
    api.log.warn(`could not keep ${key}`, err?.message ?? '');
  });

  /** A kept JSON file, or null -- for any reason, a missing file included. */
  const readFile = async (name) => {
    try {
      const blob = await api.data.read(name);
      return blob ? JSON.parse(await blob.text()) : null;
    } catch {
      return null;
    }
  };
  // Through a promise first, so even a throw that is not a rejection lands in the catch.
  const writeFile = (name, value) => Promise.resolve()
    .then(() => api.data.write(name, JSON.stringify(value)))
    .catch((err) => api.log.warn(`could not keep ${name}`, err?.message ?? ''));
  const removeFile = (name) => Promise.resolve().then(() => api.data.remove(name)).catch(() => false);

  /** Read what was kept. Called once, before anything is drawn as signed in or out. */
  const load = async () => {
    const [kept, hours] = await Promise.all([readFile(SESSION_FILE), readFile(HOURS_FILE)]);
    // A token belongs to the server that issued it: once the address in the
    // settings moves, it is a token for somewhere else.
    if (kept && typeof kept.token === 'string' && kept.token && typeof kept.username === 'string'
        && address && kept.server === address) {
      state.session = { server: kept.server, username: kept.username, token: kept.token };
    }
    if (state.session && hours && hours.week === thisWeek() && hours.days && typeof hours.fetchedAt === 'number') {
      state.hours = hours;
    }
    state.ready = true;
    onChange();
  };

  // -- reading Quelio's answer ---------------------------------------------

  /** Keep an answer: this week's days, its objective, and the anchor for today. */
  const keep = (data, startedAt, answeredAt) => {
    const today = dayKey(answeredAt);
    const day = data.days[today];
    const offset = day
      ? anchorOffset(day.badges, day.paid, minutesOf(startedAt), minutesOf(answeredAt))
      : 0;
    state.hours = {
      week: isoWeek(answeredAt),
      fetchedAt: answeredAt.getTime(),
      objective: data.objective,
      objectiveReported: data.objectiveReported,
      days: data.days,
      offset: { day: today, minutes: offset },
    };
    void writeFile(HOURS_FILE, state.hours);
  };

  const forget = async ({ keepUser }) => {
    state.session = null;
    state.hours = null;
    state.failure = null;
    if (!keepUser) state.lastUser = '';
    await Promise.all([
      removeFile(SESSION_FILE),
      removeFile(HOURS_FILE),
      ...(keepUser ? [] : [save('lastUser', '')]),
    ]);
  };

  // -- the network ----------------------------------------------------------

  let inFlight = null;
  let lastAttempt = 0;

  const fail = (reason, extra = {}) => {
    const at = clock().getTime();
    const count = (state.failure?.reason === reason ? state.failure.count : 0) + 1;
    let retryAt;
    if (PERMANENT.has(reason)) retryAt = Infinity;
    else if (reason === 'rateLimited') retryAt = at + Math.max(60, extra.retryAfter ?? 300) * 1000;
    else retryAt = at + Math.min(interval, FIRST_BACKOFF * 2 ** (count - 1));
    state.failure = { reason, at, retryAt, count, ...extra };
  };

  /**
   * Ask Quelio now. One request at a time: a second caller is handed the one
   * already on its way rather than a second sign-in to Kelio.
   */
  const refresh = () => {
    if (inFlight) return inFlight;
    if (!state.session || !state.address) return Promise.resolve(false);
    const session = state.session;
    inFlight = (async () => {
      state.busy = true;
      onChange();
      const startedAt = clock();
      lastAttempt = startedAt.getTime();
      const outcome = await client.refresh(state.address, session);
      // Signed out, or signed in as somebody else, while this was travelling.
      if (state.session !== session) return false;
      if (outcome.ok) {
        if (outcome.data.token && outcome.data.token !== session.token) {
          state.session = { ...session, token: outcome.data.token };
          void writeFile(SESSION_FILE, state.session);
        }
        keep(outcome.data, startedAt, clock());
        state.failure = null;
        state.expired = false;
        return true;
      }
      if (outcome.reason === 'expired') {
        // Quelio has already dropped the token; asking with it again would
        // only be refused again, so the session ends here and nothing retries.
        state.expired = true;
        await forget({ keepUser: true });
        return false;
      }
      fail(outcome.reason, outcome.retryAfter ? { retryAfter: outcome.retryAfter } : {});
      return false;
    })().finally(() => {
      inFlight = null;
      state.busy = false;
      onChange();
    });
    return inFlight;
  };

  /**
   * Whether what is held can still change today. Not once it was read after
   * the latest departure, nor at the weekend once it was read after the week
   * ended: no badge can arrive, and every question would be a sign-in to Kelio
   * for an answer already known.
   */
  const settled = () => {
    const read = new Date(state.hours.fetchedAt);
    const weekday = weekdayOf(read);
    if (weekdayOf(clock()) >= 5) return isoWeek(read) === thisWeek() && weekday >= 5;
    return minutesOf(read) >= SCHEDULE.leaveBy[weekday];
  };

  /** Whether the periodic check should ask now: stale, and not waiting out a failure. */
  const due = () => {
    if (!state.ready || !state.session || !state.address || inFlight) return false;
    const now = clock().getTime();
    if (state.failure && now < state.failure.retryAt) return false;
    if (!state.hours) return true;
    // A new day is a new set of badges whatever the interval says.
    if (dayKey(new Date(state.hours.fetchedAt)) !== dayKey(clock())) return true;
    if (settled()) return false;
    return now - state.hours.fetchedAt >= interval;
  };

  /** How long before a refresh by hand is allowed, in ms; 0 when it is. */
  const manualWait = () => {
    if (!state.session || !state.address) return Infinity;
    const now = clock().getTime();
    if (state.failure?.reason === 'rateLimited' && now < state.failure.retryAt) return state.failure.retryAt - now;
    return Math.max(0, lastAttempt + MANUAL_COOLDOWN - now);
  };

  return {
    state,
    interval,
    load,
    due,
    manualWait,
    refresh,

    /** The periodic check: costs nothing unless a refresh is due. */
    tick() {
      if (due()) void refresh();
    },

    /** A refresh asked for by hand, held to the cooldown. */
    refreshNow() {
      if (manualWait() > 0) return Promise.resolve(false);
      // Asked for by a person: a failure that was waiting for its retry is
      // tried again, a permanent one included -- they may just have fixed it.
      state.failure = null;
      return refresh();
    },

    /**
     * Sign in, keep the token, drop the password.
     *
     * The password is a parameter and nothing else: it is not stored, not
     * logged, and not put anywhere a later read could find it. `typedAddress`
     * is for a first sign-in with no address in the settings yet; it is
     * written to the setting before the request, since the loader allows only
     * what the settings file holds.
     */
    async signIn(username, password, typedAddress) {
      if (state.busy) return { ok: false, reason: 'busy' };
      let target = state.address;
      if (typedAddress !== undefined && typedAddress !== null && typedAddress !== '') {
        target = normaliseAddress(typedAddress);
        if (!target) return { ok: false, reason: 'address' };
        if (target !== state.address) {
          await api.settings.set('apiUrl', target);
          state.address = target;
        }
      }
      if (!target) return { ok: false, reason: 'address' };
      const name = String(username ?? '').trim();
      if (!name || !password) return { ok: false, reason: 'empty' };

      state.busy = true;
      onChange();
      try {
        const startedAt = clock();
        lastAttempt = startedAt.getTime();
        const outcome = await client.signIn(target, name, password);
        if (!outcome.ok) return outcome;
        if (!outcome.data.token) return { ok: false, reason: 'malformed' };
        state.session = { server: target, username: name, token: outcome.data.token };
        state.lastUser = name;
        state.failure = null;
        state.expired = false;
        await Promise.all([writeFile(SESSION_FILE, state.session), save('lastUser', name)]);
        keep(outcome.data, startedAt, clock());
        return { ok: true };
      } finally {
        state.busy = false;
        onChange();
      }
    },

    /** Forget the token, this week's hours and who signed in. */
    async signOut() {
      state.expired = false;
      await forget({ keepUser: false });
      onChange();
    },

    /** Mark a day of this week as not worked, or as worked again. */
    toggleDayOff(index) {
      const set = new Set(state.daysOff);
      if (set.has(index)) set.delete(index);
      else set.add(index);
      state.daysOff = [...set].sort();
      void save('daysOff', { week: thisWeek(), days: state.daysOff });
      onChange();
    },
  };
}
