// What is kept between runs, so a restart draws at once.
//
// The merge requests, their pipelines and the jobs worth drawing, as of the
// last time GitLab answered -- never the token, which is not the plugin's to
// hold. Bounded, dated, and refused when it belongs to somebody else's session
// or is too old, so it can only ever make the first frame faster.

import { ownUrl } from './model.js';

const VERSION = 1;
export const TTL_MS = 24 * 60 * 60 * 1000;
export const LIMITS = { mergeRequests: 100, pipelinesPerMr: 3, hydrated: 40 };

/** The least that can be drawn from, trimmed to the limits. */
export function snapshotOf(state, now) {
  const mergeRequests = state.mergeRequests.slice(0, LIMITS.mergeRequests);
  const keep = new Set(mergeRequests.map((mr) => mr.id));
  const pipelines = {};
  const wanted = [];
  for (const [id, entry] of Object.entries(state.pipelines)) {
    if (!keep.has(Number(id))) continue;
    pipelines[id] = { ...entry, list: entry.list.slice(0, LIMITS.pipelinesPerMr), error: null };
    for (const pipeline of pipelines[id].list) wanted.push(pipeline);
  }
  // Jobs only for the newest pipelines: they are the bulk of it.
  wanted.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const jobs = {};
  for (const pipeline of wanted.slice(0, LIMITS.hydrated)) {
    if (state.jobs[pipeline.id]) jobs[pipeline.id] = state.jobs[pipeline.id];
  }
  const projects = {};
  for (const mr of mergeRequests) {
    if (state.projects[mr.projectId]) projects[mr.projectId] = state.projects[mr.projectId];
  }
  return { version: VERSION, savedAt: now, server: state.server, userId: state.user?.id ?? null,
    fetchedAt: state.fetchedAt, mergeRequests, projects, pipelines, jobs };
}

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value) => (typeof value === 'string' ? value : '');
const number = (value) => (Number.isFinite(value) ? value : 0);

/*
 * What comes back from the disk is read as if it came from the network: only the
 * fields a screen draws, each of the type it is drawn as, and every address one
 * of the instance's own pages. A file that was edited, or written by another
 * build, can then at worst draw wrong words -- never a link elsewhere, and never
 * a shape the screens throw on.
 */
function cleanMergeRequest(raw, server) {
  if (!isRecord(raw) || ![raw.id, raw.iid, raw.projectId].every(Number.isFinite) || typeof raw.title !== 'string') return null;
  return {
    id: raw.id, iid: raw.iid, projectId: raw.projectId, title: raw.title, draft: raw.draft === true,
    sourceBranch: text(raw.sourceBranch), targetBranch: text(raw.targetBranch), createdAt: text(raw.createdAt),
    updatedAt: text(raw.updatedAt), sha: text(raw.sha), webUrl: ownUrl(raw.webUrl, server), path: text(raw.path),
  };
}
function cleanPipeline(raw, server) {
  if (!isRecord(raw) || !Number.isFinite(raw.id)) return null;
  return {
    id: raw.id, projectId: number(raw.projectId), mergeRequestId: number(raw.mergeRequestId), status: text(raw.status) || 'created',
    createdAt: text(raw.createdAt), updatedAt: text(raw.updatedAt), sha: text(raw.sha), webUrl: ownUrl(raw.webUrl, server),
  };
}
function cleanJob(raw, server) {
  if (!isRecord(raw) || !Number.isFinite(raw.id) || typeof raw.name !== 'string') return null;
  return {
    id: raw.id, name: raw.name, stage: text(raw.stage) || '-', status: text(raw.status) || 'created',
    allowFailure: raw.allowFailure === true, duration: Number.isFinite(raw.duration) ? raw.duration : null,
    webUrl: ownUrl(raw.webUrl, server),
  };
}
function cleanProject(raw, server) {
  if (!isRecord(raw) || !Number.isFinite(raw.id)) return null;
  return { id: raw.id, name: text(raw.name), path: text(raw.path), webUrl: ownUrl(raw.webUrl, server), fetchedAt: number(raw.fetchedAt) };
}
/** `{ [id]: clean(entry) }`, without the entries that are not one. */
function cleanMap(map, clean) {
  const out = {};
  for (const [key, entry] of Object.entries(isRecord(map) ? map : {})) {
    const cleaned = clean(entry);
    if (cleaned) out[key] = cleaned;
  }
  return out;
}
const cleanList = (list, clean) => (Array.isArray(list) ? list.map(clean).filter(Boolean) : []);

/**
 * The parts of a kept snapshot that can be trusted for this session, or null.
 * Anything malformed is "nothing kept", never an exception on startup.
 */
export function restore(snapshot, { server, userId, now }) {
  if (!isRecord(snapshot) || snapshot.version !== VERSION) return null;
  if (snapshot.server !== server || !userId || snapshot.userId !== userId) return null;
  if (!Number.isFinite(snapshot.savedAt) || now - snapshot.savedAt > TTL_MS || snapshot.savedAt > now + 60_000) return null;
  if (!Array.isArray(snapshot.mergeRequests) || !isRecord(snapshot.pipelines) || !isRecord(snapshot.jobs)) return null;
  return {
    mergeRequests: cleanList(snapshot.mergeRequests.slice(0, LIMITS.mergeRequests), (mr) => cleanMergeRequest(mr, server)),
    projects: cleanMap(snapshot.projects, (project) => cleanProject(project, server)),
    pipelines: cleanMap(snapshot.pipelines, (entry) => (isRecord(entry) ? {
      list: cleanList(entry.list, (pipeline) => cleanPipeline(pipeline, server)),
      active: entry.active === true, sha: text(entry.sha), mrUpdatedAt: text(entry.mrUpdatedAt),
      checkedAt: number(entry.checkedAt), error: null,
    } : null)),
    jobs: cleanMap(snapshot.jobs, (entry) => (isRecord(entry) && Array.isArray(entry.jobs)
      ? { key: text(entry.key), jobs: cleanList(entry.jobs, (job) => cleanJob(job, server)) } : null)),
    fetchedAt: Number.isFinite(snapshot.fetchedAt) ? snapshot.fetchedAt : 0,
  };
}
