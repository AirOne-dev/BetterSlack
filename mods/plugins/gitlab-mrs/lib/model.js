// Merge requests, projects and pipelines as the screens want them.
//
// GitLab's answers are wide and shaped for its own pages. These functions keep
// the handful of fields a screen draws, and decide how they are put in order.
// Nothing here knows about the network or the DOM.

/** The address in `value` only if it is one of the instance's own https pages. */
export function ownUrl(value, base) {
  if (typeof value !== 'string' || typeof base !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === new URL(base).origin ? url.href : null;
  } catch {
    return null;
  }
}

const time = (iso) => {
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : 0;
};
export { time as timeOf };

/** "dating/vision!1658" -> "dating/vision", the project's path from a reference. */
const pathFromReference = (reference) => (typeof reference === 'string' ? reference.replace(/!\d+$/, '') : '');

/** "portals-builder" -> "Portals Builder": what to call a project before GitLab has said. */
export function prettyName(segment) {
  return String(segment ?? '')
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

export function normaliseMergeRequest(raw, base) {
  if (!raw || typeof raw !== 'object') return null;
  const id = Number(raw.id);
  const iid = Number(raw.iid);
  const projectId = Number(raw.project_id);
  if (![id, iid, projectId].every(Number.isFinite) || typeof raw.title !== 'string') return null;
  return {
    id,
    iid,
    projectId,
    title: raw.title.replace(/^\s*(draft|wip)\s*:\s*/i, ''),
    draft: raw.draft === true || raw.work_in_progress === true || /^\s*(draft|wip)\s*:/i.test(raw.title),
    sourceBranch: typeof raw.source_branch === 'string' ? raw.source_branch : '',
    targetBranch: typeof raw.target_branch === 'string' ? raw.target_branch : '',
    createdAt: typeof raw.created_at === 'string' ? raw.created_at : '',
    updatedAt: typeof raw.updated_at === 'string' ? raw.updated_at : '',
    sha: typeof raw.sha === 'string' ? raw.sha : '',
    webUrl: ownUrl(raw.web_url, base),
    path: pathFromReference(raw.references?.full),
  };
}

export function normaliseProject(raw, base) {
  if (!raw || typeof raw !== 'object' || !Number.isFinite(Number(raw.id))) return null;
  return {
    id: Number(raw.id),
    name: typeof raw.name === 'string' ? raw.name : '',
    path: typeof raw.path_with_namespace === 'string' ? raw.path_with_namespace : '',
    webUrl: ownUrl(raw.web_url, base),
  };
}

export function normalisePipeline(raw, projectId, mergeRequestId, base) {
  if (!raw || typeof raw !== 'object' || !Number.isFinite(Number(raw.id))) return null;
  return {
    id: Number(raw.id),
    projectId,
    mergeRequestId,
    status: typeof raw.status === 'string' ? raw.status : 'created',
    createdAt: typeof raw.created_at === 'string' ? raw.created_at : '',
    updatedAt: typeof raw.updated_at === 'string' ? raw.updated_at : '',
    sha: typeof raw.sha === 'string' ? raw.sha : '',
    webUrl: ownUrl(raw.web_url, base),
  };
}

/** Newest first; the id breaks a tie, since GitLab numbers pipelines as it makes them. */
export const newestPipelineFirst = (a, b) => time(b.createdAt) - time(a.createdAt) || b.id - a.id;

/**
 * Group merge requests by project, most recently touched project first.
 *
 * A project's place is that of its newest merge request -- `max(updatedAt)` --
 * and inside a project the merge requests are newest first too. The namespace
 * is secondary information: it is only there so two projects of the same name
 * in different groups are not the same heading.
 */
export function groupByProject(mergeRequests, projects = {}) {
  const groups = new Map();
  for (const mr of mergeRequests) {
    if (!groups.has(mr.projectId)) groups.set(mr.projectId, []);
    groups.get(mr.projectId).push(mr);
  }
  const out = [];
  for (const [projectId, own] of groups) {
    own.sort((a, b) => time(b.updatedAt) - time(a.updatedAt) || b.iid - a.iid);
    const known = projects[projectId];
    const path = known?.path || own[0].path;
    const segments = path.split('/').filter(Boolean);
    out.push({
      projectId,
      name: known?.name || prettyName(segments.at(-1)),
      namespace: segments.slice(0, -1).join(' / '),
      webUrl: known?.webUrl ?? null,
      latest: time(own[0].updatedAt),
      mergeRequests: own,
    });
  }
  return out.sort((a, b) => b.latest - a.latest || a.name.localeCompare(b.name));
}
