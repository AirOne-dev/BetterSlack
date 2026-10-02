// The GitLab REST API, as far as this plugin needs it -- five reads.
//
//   GET /user                                          who the token belongs to
//   GET /merge_requests?state=opened&scope=all
//       &author_id=<that user>&order_by=updated_at     every open merge request they wrote,
//                                                      in every group and project they can see
//   GET /projects/:id                                  a project's name and address
//   GET /projects/:id/merge_requests/:iid/pipelines    a merge request's pipelines
//   GET /projects/:id/pipelines/:id/jobs               a pipeline's jobs
//
// `read_api` is the scope that covers all of them, and nothing here writes.
//
// What goes to the server is a path and an id. The token is not here at all:
// `request` is `api.net.request`, and the loader attaches the credential to
// requests for this server's origin. Nothing Slack knows is ever an argument.
//
// Answers are values, never exceptions, and carry a reason from a short list
// rather than whatever the server said: an error body can echo anything.

import {
  normaliseMergeRequest,
  normalisePipeline,
  normaliseProject,
  newestPipelineFirst,
  ownUrl,
} from '../lib/model.js';
import { normaliseJob } from '../lib/stages.js';

const API = '/api/v4';
const PER_PAGE = 100;
/** Merge requests stop at 500: a page of that many is a list nobody reads. */
const MAX_MR_PAGES = 5;
const MAX_JOB_PAGES = 3;
const CONCURRENCY = 4;

/**
 * The address of a GitLab, as a base: https, no credentials, no query, no
 * trailing slash, and not already pointing at the API. Null for anything else.
 */
export function normaliseServer(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let url;
  try {
    url = new URL(value.trim().includes('://') ? value.trim() : `https://${value.trim()}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) return null;
  const path = url.pathname.replace(/\/api\/v4\/?.*$/, '').replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

/** One reason from a short list, for any answer that is not a success. */
function classify(answer) {
  if (!answer || typeof answer !== 'object') return { ok: false, reason: 'unreachable' };
  if ('error' in answer) {
    const reason = answer.error === 'timeout' ? 'timeout' : answer.error === 'blocked' ? 'blocked' : 'unreachable';
    return { ok: false, reason };
  }
  const { status } = answer;
  if (status >= 200 && status < 300) {
    return answer.json === null || answer.json === undefined
      ? { ok: false, reason: 'unexpected' }
      : { ok: true, data: answer.json };
  }
  const reason = status === 401 ? 'unauthorized'
    : status === 403 ? 'forbidden'
      : status === 404 ? 'notFound'
        : status === 429 ? 'rateLimited'
          : status >= 500 ? 'server'
            : status >= 300 && status < 400 ? 'redirect'
              : 'unexpected';
  return { ok: false, reason, status };
}

function createLimiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || queue.length === 0) return;
    active += 1;
    const { work, resolve } = queue.shift();
    Promise.resolve().then(work).then(resolve, resolve).finally(() => { active -= 1; next(); });
  };
  return (work) => new Promise((resolve) => { queue.push({ work, resolve }); next(); });
}

/**
 * @param {{ request: (url: string, options?: object) => Promise<object>,
 *           getBase: () => string | null }} deps
 */
export function createClient({ request, getBase }) {
  const limit = createLimiter(CONCURRENCY);
  /** The same request asked twice at once is one request. */
  const inFlight = new Map();

  const get = (path, params = {}) => {
    const base = getBase();
    if (!base) return Promise.resolve({ ok: false, reason: 'blocked' });
    const url = `${base}${API}${path}?${new URLSearchParams(params)}`;
    if (inFlight.has(url)) return inFlight.get(url);
    const pending = limit(async () => {
      try {
        return classify(await request(url));
      } catch {
        return { ok: false, reason: 'unreachable' };
      }
    }).finally(() => inFlight.delete(url));
    inFlight.set(url, pending);
    return pending;
  };

  /** Every page of a list, in order. A later page failing keeps what came before. */
  const pages = async (path, params, { max, map }) => {
    const items = [];
    for (let page = 1; page <= max; page += 1) {
      const result = await get(path, { ...params, per_page: String(PER_PAGE), page: String(page) });
      if (!result.ok) return page === 1 ? result : { ok: true, items, partial: result.reason };
      if (!Array.isArray(result.data)) return page === 1 ? { ok: false, reason: 'unexpected' } : { ok: true, items, partial: 'unexpected' };
      for (const raw of result.data) {
        const item = map(raw);
        if (item) items.push(item);
      }
      if (result.data.length < PER_PAGE) return { ok: true, items, partial: null };
    }
    // A full last page: there may be more, and it is said rather than hidden.
    return { ok: true, items, partial: 'pagination' };
  };

  return {
    async user() {
      const result = await get('/user');
      if (!result.ok) return result;
      const raw = result.data;
      if (!raw || !Number.isFinite(Number(raw.id)) || typeof raw.username !== 'string') return { ok: false, reason: 'unexpected' };
      return {
        ok: true,
        user: {
          id: Number(raw.id),
          username: raw.username,
          name: typeof raw.name === 'string' ? raw.name : raw.username,
        },
      };
    },

    /** Open merge requests written by `userId`, newest touched first, across every project. */
    mergeRequests(userId) {
      const base = getBase();
      return pages('/merge_requests', {
        state: 'opened',
        scope: 'all',
        author_id: String(userId),
        order_by: 'updated_at',
        sort: 'desc',
      }, { max: MAX_MR_PAGES, map: (raw) => normaliseMergeRequest(raw, base) });
    },

    async project(projectId) {
      const result = await get(`/projects/${Number(projectId)}`, { simple: 'true' });
      if (!result.ok) return result;
      const project = normaliseProject(result.data, getBase());
      return project ? { ok: true, project } : { ok: false, reason: 'unexpected' };
    },

    /** A merge request's pipelines, newest first. */
    async pipelines(projectId, mergeRequest) {
      const result = await get(`/projects/${Number(projectId)}/merge_requests/${Number(mergeRequest.iid)}/pipelines`, {
        per_page: '20',
      });
      if (!result.ok) return result;
      if (!Array.isArray(result.data)) return { ok: false, reason: 'unexpected' };
      const base = getBase();
      const list = result.data
        .map((raw) => normalisePipeline(raw, Number(projectId), mergeRequest.id, base))
        .filter(Boolean)
        .sort(newestPipelineFirst);
      return { ok: true, pipelines: list };
    },

    /** The jobs of one pipeline: the latest attempt of each, not the ones retried over. */
    async jobs(projectId, pipelineId) {
      const result = await pages(`/projects/${Number(projectId)}/pipelines/${Number(pipelineId)}/jobs`,
        { include_retried: 'false' }, { max: MAX_JOB_PAGES, map: (raw) => {
          const job = normaliseJob(raw);
          return job ? { ...job, webUrl: ownUrl(job.webUrl, getBase()) } : null;
        } });
      return result.ok ? { ok: true, jobs: result.items, partial: result.partial } : result;
    },
  };
}
