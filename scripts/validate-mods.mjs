#!/usr/bin/env node
// Pull request gate for mods/.
//
// This is the automated half of the review; the human half is reading the code.
// Nothing here can tell a well-written plugin from a malicious one, so it only
// enforces the things a reviewer should never have to check by hand.

import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modsRoot = path.join(root, 'mods');
const API_VERSION = 1;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,48}$/;
// Kept in step with PERMISSIONS in src/shared/protocol.ts by hand: this script
// runs without a build step, so it cannot import the TypeScript source.
const PERMISSIONS = ['layout', 'workspace'];

const problems = [];
const seenIds = new Map();
let checked = 0;

/**
 * Good enough to keep prose out of the source checks. It is not a JS parser --
 * it will also blank out anything comment-shaped inside a string literal, which
 * only ever makes this check more permissive, never less.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

for (const kind of ['themes', 'plugins']) {
  const type = kind === 'themes' ? 'theme' : 'plugin';
  const dir = path.join(modsRoot, kind);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const modDir = path.join(dir, entry.name);
    const rel = `mods/${kind}/${entry.name}`;
    const fail = (message) => problems.push(`${rel}: ${message}`);

    let manifest;
    try {
      manifest = JSON.parse(await fs.readFile(path.join(modDir, 'mod.json'), 'utf8'));
    } catch (err) {
      fail(`mod.json is missing or invalid (${err.message})`);
      continue;
    }
    checked++;

    for (const field of ['id', 'name', 'version', 'author', 'description', 'entry']) {
      if (typeof manifest[field] !== 'string' || manifest[field].trim() === '') {
        fail(`"${field}" must be a non-empty string`);
      }
    }
    if (!ID_PATTERN.test(manifest.id ?? '')) fail(`"id" must match ${ID_PATTERN}`);
    if (manifest.id !== entry.name) fail(`"id" must equal the folder name ("${entry.name}")`);
    if (manifest.type !== type) fail(`"type" must be "${type}"`);
    if (manifest.slackmodApi !== API_VERSION) fail(`"slackmodApi" must be ${API_VERSION}`);

    const previous = seenIds.get(manifest.id);
    if (previous) fail(`id "${manifest.id}" is already used by ${previous}`);
    else seenIds.set(manifest.id, rel);

    const entryFile = manifest.entry ?? '';
    const expectedExt = type === 'theme' ? '.css' : '.js';
    if (path.isAbsolute(entryFile) || entryFile.split(/[\\/]/).includes('..')) {
      fail('"entry" must stay inside the mod folder');
    } else if (!entryFile.endsWith(expectedExt)) {
      fail(`"entry" must end in ${expectedExt}`);
    } else {
      const source = await fs.readFile(path.join(modDir, entryFile), 'utf8').catch(() => null);
      if (source === null) {
        fail(`entry file "${entryFile}" does not exist`);
      } else if (type === 'plugin') {
        if (!/export\s+default/.test(source)) {
          fail('a plugin must have a default export');
        }
        // eval/new Function cannot work anyway: Slack's CSP has no
        // 'unsafe-eval'. Catching it here saves a confusing bug report.
        // Comments are stripped first, or documenting the rule trips it.
        if (/\beval\s*\(|new\s+Function\s*\(/.test(stripComments(source))) {
          fail("uses eval()/new Function(), which Slack's CSP blocks at runtime");
        }
      }
    }

    // A theme's companion script. Every rule here exists so that the consent
    // dialog cannot be lying: it names exactly what the manifest declares, so
    // the manifest has to declare exactly what the mod can do.
    if (manifest.permissions !== undefined) {
      if (!Array.isArray(manifest.permissions)) {
        fail('"permissions" must be an array');
      } else {
        for (const value of manifest.permissions) {
          if (!PERMISSIONS.includes(value)) {
            fail(`unknown permission ${JSON.stringify(value)} (known: ${PERMISSIONS.join(', ')})`);
          }
        }
      }
    }

    if (manifest.script !== undefined) {
      const script = manifest.script;
      if (type !== 'theme') {
        fail('"script" is for themes only; a plugin\'s entry is already its script');
      } else if (typeof script !== 'string' || script.trim() === '') {
        fail('"script" must be a non-empty string');
      } else if (path.isAbsolute(script) || script.split(/[\\/]/).includes('..')) {
        fail('"script" must stay inside the mod folder');
      } else if (!script.endsWith('.js')) {
        fail('"script" must end in .js');
      } else {
        const source = await fs.readFile(path.join(modDir, script), 'utf8').catch(() => null);
        if (source === null) fail(`script file "${script}" does not exist`);
        else if (!/export\s+(async\s+)?function\s+start\b|export\s+const\s+start\b/.test(source)) {
          fail('a theme script must export a start(api) function');
        } else if (/\beval\s*\(|new\s+Function\s*\(/.test(stripComments(source))) {
          fail("uses eval()/new Function(), which Slack's CSP blocks at runtime");
        }
        if (!(manifest.permissions ?? []).includes('layout')) {
          fail('"script" requires "layout" in "permissions"');
        }
      }
    } else if (type === 'theme' && (manifest.permissions ?? []).length > 0) {
      fail('"permissions" declared but there is no "script" to use them');
    }
  }
}

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s) found:\n`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error('');
  process.exit(1);
}
console.log(`✓ ${checked} mod(s) valid`);
