// Who is signed in, what GitLab last said, and when to ask again.
//
// No DOM here and no GitLab URLs: the client does the asking, the screens do
// the drawing, and this is what holds the answers between them.
//
// Where each thing is kept, and why there:
//
//   the token     the loader (`api.net.setCredential`). Not here, not in
//                 settings, not in a file of this plugin: the page cannot read
//                 it back, and it is only ever sent to the address it was given
//                 for. `api.net.hasCredential()` is all this knows of it.
//   api.data      session.json   { server, user }   who the token belongs to
//                 snapshot.json  the last answers, bounded and dated, so a
//                                restart draws at once instead of waiting
//   api.settings  gitUrl         the address -- a setting, because the loader
//                                checks every request against it
//
// The cache is api.data rather than `helpers.cache`: that one is written
// through settings.json, which is copied whole into every backup, and these are
// the titles of somebody's merge requests.
//
// A refresh is progressive. The list of merge requests is drawn the moment it
// arrives; project names, then each merge request's pipelines, then the jobs of
// the pipelines worth drawing, fill in behind it. One at a time -- a second
// ask while one is travelling is handed the same one -- and at most four
// requests at once, which the client enforces.

import { isActive } from './lib/status.js';
import { due, pipelinesDue } from './lib/schedule.js';
import { restore, snapshotOf } from './lib/snapshot.js';
import { allPipelines, headOf, latest } from './lib/pipelines.js';
import { normaliseServer } from './api/gitlab.js';

const SESSION_FILE = 'session.json';
const SNAPSHOT_FILE = 'snapshot.json';
const SAVE_EVERY_MS = 5_000;
const PROJECT_TTL_MS = 24 * 60 * 60 * 1000;
/** Jobs asked for per round: the rest wait for the next, rather than 100 requests at once. */
const JOBS_PER_ROUND = 30;

const jobsKey = (pipeline) => `${pipeline.status}|${pipeline.updatedAt}`;

