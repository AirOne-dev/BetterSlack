#!/usr/bin/env node
// The presentation site, live.
//
//   pnpm site:dev            # http://localhost:4321
//   pnpm site:dev -- --port 8080 --open
//
// Serves `site/` and reloads the page whenever anything in it changes -- and
// whenever the catalogue changes, because the page's mod list is generated from
// `mods/registry.json` and a preview showing a stale catalogue is a preview of
// the wrong site. Editing a mod's manifest therefore refreshes the browser too.
//
// No dependencies: a static server, one file watcher and an EventSource are
// about eighty lines, and a dev server is not worth a dependency tree that has
// to be audited like the rest of this repository.

import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { watch } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteDir = path.join(root, 'site');

const args = process.argv.slice(2).filter((arg) => arg !== '--');
const portArg = args.indexOf('--port');
const wanted = Number(portArg >= 0 ? args[portArg + 1] : process.env.PORT || 4321);
const shouldOpen = args.includes('--open');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

/** Injected into every HTML response; never written to disk. */
const RELOAD_SCRIPT = `
<script>
  // Dev only. Reconnects on its own, so restarting the server does not mean
  // reloading the tab by hand.
  (() => {
    let source;
    const connect = () => {
      source = new EventSource('/__reload');
      source.onmessage = (event) => { if (event.data === 'reload') location.reload(); };
      source.onerror = () => { source.close(); setTimeout(connect, 700); };
    };
    connect();
  })();
</script>
`;

/** Browsers listening for a change. */
const clients = new Set();

function regenerateCatalogue() {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/build-site.mjs')], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    console.error(`[site] could not regenerate site/data.js:\n${result.stderr || result.stdout}`);
    return;
  }
  process.stdout.write(`[site] ${result.stdout.trim()}\n`);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (url.pathname === '/__reload') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.write('retry: 700\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  // Everything is served from site/, and nothing above it: a dev server that
  // will hand out ../../.ssh on request is a dev server that gets left running.
  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(siteDir, relative);
  if (!file.startsWith(siteDir)) {
    res.writeHead(403).end('outside site/');
    return;
  }

  try {
    const info = await stat(file);
    const target = info.isDirectory() ? path.join(file, 'index.html') : file;
    const body = await readFile(target);
    const type = TYPES[path.extname(target)] ?? 'application/octet-stream';

    if (type.startsWith('text/html')) {
      const html = body.toString().replace('</body>', `${RELOAD_SCRIPT}</body>`);
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(html);
      return;
    }
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`not found: ${relative}`);
  }
});

/** Collapse a burst of events -- one save can fire three. */
let timer;
function changed(what, regenerate) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (regenerate) regenerateCatalogue();
    console.log(`[site] ${what} changed — reloading ${clients.size} tab(s)`);
    for (const client of clients) client.write('data: reload\n\n');
  }, 80);
}

function listen(port, attemptsLeft = 12) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      listen(port + 1, attemptsLeft - 1);
      return;
    }
    throw err;
  });
  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`[site] serving site/ on ${url}`);
    console.log('[site] editing site/ reloads the page; editing mods/ regenerates the catalogue first');
    if (shouldOpen) {
      const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
      spawnSync(opener, [url], { stdio: 'ignore' });
    }
  });
}

regenerateCatalogue();
watch(siteDir, { recursive: true }, (_event, name) => {
  // data.js is written by the regeneration below; reacting to it would loop.
  if (name === 'data.js') return;
  changed(`site/${name}`, false);
});
watch(path.join(root, 'mods'), { recursive: true }, (_event, name) => {
  if (!/mod\.json$|registry\.json$|\.css$/.test(String(name))) return;
  changed(`mods/${name}`, true);
});
listen(wanted);
