#!/usr/bin/env node
// Builds two bundles:
//   dist/loader.mjs  - the Node process that launches Slack and drives CDP
//   dist/runtime.js  - the IIFE injected into the Slack renderer
import * as esbuild from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const watch = process.argv.includes('--watch');

/*
 * The version reaches the loader from package.json, and only from there.
 *
 * It was a constant in src/loader/index.ts, which `pnpm release` does not touch
 * -- so it sat at the number of the first release while package.json moved on.
 * The update check compares this against the published package.json, so a stale
 * constant means the app reports an update that installing can never clear.
 */
const { version } = JSON.parse(readFileSync(`${root}/package.json`, 'utf8'));

/** @type {esbuild.BuildOptions} */
const loader = {
  entryPoints: [`${root}/src/loader/index.ts`],
  outfile: `${root}/dist/loader.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  define: { __BETTERSLACK_VERSION__: JSON.stringify(version) },
  /*
   * The start screen's animation, inlined here rather than in the renderer.
   *
   * It is ~95kB, and the renderer bundle is a string shipped over CDP and run
   * at document-start on every navigation -- the one place in this project that
   * is required to stay small. The loader is a file on disk that starts once,
   * so it carries the bytes and hands them to the page when the splash asks.
   * Inlined rather than read at runtime so an install still needs nothing but
   * dist/, which is what stage-install.mjs checks.
   */
  loader: { '.webm': 'base64' },
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
 * and the @import inlining for themes, plus the DOM helpers every mod mounts
 * through. Emitted so `tests/mod-files.test.mjs` and `tests/mount.test.mjs` can
 * exercise the real thing instead of asserting on the source text of it.
 */
const runtimeModules = {
  entryPoints: [
    `${root}/src/runtime/plugins.ts`,
    `${root}/src/runtime/themes.ts`,
    `${root}/src/runtime/dom.ts`,
    `${root}/src/runtime/ui/kit.ts`,
    `${root}/src/runtime/ui/kit-css.ts`,
    `${root}/src/runtime/ui/code.ts`,
    `${root}/src/runtime/ui/menu.ts`,
    `${root}/src/runtime/ui/strings.ts`,
    `${root}/src/runtime/ui/palette.ts`,
    `${root}/src/runtime/ui/markdown.ts`,
    `${root}/src/runtime/ui/launcher.ts`,
    `${root}/src/runtime/ui/sort.ts`,
    `${root}/src/runtime/ui/mark.ts`,
    `${root}/src/runtime/ui/splash.ts`,
    `${root}/src/runtime/slack-api.ts`,
  ],
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
  entryPoints: [
    `${root}/src/loader/download.ts`,
    `${root}/src/loader/update.ts`,
    `${root}/src/loader/catalog.ts`,
    `${root}/src/loader/mod-updates.ts`,
    `${root}/src/loader/store.ts`,
    `${root}/src/loader/slack-settings.ts`,
  ],
  outdir: `${root}/dist`,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  logLevel: 'warning',
};

/**
 * The wire format, emitted so tests can exercise the real thing rather than a
 * copy of it -- the version comparisons that decide whether a mod may be
 * installed live there.
 *
 * Its own config with an explicit outfile, not another entry in the list above:
 * esbuild puts an outdir build under the common base of its entry points, so
 * adding a file from src/shared/ to a list of src/loader/ ones moves *every*
 * output down a directory, and dist/download.mjs -- which the tests and the
 * loader both name -- becomes dist/loader/download.mjs.
 */
const sharedProtocol = {
  entryPoints: [`${root}/src/shared/protocol.ts`],
  outfile: `${root}/dist/protocol.mjs`,
  bundle: true,
  platform: 'neutral',
  format: 'esm',
  target: 'es2022',
  logLevel: 'warning',
};

if (watch) {
  const contexts = await Promise.all([esbuild.context(loader), esbuild.context(runtime), esbuild.context(loaderLib), esbuild.context(runtimeHelpers), esbuild.context(runtimeI18n), esbuild.context(runtimeModules), esbuild.context(sharedProtocol)]);
  await Promise.all(contexts.map((c) => c.watch()));
  console.log('[betterslack] watching for changes...');
} else {
  await Promise.all([esbuild.build(loader), esbuild.build(runtime), esbuild.build(loaderLib), esbuild.build(runtimeHelpers), esbuild.build(runtimeI18n), esbuild.build(runtimeModules), esbuild.build(sharedProtocol)]);
}
