#!/usr/bin/env node
// Does it actually work, in a real Slack?
//
//   pnpm test:live
//   pnpm test:live --safe        # the same, with nothing loaded
//
// Every failure this project has had that mattered was invisible to the unit
// tests: a renderer wedged by two mods fighting over the same anchor, two
// runtimes booting into one document and leaving every request unanswered, a
// mod that threw on start and left a row claiming it was on. jsdom cannot see
// any of that. A real Slack can, and until now it was being asked by hand.
//
// So this boots the whole stack against the installed Slack, asks the runtime
// what loaded, and turns the answer into an exit code. It takes about half a
// minute and it closes Slack afterwards, which is why it is not part of
// `pnpm test`.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extra = process.argv.slice(2).filter((arg) => arg !== '--');

const child = spawn(
  process.execPath,
  [path.join(root, 'bin/betterslack.mjs'), '--healthcheck', ...extra],
  { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
);

let output = '';
const relay = (chunk) => {
  const text = String(chunk);
  output += text;
  process.stdout.write(text);
};
child.stdout.on('data', relay);
child.stderr.on('data', relay);

/**
 * A run that never answers is the failure this is here for, so it gets a clock
 * of its own rather than hanging a pipeline for ever.
 */
const timeout = setTimeout(() => {
  console.error('\n[live] no verdict after 90s — killing it, which is itself a failure');
  child.kill('SIGKILL');
  process.exit(1);
}, 90_000);

child.on('exit', (code) => {
  clearTimeout(timeout);

  const healthy = /health: \{/.test(output) && code === 0;
  if (healthy) {
    console.log('\n[live] Slack came up, the panel mounted, every enabled mod applied.');
    process.exit(0);
  }
  console.error('\n[live] failed. What the loader printed above is the diagnosis;');
  console.error('[live] a renderer that did not answer means a mod wedged it — start with --safe.');
  process.exit(code === 0 ? 1 : (code ?? 1));
});
