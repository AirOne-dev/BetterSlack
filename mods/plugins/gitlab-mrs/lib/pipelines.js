// Which pipeline is worth a word in the top bar, and which are the latest.

import { newestPipelineFirst } from './model.js';
import { isActive } from './status.js';

/**
 * Every pipeline of every merge request followed, as `{ mr, pipeline }`,
 * newest first. A merge request that was pushed to three times has three of
 * them; `latest` is what keeps the newest of each branch.
 */
export function allPipelines(mergeRequests, pipelinesOf) {
  const out = [];
  for (const mr of mergeRequests) {
    for (const pipeline of pipelinesOf(mr)) out.push({ mr, pipeline });
  }
  return out.sort((a, b) => newestPipelineFirst(a.pipeline, b.pipeline));
}

/**
 * The one the top bar shows: the newest pipeline that is still going; with
 * none going, the newest one there is, so the bar stays worth looking at.
 * `manual` is not going -- it waits for a person.
 */
export function pickHeadline(entries) {
  return entries.find((entry) => isActive(entry.pipeline.status)) ?? entries[0] ?? null;
}

/**
 * The pipelines the popover lists: the newest pipeline of each branch, for the
 * `count` branches with the most recent one -- so the last three branches worked
 * on, not three pipelines of the one branch somebody pushed to three times.
 *
 * A branch is a project's source branch: two merge requests from the same
 * branch of one project are one branch, and the same name in another project is
 * another. `entries` come newest first, so the first of each branch is its newest.
 */
export function latest(entries, count = 3) {
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    const key = `${entry.mr.projectId}:${entry.mr.sourceBranch || `mr-${entry.mr.id}`}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
    if (out.length === count) break;
  }
  return out;
}

/**
 * A merge request's head pipeline -- the newest -- for the row.
 */
export const headOf = (pipelines) => [...pipelines].sort(newestPipelineFirst)[0] ?? null;
