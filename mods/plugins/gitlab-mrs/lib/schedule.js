// When to ask GitLab again.
//
// The screen moves on its own clock and costs nothing; GitLab is asked only
// when an answer can have changed, and a person's server is not hammered:
//
//   - a pipeline that is going moves every few seconds, so its pipelines and
//     jobs are looked at often -- through a *pulse*, which asks about the
//     active pipelines and nothing else;
//   - the list of merge requests changes by hand, so it is read less often --
//     a *full* refresh;
//   - with the view open somebody is looking, so both are quicker;
//   - after a failure, longer and longer, to a ceiling.
//
// The heartbeat is `helpers.poll`, which stops while the window is hidden. This
// only answers "is it time yet", from timestamps, so it is a pure function.

const SECOND = 1000;

export const INTERVALS = {
  pulse: { open: 10 * SECOND, closed: 30 * SECOND },
  full: {
    active: { open: 60 * SECOND, closed: 2 * 60 * SECOND },
    idle: { open: 2 * 60 * SECOND, closed: 5 * 60 * SECOND },
  },
  /** The wait between two rounds of a backlog of jobs. */
  backlog: 5 * SECOND,
};
export const BACKOFF = { first: 30 * SECOND, ceiling: 15 * 60 * SECOND };

/** How long to wait after the `count`th failure in a row. */
export const backoff = (count) => Math.min(BACKOFF.ceiling, BACKOFF.first * 2 ** Math.max(0, count - 1));

/**
 * What the heartbeat should do now: 'full', 'pulse' or nothing.
 *
 * @param {{ now: number, lastFull: number, lastPulse: number, anyActive: boolean,
 *           backlog: boolean, viewOpen: boolean, failures: number, lastFailure: number, signedIn: boolean }} s
 */
export function due(s) {
  if (!s.signedIn) return null;
  if (s.failures > 0 && s.now - s.lastFailure < backoff(s.failures)) return null;
  const side = s.viewOpen ? 'open' : 'closed';
  const full = INTERVALS.full[s.anyActive ? 'active' : 'idle'][side];
  if (s.now - s.lastFull >= full) return 'full';
  if (s.anyActive && s.now - s.lastPulse >= INTERVALS.pulse[side]) return 'pulse';
  // Jobs still to ask for, after a round that was capped.
  if (s.backlog && s.now - s.lastPulse >= INTERVALS.backlog) return 'pulse';
  return null;
}

/**
 * Whether a merge request's pipelines are worth asking about again.
 *
 * One that is going always is. One that has settled cannot change by itself,
 * only when somebody pushes (the merge request's `sha` or `updated_at` moves)
 * or plays a manual job -- so it is looked at again after a while, not every
 * round. `force` is a person pressing refresh.
 */
export const SETTLED_RECHECK_MS = 10 * 60 * SECOND;
export function pipelinesDue({ known, mr, now, force }) {
  if (force || !known) return true;
  if (known.active) return true;
  if (known.sha !== mr.sha || known.mrUpdatedAt !== mr.updatedAt) return true;
  return now - known.checkedAt >= SETTLED_RECHECK_MS;
}
