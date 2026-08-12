#!/usr/bin/env node
// Does a mod have what it needs to actually work once installed?
//
//   node scripts/check-structure.mjs              every mod
//   node scripts/check-structure.mjs quote-reply  one mod
//
// `validate-mods.mjs` checks the manifest. This goes further and checks the
// things that make a mod loadable at runtime: the entry file imports, a plugin
// really does export start(), a theme's CSS parses, the registry knows about it,
// and tests exist. A mod that passes this will at least load in the app.

import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { listMods } from './test-mods.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_VERSION = 1;

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const mods = listMods().filter((m) => wanted.length === 0 || wanted.includes(m.id));

if (mods.length === 0) {
  console.log(wanted.length > 0 ? `No mod matched ${wanted.join(', ')}` : 'No mods to check.');
  process.exit(0);
}

const registry = JSON.parse(await fs.readFile(path.join(root, 'mods/registry.json'), 'utf8'));
let failures = 0;

for (const mod of mods) {
  const problems = [];
  const rel = `mods/${mod.kind}/${mod.id}`;
  const expectedType = mod.kind === 'themes' ? 'theme' : 'plugin';

  // 1. Manifest
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(path.join(mod.dir, 'mod.json'), 'utf8'));
  } catch (err) {
    problems.push(`mod.json unreadable: ${err.message}`);
  }

  if (manifest) {
    if (manifest.id !== mod.id) problems.push(`"id" is "${manifest.id}" but the folder is "${mod.id}"`);
    if (manifest.type !== expectedType) problems.push(`"type" must be "${expectedType}"`);
    if (manifest.slackmodApi !== API_VERSION) problems.push(`"slackmodApi" must be ${API_VERSION}`);
    for (const field of ['name', 'version', 'author', 'description', 'entry']) {
      if (typeof manifest[field] !== 'string' || manifest[field].trim() === '') {
        problems.push(`"${field}" is required`);
      }
    }
    if (typeof manifest.description === 'string' && manifest.description.length < 20) {
      problems.push('"description" should say what the user gets, in a sentence');
    }

    // 2. Entry file, and that it is the shape the app will try to load
    const entry = manifest.entry ?? '';
    const entryPath = path.join(mod.dir, entry);
    if (path.isAbsolute(entry) || entry.split(/[\\/]/).includes('..')) {
      problems.push('"entry" must stay inside the mod folder');
    } else if (!existsSync(entryPath)) {
      problems.push(`entry file "${entry}" does not exist`);
    } else if (expectedType === 'plugin') {
      if (!entry.endsWith('.js')) problems.push('a plugin entry must be a .js file');
      else {
        try {
          // A real import: this is what the runtime does, so a syntax error or
          // a missing default export fails here rather than in the app.
          const module = await import(pathToFileURL(entryPath).href);
          const plugin = module.default;
          if (!plugin || typeof plugin !== 'object') problems.push('no default export object');
          else if (typeof plugin.start !== 'function') problems.push('default export has no start()');
          else if (plugin.stop !== undefined && typeof plugin.stop !== 'function') {
            problems.push('stop must be a function when present');
          }
        } catch (err) {
          problems.push(`entry does not import: ${err.message}`);
        }
      }
    } else {
      if (!entry.endsWith('.css')) problems.push('a theme entry must be a .css file');
      else {
        const css = await fs.readFile(entryPath, 'utf8');
        const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
        const open = (stripped.match(/{/g) ?? []).length;
        const close = (stripped.match(/}/g) ?? []).length;
        if (open !== close) problems.push(`unbalanced braces: ${open} "{" vs ${close} "}"`);
        if (css.trim() === '') problems.push('theme is empty');
      }
    }

    // 2b. A theme's companion script, if it declares one. Imported for real,
    // same as a plugin entry: the app will do exactly this, and a script that
    // throws on import leaves the theme half-applied.
    if (manifest.script !== undefined) {
      const script = manifest.script;
      const scriptPath = path.join(mod.dir, script);
      if (expectedType !== 'theme') {
        problems.push('"script" is for themes only');
      } else if (typeof script !== 'string' || path.isAbsolute(script) || script.split(/[\\/]/).includes('..')) {
        problems.push('"script" must be a path inside the mod folder');
      } else if (!script.endsWith('.js')) {
        problems.push('"script" must be a .js file');
      } else if (!existsSync(scriptPath)) {
        problems.push(`script file "${script}" does not exist`);
      } else {
        try {
          const module = await import(pathToFileURL(scriptPath).href);
          if (typeof module.start !== 'function') {
            problems.push('script has no exported start(api) function');
          }
          if (module.stop !== undefined && typeof module.stop !== 'function') {
            problems.push('script exports stop but it is not a function');
          }
        } catch (err) {
          problems.push(`script does not import: ${err.message}`);
        }
        if (!(manifest.permissions ?? []).includes('layout')) {
          problems.push('a theme with a script must declare the "layout" permission');
        }
      }
    }
  }

  // 3. Tests. A mod with no tests cannot be gated, so this is not optional.
  if (!existsSync(mod.test)) problems.push('no test.mjs — every mod must ship tests');

  // 4. The catalogue people install from
  const entryInRegistry = registry.mods?.find((m) => m.id === mod.id);
  if (!entryInRegistry) {
    problems.push('missing from mods/registry.json — run `npm run registry` and commit it');
  } else if (manifest && entryInRegistry.version !== manifest.version) {
    problems.push('registry.json is stale — run `npm run registry` and commit it');
  }

  if (problems.length > 0) {
    failures++;
    console.error(`\n✗ ${rel}`);
    for (const problem of problems) console.error(`    ${problem}`);
  } else {
    console.log(`✓ ${rel}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} mod(s) are not structurally sound`);
  process.exit(1);
}
console.log(`\n${mods.length} mod(s) structurally sound`);
