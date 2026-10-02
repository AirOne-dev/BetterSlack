// A GitLab that exists only for the catalogue picture of the GitLab plugin.
//
// The plugin talks https to an address its user typed, and nothing in a
// screenshot run may talk to anybody's real server, so `pnpm shoot` starts this
// one on the loopback interface: a self-signed certificate made for the run,
// handed to the loader as NODE_EXTRA_CA_CERTS (the loader makes the requests,
// not the page), and a handful of invented projects, merge requests, pipelines
// and jobs answering the five reads the plugin makes.
//
// Every name here is invented on purpose and none is a word Slack is likely to
// have on screen: the redaction audit refuses a picture in which a string that
// was in the workspace before the sweep is still there afterwards, and an
// invented word that happens to be a real channel's would fail the run.
//
// It answers 401 unless the request carries the demo token in the header the
// plugin's manifest names -- which is what makes the picture a test of the
// credential reaching a server, not only of drawing.

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** What the recipe hands the loader, and what this server expects to be sent. */
export const DEMO_TOKEN = 'glpat-demo-0000000000000000';

const MINUTE = 60_000;

/** A certificate for localhost, good for the length of the run. */
async function certificate(dir) {
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  await run('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-keyout', key, '-out', cert,
  ], { stdio: 'ignore' });
  return { key: await fs.readFile(key), cert: await fs.readFile(cert), certFile: cert };
}

const PROJECTS = {
  21: { id: 21, name: 'Lighthouse', path_with_namespace: 'studio/lighthouse' },
  22: { id: 22, name: 'Marigold', path_with_namespace: 'studio/marigold' },
  23: { id: 23, name: 'Tidepool', path_with_namespace: 'tools/tidepool' },
};

/** [project, iid, title, branch, minutes ago it changed, draft, pipelines newest first] */
const REQUESTS = [
  [21, 412, 'Add pagination to the invoices export', 'feature/export-pagination', 6, false, ['running']],
  [21, 398, 'Fix flaky retry in the sync worker', 'fix/sync-retry', 130, false, ['failed']],
  [22, 77, 'Move sessions to the new store', 'feature/sessions-store', 45, true, ['success']],
  [22, 71, 'Rename the onboarding steps', 'chore/rename-steps', 60 * 26, false, ['success']],
  [23, 15, 'Speed up the search index rebuild', 'perf/index-rebuild', 60 * 24 * 3, false, ['manual']],
  [23, 9, 'Update the contributor guide', 'docs/contributor-guide', 60 * 24 * 12, false, []],
];

/** Jobs of a pipeline by the status it is in; stages in the order a pipeline runs them. */
function jobsFor(status) {
  const j = (stage, name, state, extra = {}) => ({ stage, name, status: state, allow_failure: false, duration: state === 'success' ? 38 : null, ...extra });
  const checks = (state) => [j('checks', 'eslint', state), j('checks', 'prettier', state), j('checks', 'typecheck', state), j('checks', 'translations', state)];
  if (status === 'running') {
    return [...checks('success'), j('test', 'unit', 'success'), j('test', 'integration', 'running'), j('test', 'browser', 'pending'),
      j('build', 'bundle', 'created'), j('deploy', 'preview', 'created'), j('deploy', 'production', 'manual')];
  }
  if (status === 'failed') {
    return [...checks('success'), j('test', 'unit', 'success'), j('test', 'integration', 'failed'), j('test', 'browser', 'canceled'),
      j('build', 'bundle', 'skipped'), j('deploy', 'preview', 'skipped')];
  }
  if (status === 'manual') {
    return [...checks('success'), j('test', 'unit', 'success'), j('build', 'bundle', 'success'), j('deploy', 'production', 'manual')];
  }
  return [...checks('success'), j('test', 'unit', 'success'), j('test', 'integration', 'success'), j('build', 'bundle', 'success'),
    j('deploy', 'preview', 'success')];
}

/**
 * Start it. `url` is what goes in the plugin's address setting, `certFile` is
 * what the loader is told to trust, and `close()` stops it.
 */
export async function startDemoGitLab() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'betterslack-demo-gitlab-'));
  const { key, cert, certFile } = await certificate(dir);
  let base = '';
  const now = Date.now();
  const iso = (minutesAgo) => new Date(now - minutesAgo * MINUTE).toISOString();

  let nextId = 5000;
  const merge = REQUESTS.map(([projectId, iid, title, branch, ago, draft, statuses]) => ({
    raw: {
      id: iid + projectId * 1000, iid, project_id: projectId, title, draft, state: 'opened', author_id: 7,
      source_branch: branch, target_branch: 'main', created_at: iso(ago + 400), updated_at: iso(ago), sha: `demo${iid}`,
      references: { full: `${PROJECTS[projectId].path_with_namespace}!${iid}` },
    },
    pipelines: statuses.map((status, i) => ({ id: (nextId += 1), status, created_at: iso(ago - 1 + i * 90) })),
  }));
  const byPipeline = new Map();
  for (const request of merge) for (const pipeline of request.pipelines) byPipeline.set(pipeline.id, pipeline);

  const answer = (req) => {
    const url = new URL(req.url, 'https://localhost');
    const route = url.pathname.replace(/^\/api\/v4/, '');
    if (req.headers['private-token'] !== DEMO_TOKEN) return [401, { message: '401 Unauthorized' }];
    if (route === '/user') return [200, { id: 7, username: 'robin', name: 'Robin Vasquez' }];
    if (route === '/merge_requests') {
      const page = Number(url.searchParams.get('page') ?? 1);
      return [200, page > 1 ? [] : merge.map((request) => ({
        ...request.raw, web_url: `${base}/${PROJECTS[request.raw.project_id].path_with_namespace}/-/merge_requests/${request.raw.iid}`,
      }))];
    }
    let match = /^\/projects\/(\d+)$/.exec(route);
    if (match) {
      const project = PROJECTS[match[1]];
      return project ? [200, { ...project, web_url: `${base}/${project.path_with_namespace}` }] : [404, {}];
    }
    match = /^\/projects\/(\d+)\/merge_requests\/(\d+)\/pipelines$/.exec(route);
    if (match) {
      const request = merge.find((item) => item.raw.project_id === Number(match[1]) && item.raw.iid === Number(match[2]));
      const path = PROJECTS[match[1]].path_with_namespace;
      return request ? [200, request.pipelines.map((pipeline) => ({
        id: pipeline.id, project_id: Number(match[1]), status: pipeline.status, sha: 'demo', created_at: pipeline.created_at,
        updated_at: pipeline.created_at, web_url: `${base}/${path}/-/pipelines/${pipeline.id}`,
      }))] : [404, {}];
    }
    match = /^\/projects\/(\d+)\/pipelines\/(\d+)\/jobs$/.exec(route);
    if (match) {
      const pipeline = byPipeline.get(Number(match[2]));
      const path = PROJECTS[match[1]].path_with_namespace;
      let id = Number(match[2]) * 100;
      return pipeline ? [200, jobsFor(pipeline.status).map((job) => ({ ...job, id: (id += 1), web_url: `${base}/${path}/-/jobs/${id}` })).reverse()] : [404, {}];
    }
    return [404, { message: '404 Not found' }];
  };

  const server = https.createServer({ key, cert }, (req, res) => {
    const [status, body] = answer(req);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `https://localhost:${server.address().port}`;

  return {
    url: base,
    certFile,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}
