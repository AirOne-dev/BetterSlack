#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const entry = `${root}/dist/loader.mjs`;

if (!existsSync(entry)) {
  console.error('SlackMod is not built yet. Run:\n\n  npm install && npm run build\n');
  process.exit(1);
}

await import(entry);
