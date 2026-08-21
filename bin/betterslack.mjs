#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const entry = `${root}/dist/loader.mjs`;

/*
 * This file is both the checkout's entry point and the installed one, and the
 * two cannot be told the same thing: an install has no src/, no package manager
 * and nothing to build with, so "run pnpm build" is advice it cannot follow.
 */
if (!existsSync(entry)) {
  console.error(
    existsSync(`${root}/src`)
      ? 'BetterSlack is not built yet. Run:\n\n  pnpm install && pnpm build\n'
      : 'This BetterSlack install is incomplete: dist/loader.mjs is missing.\n\n'
        + '  Run install.sh (or install.ps1) again from the repository.\n',
  );
  process.exit(1);
}

await import(entry);
