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
//   api.data      session.json   { server, username, token }
//                 hours.json     this week's days and when they were read, so a
//                                restart draws at once instead of waiting on Kelio
//                 throttle.json  when Quelio was last asked, and the failure being
//                                waited out -- so a reload does not ask again at once
//   api.settings  lastUser       the name to put back in the sign-in form
//                 daysOff        which days of this week are off, whole or afternoon
//
// The password itself is never stored. The token is not harmless for that:
// quelio-api builds it from the username, the password encrypted with the
// server's key, and an unsalted hash of the password, so whoever holds the
// token holds the password in a recoverable form. It is a file of this
// plugin's own rather than a setting because settings.json travels: it is
// copied whole into every BetterSlack backup, embedded in the script that
// starts every page, and sent to every window whenever any mod changes
// anything. The data folder does none of that, but it is still a plain,
// unencrypted file -- ~/.betterslack/data/quelio/ -- to be protected like the
// password. Signing out deletes it; removing the plugin does not.

import { anchorOffset } from './lib/day.js';
import { DEFAULT_RULES, dayRules } from './lib/rules.js';
import { dayKey, isoWeek, minutesOf, weekdayOf } from './lib/time.js';
import { normaliseAddress } from './quelio.js';

const MINUTE = 60_000;
const SESSION_FILE = 'session.json';
const HOURS_FILE = 'hours.json';
const THROTTLE_FILE = 'throttle.json';
/** The least time between two refreshes asked for by hand -- or, after a reload, between any two. */
export const MANUAL_COOLDOWN = 5 * MINUTE;
/** How long before the counted day starts the periodic check begins asking. */
export const WINDOW_LEAD = 30;
/** The first wait after a failure that may clear up on its own, doubled each time after. */
export const FIRST_BACKOFF = 15 * MINUTE;

/** Failures that will not clear up by asking again: something in the setup is wrong. */
const PERMANENT = new Set(['address', 'redirect', 'notFound', 'refused']);

