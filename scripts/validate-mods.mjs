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

const problems = [];
const seenIds = new Map();
const requirements = [];
let checked = 0;

/**
 * Good enough to keep prose out of the source checks. It is not a JS parser --
 * it will also blank out anything comment-shaped inside a string literal, which
 * only ever makes this check more permissive, never less.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * Every file the runtime would load from a mod folder, as folder-relative
 * paths. Tests are excluded: they run in Node, import the shared harness, and
 * never reach the app.
 */
async function modSources(dir, prefix = '') {
  const found = [];
  for (const item of await fs.readdir(dir, { withFileTypes: true })) {
    if (item.name.startsWith('.') || item.name === 'node_modules') continue;
    const rel = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) found.push(...(await modSources(path.join(dir, item.name), rel)));
    else if (/\.js$/.test(item.name) && !/\.test\.js$/.test(item.name)) found.push(rel);
  }
  return found;
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
    if (manifest.betterslackApi !== API_VERSION) fail(`"betterslackApi" must be ${API_VERSION}`);

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
      } else if (type === 'plugin' && !/export\s+default/.test(source)) {
        fail('a plugin must have a default export');
      }
    }

    // A mod is a folder, so the source rules apply to every file in it, not
    // only the entry -- eval() hidden in a helper module is still eval().
    // Comments are stripped first, or documenting the rule trips it.
    for (const file of await modSources(modDir)) {
      const source = stripComments(await fs.readFile(path.join(modDir, file), 'utf8'));
      if (/\beval\s*\(|new\s+Function\s*\(/.test(source)) {
        fail(`${file} uses eval()/new Function(), which Slack's CSP blocks at runtime`);
      }
      // The runtime rewrites relative specifiers to blob URLs before loading,
      // so anything reaching outside the folder cannot be resolved at all.
      // Statement-level only, plus dynamic import(). A looser "anything after
      // `from`" pattern reads the string in `{ base: 'Start from', x: '…' }`
      // as a specifier, which is a confusing way to fail a pull request.
      const specs = [
        ...source.matchAll(/(?:^|\n)\s*(?:import|export)\b[^'"\n]*?\bfrom\s*['"]([^'"\n,\s]+)['"]/g),
        ...source.matchAll(/(?:^|\n)\s*import\s*['"]([^'"\n,\s]+)['"]/g),
        ...source.matchAll(/\bimport\s*\(\s*['"]([^'"\n,\s]+)['"]/g),
      ];
      for (const [, spec] of specs) {
        if (!spec.startsWith('.')) {
          fail(`${file} imports "${spec}" — a mod may only import its own files`);
        } else if (path.relative(modDir, path.resolve(modDir, path.dirname(file), spec)).startsWith('..')) {
          fail(`${file} imports "${spec}", which is outside the mod folder`);
        }
      }
    }

    // A theme's required plugins. Collected now and resolved after the scan,
    // because a theme may require a plugin whose folder comes later.
    if (manifest.requires !== undefined) {
      if (!Array.isArray(manifest.requires)) {
        fail('"requires" must be an array');
      } else if (type !== 'theme') {
        fail('"requires" is for themes only');
      } else {
        for (const value of manifest.requires) {
          if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
            fail(`"requires" entries must be mod ids (got ${JSON.stringify(value)})`);
          } else if (value === manifest.id) {
            fail('a theme cannot require itself');
          } else {
            requirements.push({ rel, id: value });
          }
        }
      }
    }
  }
}

// A theme pointing at a plugin nobody ships would install and quietly look
// wrong, so the catalogue has to be self-contained.
for (const { rel, id } of requirements) {
  const target = seenIds.get(id);
  if (!target) problems.push(`${rel}: requires "${id}", which is not in this repository`);
  else if (!target.startsWith('mods/plugins/')) {
    problems.push(`${rel}: requires "${id}", which is a theme; only plugins can be required`);
  }
}

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s) found:\n`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error('');
  process.exit(1);
}
console.log(`✓ ${checked} mod(s) valid`);
