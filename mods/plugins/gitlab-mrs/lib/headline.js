// What the top bar says, as data: the state in, one small object out.
//
// The bar draws it and the popover lists more of the same, so the choice of
// *which* pipeline and *what* is said about it is made here, away from the DOM.

import { allPipelines, latest, pickHeadline } from './pipelines.js';
import { currentStage, failedJob, groupStages, progressOf } from './stages.js';
import { kindOf, toneOf } from './status.js';
import { groupByProject } from './model.js';

/** One pipeline, with everything a screen says about it. */
export function describePipeline({ mr, pipeline }, state) {
  const jobs = state.jobs[pipeline.id]?.jobs ?? null;
  const stages = jobs ? groupStages(jobs) : [];
  const progress = jobs ? progressOf(jobs) : null;
  const failed = failedJob(stages);
  const groups = groupByProject([mr], state.projects);
  return {
    mr,
    pipeline,
    projectName: groups[0].name,
    status: pipeline.status,
    tone: toneOf(pipeline.status),
    hydrated: Boolean(jobs),
    stages,
    progress,
    stage: currentStage(stages),
    failedJob: kindOf(pipeline.status) === 'failed' ? failed : null,
  };
}

/**
 * The top bar's phase, and the pipeline it shows.
 *
 * - `signedOut` / `invalid`: nothing to show but the way in.
 * - `loading`: signed in, nothing known yet.
 * - `empty`: asked, and there is no open merge request.
 * - `ready`: with `headline` (null when there are merge requests and no pipeline).
 * - `stale` is set when the numbers are the last known and GitLab could not be reached.
 */
export function buildHeadline(state) {
  if (!state.ready) return { phase: 'loading', stale: false };
  if (state.invalid) return { phase: 'invalid' };
  if (!state.signedIn) return { phase: 'signedOut' };
  const known = state.fetchedAt > 0 || state.mergeRequests.length > 0;
  if (!known) return { phase: 'loading', stale: false };
  const stale = Boolean(state.failure);
  if (state.mergeRequests.length === 0) return { phase: 'empty', stale };
  // Only the pipelines the bar says something about are described: the one it
  // shows and the latest three, not every pipeline of every merge request.
  const entries = allPipelines(state.mergeRequests, (mr) => state.pipelines[mr.id]?.list ?? []);
  const described = new Map();
  const describe = (entry) => {
    if (!described.has(entry)) described.set(entry, describePipeline(entry, state));
    return described.get(entry);
  };
  const picked = pickHeadline(entries);
  return {
    phase: 'ready',
    stale,
    headline: picked ? describe(picked) : null,
    recent: latest(entries).map(describe),
    count: state.mergeRequests.length,
  };
}

/** How many pipelines are failing right now, across the merge requests, for the rail's badge. */
export function failingCount(state) {
  let count = 0;
  for (const mr of state.mergeRequests) {
    const head = state.pipelines[mr.id]?.list?.[0];
    if (head && kindOf(head.status) === 'failed') count += 1;
  }
  return count;
}

/** One pipeline by id, described, wherever it is among the merge requests followed. */
export function findPipeline(state, pipelineId) {
  for (const mr of state.mergeRequests) {
    const pipeline = (state.pipelines[mr.id]?.list ?? []).find((candidate) => candidate.id === pipelineId);
    if (pipeline) return describePipeline({ mr, pipeline }, state);
  }
  return null;
}
