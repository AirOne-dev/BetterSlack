#!/usr/bin/env node
// Builds two bundles:
//   dist/loader.mjs  - the Node process that launches Slack and drives CDP
//   dist/runtime.js  - the IIFE injected into the Slack renderer
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const watch = process.argv.includes('--watch');

/** @type {esbuild.BuildOptions} */
const loader = {
  entryPoints: [`${root}/src/loader/index.ts`],
  outfile: `${root}/dist/loader.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  // ws ships native-ish optional deps; keep it out of the bundle.
  external: ['ws'],
  sourcemap: true,
  logLevel: 'info',
};

/** @type {esbuild.BuildOptions} */
const runtime = {
  entryPoints: [`${root}/src/runtime/index.ts`],
  outfile: `${root}/dist/runtime.js`,
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  // The renderer bundle is read as a string and shipped over CDP, so keep it
  // self-contained and free of any import of Node built-ins.
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
};

/**
 * Emitted so the test harness can exercise the *real* helpers rather than a
 * stand-in: a mod's test then covers the helper code its behaviour depends on.
 */
const runtimeHelpers = {
  entryPoints: [`${root}/src/runtime/helpers.ts`],
  outfile: `${root}/dist/helpers.mjs`,
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  logLevel: 'warning',
};

/**
 * The real translator, so a mod's test runs its dictionaries through the same
 * lookup the app uses instead of a stand-in that always answers in English.
 */
const runtimeI18n = {
  entryPoints: [`${root}/src/runtime/i18n.ts`],
  outfile: `${root}/dist/i18n.mjs`,
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  logLevel: 'warning',
};

/**
 * How a mod's folder becomes something loadable: the module graph for plugins
 * and the @import inlining for themes. Emitted so `tests/mod-files.test.mjs`
 * can put a real folder through the real resolver instead of asserting on the
 * source text of it.
 */
const runtimeModules = {
  entryPoints: [`${root}/src/runtime/plugins.ts`, `${root}/src/runtime/themes.ts`],
  outdir: `${root}/dist`,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  logLevel: 'warning',
};

/**
 * Pure loader helpers, emitted so `tests/download.test.mjs` can exercise the
 * download guards without pulling in the whole loader entry point.
 */
const loaderLib = {
  entryPoints: [`${root}/src/loader/download.ts`],
  outfile: `${root}/dist/download.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  logLevel: 'warning',
};

if (watch) {
  const contexts = await Promise.all([esbuild.context(loader), esbuild.context(runtime), esbuild.context(loaderLib), esbuild.context(runtimeHelpers), esbuild.context(runtimeI18n), esbuild.context(runtimeModules)]);
  await Promise.all(contexts.map((c) => c.watch()));
  console.log('[slackmod] watching for changes...');
} else {
  await Promise.all([esbuild.build(loader), esbuild.build(runtime), esbuild.build(loaderLib), esbuild.build(runtimeHelpers), esbuild.build(runtimeI18n), esbuild.build(runtimeModules)]);
}
