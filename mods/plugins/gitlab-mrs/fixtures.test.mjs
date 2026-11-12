// A GitLab that answers the five reads this plugin makes, from plain data.
//
// Shaped like the real thing -- snake_case, `web_url`s on the instance,
// `references.full`, jobs newest id first -- so a test exercises the plugin's
// reading of GitLab's answers rather than a convenient shape of its own. It
// answers 401 to a request that carries no credential, which is what GitLab
// does and what makes a test of signing in mean something.

export const BASE = 'https://gitlab.example.com';
export const NOW = Date.parse('2026-10-02T14:30:00Z');
export const iso = (hours, minutes = 0) => new Date(Date.parse('2026-10-02T00:00:00Z') + (hours * 60 + minutes) * 60_000).toISOString();

export const PROJECTS = {
  10: { id: 10, name: 'Vision', path_with_namespace: 'dating/vision', web_url: `${BASE}/dating/vision` },
  20: { id: 20, name: 'Portals Builder', path_with_namespace: 'dating/portals-builder', web_url: `${BASE}/dating/portals-builder` },
  30: { id: 30, name: 'Vite Admin', path_with_namespace: 'apps/vite-admin', web_url: `${BASE}/apps/vite-admin` },
};

let ids = 1000;
export function mr(projectId, iid, updated, extra = {}) {
  const project = PROJECTS[projectId];
  return {
    id: ids += 1,
    iid,
    project_id: projectId,
    title: `Change ${iid}`,
    state: 'opened',
    draft: false,
    created_at: iso(1),
    updated_at: updated,
    source_branch: `feature/${iid}`,
    target_branch: 'master',
    sha: `sha-${iid}`,
    web_url: `${project.web_url}/-/merge_requests/${iid}`,
    references: { full: `${project.path_with_namespace}!${iid}` },
    ...extra,
  };
}

export function pipeline(id, projectId, status, created, extra = {}) {
  return {
    id,
    project_id: projectId,
    status,
    sha: 'abc',
    created_at: created,
    updated_at: created,
    web_url: `${PROJECTS[projectId].web_url}/-/pipelines/${id}`,
    ...extra,
  };
}

export function job(id, pipelineId, projectId, stage, name, status, extra = {}) {
  return {
    id,
    name,
    stage,
    status,
    allow_failure: false,
    duration: status === 'success' ? 42.6 : null,
    web_url: `${PROJECTS[projectId].web_url}/-/jobs/${id}`,
    ...extra,
  };
}

/**
 * @param {{ me?: object, mergeRequests?: object[], pipelines?: Record<string, object[]>,
 *           jobs?: Record<string, object[]>, projects?: object, token?: string }} data
 */
export function createGitLab(data = {}) {
  const state = {
    me: { id: 7, username: 'robin', name: 'Robin Vasquez' },
    mergeRequests: [],
    pipelines: {},
    jobs: {},
    projects: PROJECTS,
    /** Answer this status to every request, to try a failure. */
    fail: null,
    ...data,
  };
  const calls = [];
  const paged = (items, params) => {
    const per = Number(params.get('per_page') ?? 20);
    const page = Number(params.get('page') ?? 1);
    return items.slice((page - 1) * per, page * per);
  };

  const handler = async (url, options = {}) => {
    const parsed = new URL(url);
    const params = parsed.searchParams;
    calls.push({ url, path: parsed.pathname, params: Object.fromEntries(params), credential: options.credential });
    if (state.fail) return state.fail.error ? { error: state.fail.error } : { status: state.fail.status, json: { message: 'nope' } };
    if (!options.credential) return { status: 401, json: { message: '401 Unauthorized' } };
    const path = parsed.pathname.replace(/^\/api\/v4/, '');

    if (path === '/user') return { status: 200, json: state.me };
    if (path === '/merge_requests') {
      const mine = state.mergeRequests.filter((raw) => (
        raw.author_id === undefined || String(raw.author_id) === params.get('author_id')
      ) && raw.state === (params.get('state') ?? raw.state));
      mine.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
      return { status: 200, json: paged(mine, params) };
    }
    let match = /^\/projects\/(\d+)$/.exec(path);
    if (match) {
      const project = state.projects[match[1]];
      return project ? { status: 200, json: project } : { status: 404, json: { message: '404 Project Not Found' } };
    }
    match = /^\/projects\/(\d+)\/merge_requests\/(\d+)\/pipelines$/.exec(path);
    if (match) {
      const list = state.pipelines[`${match[1]}/${match[2]}`];
      return list ? { status: 200, json: paged(list, params) } : { status: 404, json: { message: '404 Not found' } };
    }
    match = /^\/projects\/(\d+)\/pipelines\/(\d+)\/jobs$/.exec(path);
    if (match) {
      const list = state.jobs[match[2]];
      // GitLab lists the newest job first.
      return list ? { status: 200, json: paged([...list].sort((a, b) => b.id - a.id), params) } : { status: 404, json: { message: '404 Not found' } };
    }
    return { status: 404, json: { message: '404 Not found' } };
  };
  return { state, calls, handler };
}