export function createSession({ api, client, rules = DEFAULT_RULES, clock = () => new Date(), onChange = () => {} }) {
  const address = normaliseAddress(api.settings.get('apiUrl', ''));
  const interval = Math.max(60, Number(api.settings.get('refreshMinutes', 60)) || 60) * MINUTE;

  const state = {
    address,
    /** False until the kept files have been read: nothing is drawn as signed out before. */
    ready: false,
    session: null,
    hours: null,
    daysOff: [],
    /** Days of this week whose afternoon is off. */
    afternoonsOff: [],
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
  const weekdays = (list) => (Array.isArray(list)
    ? [...new Set(list.filter((day) => Number.isInteger(day) && day >= 0 && day < 5))].sort()
    : []);
  if (off && off.week === thisWeek()) {
    state.daysOff = weekdays(off.days);
    state.afternoonsOff = weekdays(off.afternoons).filter((day) => !state.daysOff.includes(day));
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

  const usable = (hours) => Boolean(hours && hours.week === thisWeek() && hours.days
    && typeof hours.fetchedAt === 'number');

  /** Read what was kept. Called once, before anything is drawn as signed in or out. */
  const load = async () => {
    const [kept, hours, throttle] = await Promise.all([
      readFile(SESSION_FILE), readFile(HOURS_FILE), readFile(THROTTLE_FILE),
    ]);
    readThrottle(throttle);
    // A token belongs to the server that issued it: once the address in the
    // settings moves, it is a token for somewhere else.
    if (kept && typeof kept.token === 'string' && kept.token && typeof kept.username === 'string'
        && address && kept.server === address) {
      state.session = { server: kept.server, username: kept.username, token: kept.token };
    }
    if (state.session && usable(hours)) state.hours = hours;
    state.ready = true;
    onChange();
  };

  // -- reading Quelio's answer ---------------------------------------------

  /** Keep an answer: this week's days, its objective, and the anchor for today. */
  const keep = (data, startedAt, answeredAt) => {
    const today = dayKey(answeredAt);
    const day = data.days[today];
    const offset = day
      ? anchorOffset(day.badges, day.paid, minutesOf(startedAt), minutesOf(answeredAt),
        dayRules(rules, weekdayOf(answeredAt)))
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
      // When Quelio was last asked stays: it is about Kelio, not about who.
      saveThrottle(),
      ...(keepUser ? [] : [save('lastUser', '')]),
    ]);
  };

  // -- the network ----------------------------------------------------------

  let inFlight = null;
  let lastAttempt = 0;
  /** The last attempt this instance made itself, to tell it from one read off the disk. */
  let ownAttempt = 0;

  /*
   * When Quelio was last asked, and the failure being waited out, outlive the
   * instance: a change of settings, a hot reload or switching the plugin off
   * and on starts a new one, and without these it would ask at once -- after a
   * 429 too. `retryAt` is null for a failure only a person can clear, since
   * JSON has no Infinity; a failure from another server is not this one's.
   */
  function readThrottle(kept) {
    if (!kept || typeof kept !== 'object') return;
    if (Number.isFinite(kept.lastAttempt) && kept.lastAttempt > lastAttempt) lastAttempt = kept.lastAttempt;
    const failure = kept.failure;
    if (failure && typeof failure.reason === 'string' && kept.server === address && Number.isFinite(failure.at)) {
      state.failure = {
        ...failure,
        retryAt: Number.isFinite(failure.retryAt) ? failure.retryAt : Infinity,
        count: Number.isInteger(failure.count) && failure.count > 0 ? failure.count : 1,
      };
    }
  }
  const saveThrottle = () => writeFile(THROTTLE_FILE, {
    server: address,
    lastAttempt,
    failure: state.failure
      ? { ...state.failure, retryAt: Number.isFinite(state.failure.retryAt) ? state.failure.retryAt : null }
      : null,
  });
  /** Written before the request leaves, so an instance started while it travels knows. */
  const attempt = async (at) => {
    lastAttempt = at;
    ownAttempt = at;
    await saveThrottle();
  };

  const fail = (reason, extra = {}) => {
    const at = clock().getTime();
    const count = (state.failure?.reason === reason ? state.failure.count : 0) + 1;
    let retryAt;
    if (PERMANENT.has(reason)) retryAt = Infinity;
    else if (reason === 'rateLimited') retryAt = at + Math.max(60, extra.retryAfter ?? 300) * 1000;
    else retryAt = at + Math.min(interval, FIRST_BACKOFF * 2 ** (count - 1));
    state.failure = { reason, at, retryAt, count, ...extra };
    void saveThrottle();
  };
  const succeed = () => {
    if (!state.failure) return;
    state.failure = null;
    void saveThrottle();
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
      await attempt(startedAt.getTime());
      if (state.session !== session) return false;
      const outcome = await client.refresh(state.address, session);
      // Signed out, or signed in as somebody else, while this was travelling.
      if (state.session !== session) return false;
      if (outcome.ok) {
        if (outcome.data.token && outcome.data.token !== session.token) {
          state.session = { ...session, token: outcome.data.token };
          void writeFile(SESSION_FILE, state.session);
        }
        keep(outcome.data, startedAt, clock());
        succeed();
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
   * Whether the periodic check should ask now.
   *
   * Every request is a sign-in to Kelio, so it asks only while an answer can
   * have changed: on a working day, from a little before the counted day
   * starts until it ends, at most once per interval -- and once more after
   * the end, so the evening shows the departure rather than a day still
   * running. Never at night, and never at the weekend once this week is held:
   * no badge can arrive. With nothing held for this week it asks once even
   * then, so there is something to draw -- except before the window on a
   * working day, which is about to open anyway.
   *
   * Whatever the case, never while a failure is being waited out, and never
   * within the manual cooldown of the last attempt, which may be one a
   * previous instance sent and has not heard back from.
   */
  const due = () => {
    if (!state.ready || !state.session || !state.address || inFlight) return false;
    const date = clock();
    const now = date.getTime();
    if (state.failure && now < state.failure.retryAt) return false;
    if (now - lastAttempt < MANUAL_COOLDOWN) return false;
    const held = state.hours && state.hours.week === thisWeek() ? state.hours : null;
    const attemptedToday = lastAttempt > 0 && dayKey(new Date(lastAttempt)) === dayKey(date);
    const weekday = weekdayOf(date);
    if (weekday >= 5) return !held && !attemptedToday;

    const day = dayRules(rules, weekday, state.afternoonsOff.includes(weekday));
    const minute = minutesOf(date);
    if (minute < day.countFrom - WINDOW_LEAD) return false;
    const closes = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, day.leaveBy).getTime();
    if (minute < day.leaveBy) {
      if (!held || dayKey(new Date(held.fetchedAt)) !== dayKey(date)) return true;
      // Failures retry on their own schedule, which is shorter than the interval.
      return now - held.fetchedAt >= interval && (Boolean(state.failure) || now - lastAttempt >= interval);
    }
    if (!held) return !attemptedToday;
    return held.fetchedAt < closes && lastAttempt < closes;
  };

  /** How long before a refresh by hand is allowed, in ms; 0 when it is. */
  const manualWait = () => {
    if (!state.session || !state.address) return Infinity;
    const now = clock().getTime();
    if (state.failure?.reason === 'rateLimited' && now < state.failure.retryAt) return state.failure.retryAt - now;
    return Math.max(0, lastAttempt + MANUAL_COOLDOWN - now);
  };

  const saveDaysOff = () => {
    void save('daysOff', { week: thisWeek(), days: state.daysOff, afternoons: state.afternoonsOff });
    onChange();
  };

  return {
    state,
    interval,
    load,
    due,
    manualWait,
    refresh,

    /**
     * The periodic check: costs nothing unless a refresh is due.
     *
     * A request a previous instance sent just before it was replaced is
     * answered into files this one has already read; for a few minutes after
     * it, those are read again, so its answer is drawn rather than asked for
     * a second time.
     */
    async tick() {
      if (inFlight) return;
      const fetched = state.hours?.fetchedAt ?? 0;
      if (state.session && lastAttempt !== ownAttempt && lastAttempt > fetched
          && clock().getTime() - lastAttempt < 2 * MANUAL_COOLDOWN) {
        const hours = await readFile(HOURS_FILE);
        if (state.session && usable(hours) && hours.fetchedAt > fetched) {
          state.hours = hours;
          onChange();
        }
      }
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
        await attempt(startedAt.getTime());
        const outcome = await client.signIn(target, name, password);
        if (!outcome.ok) return outcome;
        if (!outcome.data.token) return { ok: false, reason: 'malformed' };
        state.session = { server: target, username: name, token: outcome.data.token };
        state.lastUser = name;
        succeed();
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
      state.afternoonsOff = state.afternoonsOff.filter((day) => !set.has(day));
      saveDaysOff();
    },

    /** Mark a day of this week as having its afternoon off, or not. */
    toggleAfternoonOff(index) {
      const set = new Set(state.afternoonsOff);
      if (set.has(index)) set.delete(index);
      else set.add(index);
      state.afternoonsOff = [...set].sort();
      state.daysOff = state.daysOff.filter((day) => !set.has(day));
      saveDaysOff();
    },
  };
}