export function createStore({ api, client, clock = () => Date.now(), onChange = () => {} }) {
  const server = normaliseServer(api.settings.get('gitUrl', ''));

  const state = {
    server,
    /** False until what was kept has been read: nothing is drawn as signed out before. */
    ready: false,
    signedIn: false,
    /** The token was refused: signed out, and the screen says why. */
    invalid: false,
    user: null,
    lastUser: '',
    mergeRequests: [],
    projects: {},
    /** { [mergeRequestId]: { list, active, sha, mrUpdatedAt, checkedAt, error } } */
    pipelines: {},
    /** { [pipelineId]: { key, jobs } } */
    jobs: {},
    fetchedAt: 0,
    busy: false,
    /** { reason, at, count } for the last round that failed; null once one succeeds. */
    failure: null,
    /** The list was cut short: 'pagination' or a reason a later page failed. */
    partial: null,
    viewOpen: false,
    /** Pipelines whose jobs are still to be asked for. */
    backlog: false,
  };

  let disposed = false;
  /*
   * Which sign-in the answers belong to. A round that was travelling when the
   * session ended -- signing out, a refused token -- must not write what it
   * brings back into a state that has been cleared: the next account to sign in
   * would be shown the last one's merge requests. Every step compares the number
   * it started under with this one after each wait.
   */
  let epoch = 0;
  let inFlight = null;
  let lastFull = 0;
  let lastPulse = 0;
  let lastFailure = 0;
  let failures = 0;
  let lastSave = 0;
  let saving = null;

  const notify = () => { if (!disposed) onChange(); };

  // -- what was kept ---------------------------------------------------------

  const readFile = async (name) => {
    try {
      const blob = await api.data.read(name);
      return blob ? JSON.parse(await blob.text()) : null;
    } catch {
      return null;
    }
  };
  const writeFile = (name, value) => Promise.resolve()
    .then(() => api.data.write(name, JSON.stringify(value)))
    .catch((err) => api.log.warn(`could not keep ${name}`, err?.message ?? ''));
  const removeFile = (name) => Promise.resolve().then(() => api.data.remove(name)).catch(() => false);

  const save = (force = false) => {
    if (!state.signedIn || !state.user) return;
    const now = clock();
    if (!force && now - lastSave < SAVE_EVERY_MS) return;
    lastSave = now;
    saving = writeFile(SNAPSHOT_FILE, snapshotOf(state, now));
  };

  /** Read what was kept, once, before anything decides whether somebody is signed in. */
  async function load() {
    const [session, snapshot, held] = await Promise.all([
      readFile(SESSION_FILE),
      readFile(SNAPSHOT_FILE),
      Promise.resolve(api.net.hasCredential()).catch(() => false),
    ]);
    if (disposed) return;
    if (typeof session?.lastUser === 'string') state.lastUser = session.lastUser;
    // A token belongs to the server it was given for: with another address in
    // the settings, `hasCredential` is already false.
    if (held && server) {
      state.signedIn = true;
      if (session?.server === server && Number.isFinite(session.user?.id)) {
        state.user = session.user;
        const kept = restore(snapshot, { server, userId: state.user.id, now: clock() });
        if (kept) Object.assign(state, kept);
      }
    }
    state.ready = true;
    notify();
  }

  const keepSession = () => writeFile(SESSION_FILE, {
    server,
    user: state.user,
    lastUser: state.lastUser,
  });

  // -- signing in and out ----------------------------------------------------

  /**
   * Sign in with a token for `address`.
   *
   * The token is an argument and goes nowhere but `setCredential`. It is not
   * logged, not put in an address, not written to a setting, and no outcome
   * carries it. If the server does not accept it, the loader is told to forget
   * it again at once.
   */
  async function signIn(address, token) {
    const base = normaliseServer(address);
    if (!base) return { ok: false, reason: 'address' };
    if (typeof token !== 'string' || !/^[\x21-\x7e]{8,4096}$/.test(token.trim())) return { ok: false, reason: 'tokenFormat' };
    const secret = token.trim();

    // The loader checks every request against the address in the settings, so
    // the setting has to hold it before the first request is made.
    try {
      await api.settings.set('gitUrl', base);
    } catch {
      return { ok: false, reason: 'blocked' };
    }
    const stored = await api.net.setCredential(secret, base);
    if (!stored.ok) return { ok: false, reason: 'blocked' };

    const asked = await client.user();
    if (!asked.ok) {
      // Never leave a secret the server has not accepted.
      await api.net.clearCredential();
      return { ok: false, reason: asked.reason };
    }
    epoch += 1;
    state.server = base;
    state.user = asked.user;
    state.lastUser = asked.user.username;
    state.signedIn = true;
    state.invalid = false;
    state.failure = null;
    failures = 0;
    await keepSession();
    notify();
    void refresh({ force: true });
    return { ok: true, user: asked.user };
  }

  /** Forget the token, the cache and who it was, on this machine. */
  async function signOut() {
    epoch += 1;
    state.signedIn = false;
    state.invalid = false;
    state.user = null;
    state.lastUser = '';
    reset();
    await Promise.all([api.net.clearCredential(), removeFile(SESSION_FILE), removeFile(SNAPSHOT_FILE)]);
    notify();
  }

  /** The server refused the token: the loader forgets it, and so does the cache. */
  async function expire() {
    epoch += 1;
    state.signedIn = false;
    state.invalid = true;
    state.lastUser = state.user?.username ?? state.lastUser;
    state.user = null;
    reset();
    await Promise.all([api.net.clearCredential(), removeFile(SNAPSHOT_FILE)]);
    await writeFile(SESSION_FILE, { server, user: null, lastUser: state.lastUser });
    notify();
  }

  function reset() {
    state.mergeRequests = [];
    state.projects = {};
    state.pipelines = {};
    state.jobs = {};
    state.fetchedAt = 0;
    state.failure = null;
    state.partial = null;
    failures = 0;
  }

  // -- asking ----------------------------------------------------------------

  const fail = (reason) => {
    failures += 1;
    lastFailure = clock();
    state.failure = { reason, at: lastFailure, count: failures };
  };
  const succeed = () => {
    failures = 0;
    state.failure = null;
  };

  /** Run `work` over `items` with the client's own concurrency, stopping on a refused token. */
  const each = async (items, work) => {
    let refused = false;
    await Promise.all(items.map(async (item) => {
      if (refused || disposed) return;
      if ((await work(item)) === 'unauthorized') refused = true;
    }));
    return refused;
  };

  async function readMergeRequests() {
    const mine = epoch;
    const result = await client.mergeRequests(state.user.id);
    if (mine !== epoch) return 'stale';
    if (!result.ok) {
      if (result.reason === 'unauthorized') { await expire(); return 'unauthorized'; }
      fail(result.reason);
      return 'failed';
    }
    // Newest touched first: the order the server gave, which grouping re-sorts anyway.
    state.mergeRequests = result.items;
    state.partial = result.partial;
    state.fetchedAt = clock();
    // A merge request closed between two rounds takes its pipelines with it.
    const open = new Set(result.items.map((mr) => mr.id));
    for (const id of Object.keys(state.pipelines)) if (!open.has(Number(id))) delete state.pipelines[id];
    succeed();
    notify();
    return 'ok';
  }

  async function readProjects() {
    const now = clock();
    const missing = [...new Set(state.mergeRequests.map((mr) => mr.projectId))]
      .filter((id) => !state.projects[id] || now - state.projects[id].fetchedAt > PROJECT_TTL_MS);
    const mine = epoch;
    return each(missing, async (id) => {
      const result = await client.project(id);
      if (mine !== epoch) return 'stale';
      if (result.ok) {
        state.projects[id] = { ...result.project, fetchedAt: clock() };
        notify();
        return 'ok';
      }
      // A name is a nicety: the path says it already. Keep an empty entry,
      // dated so that it expires in five minutes rather than a day, so it is
      // not asked for again every round.
      if (result.reason === 'unauthorized') return 'unauthorized';
      if (!state.projects[id]) {
        state.projects[id] = { id, name: '', path: '', webUrl: null, fetchedAt: clock() - PROJECT_TTL_MS + 5 * 60_000 };
      }
      return 'failed';
    });
  }

  async function readPipelines({ force, pulse }) {
    const now = clock();
    const targets = state.mergeRequests.filter((mr) => {
      const known = state.pipelines[mr.id];
      if (pulse) return known?.active;
      return pipelinesDue({ known, mr, now, force });
    });
    const mine = epoch;
    return each(targets, async (mr) => {
      const result = await client.pipelines(mr.projectId, mr);
      if (mine !== epoch) return 'stale';
      const known = state.pipelines[mr.id];
      if (result.ok) {
        const list = result.pipelines.slice(0, 3);
        state.pipelines[mr.id] = {
          list,
          active: list.some((pipeline) => isActive(pipeline.status)),
          sha: mr.sha,
          mrUpdatedAt: mr.updatedAt,
          checkedAt: clock(),
          error: null,
        };
      } else if (result.reason === 'unauthorized') {
        return 'unauthorized';
      } else {
        // One merge request failing is that row's problem: its last known
        // pipelines stay, and it says so.
        state.pipelines[mr.id] = { list: [], active: false, sha: '', mrUpdatedAt: '', ...known, checkedAt: clock(),
          error: result.reason === 'notFound' || result.reason === 'forbidden' ? 'inaccessible' : result.reason };
      }
      notify();
      return 'ok';
    });
  }

  /** Which pipelines are worth their jobs, most worth it first. */
  function wantedJobs() {
    const entries = allPipelines(state.mergeRequests, (mr) => state.pipelines[mr.id]?.list ?? []);
    const heads = state.mergeRequests.map((mr) => headOf(state.pipelines[mr.id]?.list ?? [])).filter(Boolean);
    const ordered = [
      ...entries.filter((entry) => isActive(entry.pipeline.status)).map((entry) => entry.pipeline),
      ...latest(entries).map((entry) => entry.pipeline),
      ...heads,
    ];
    const seen = new Set();
    return ordered.filter((pipeline) => !seen.has(pipeline.id) && seen.add(pipeline.id));
  }

  async function readJobs() {
    const wanted = wantedJobs();
    const missing = wanted.filter((pipeline) => state.jobs[pipeline.id]?.key !== jobsKey(pipeline));
    const stale = missing.slice(0, JOBS_PER_ROUND);
    // The rest are asked for on the next beat rather than all at once.
    state.backlog = missing.length > stale.length;
    const mine = epoch;
    const refused = await each(stale, async (pipeline) => {
      const result = await client.jobs(pipeline.projectId, pipeline.id);
      if (mine !== epoch) return 'stale';
      if (result.ok) {
        state.jobs[pipeline.id] = { key: jobsKey(pipeline), jobs: result.jobs };
        notify();
        return 'ok';
      }
      // A pipeline deleted since, or one this token may not read: it is drawn
      // as a status with no stages rather than not at all.
      return result.reason === 'unauthorized' ? 'unauthorized' : 'failed';
    });
    if (mine !== epoch) return false;
    // Jobs of pipelines nothing refers to any more are not kept.
    const keep = new Set(wanted.map((pipeline) => pipeline.id));
    for (const id of Object.keys(state.jobs)) if (!keep.has(Number(id))) delete state.jobs[id];
    return refused;
  }

  /**
   * Ask GitLab now. One round at a time: a caller arriving while one is
   * travelling is handed that one.
   *
   * `pulse` asks about the pipelines that are going and nothing else; `force`
   * is a person pressing refresh, which looks at everything again.
   */
  function refresh({ force = false, pulse = false } = {}) {
    if (inFlight) return inFlight;
    if (!state.signedIn) return Promise.resolve(false);
    inFlight = (async () => {
      state.busy = true;
      const started = clock();
      if (pulse) lastPulse = started; else { lastFull = started; lastPulse = started; }
      notify();
      try {
        const mine = epoch;
        if (!state.user) {
          const who = await client.user();
          if (mine !== epoch) return false;
          if (!who.ok) {
            if (who.reason === 'unauthorized') await expire(); else fail(who.reason);
            return false;
          }
          state.user = who.user;
          state.lastUser = who.user.username;
          await keepSession();
        }
        if (!pulse) {
          const outcome = await readMergeRequests();
          if (outcome !== 'ok') return false;
          if (await readProjects()) { await expire(); return false; }
        }
        if (await readPipelines({ force, pulse })) { await expire(); return false; }
        if (await readJobs()) { await expire(); return false; }
        save();
        return true;
      } finally {
        inFlight = null;
        state.busy = false;
        notify();
      }
    })();
    return inFlight;
  }

  /** The heartbeat: asks only when it is time. */
  function tick() {
    const now = clock();
    const anyActive = Object.values(state.pipelines).some((entry) => entry.active);
    const what = due({ now, lastFull, lastPulse, anyActive, backlog: state.backlog, viewOpen: state.viewOpen, failures, lastFailure,
      signedIn: state.signedIn && !inFlight });
    if (!what) return Promise.resolve(false);
    return refresh({ pulse: what === 'pulse' });
  }

  return {
    state,
    load,
    signIn,
    signOut,
    refresh,
    tick,
    setViewOpen(open) {
      if (state.viewOpen === open) return;
      state.viewOpen = open;
      // Opening the view is somebody looking: if the data is older than a
      // pulse's worth, bring it up to date now instead of at the next beat.
      if (open && state.signedIn && !inFlight) {
        const age = clock() - lastFull;
        if (age > 60_000) void refresh();
        else if (age > 10_000 && Object.values(state.pipelines).some((entry) => entry.active)) void refresh({ pulse: true });
      }
    },
    /** Written out before the plugin goes, whatever the debounce says. */
    async flush() { save(true); await saving; },
    dispose() { disposed = true; },
  };
}
