/**
 * The oldest BetterSlack a mod can run on, worked out from what it calls.
 *
 * A mod updates on its own, out of the registry on the default branch, into
 * whatever BetterSlack the reader happens to have. So a plugin that starts
 * calling something added last month is a plugin that breaks on every older
 * install -- at the first click, with a TypeError, which reads to the person
 * holding it as "this plugin is broken" rather than "this plugin is newer than
 * your app". Nobody remembers to bump a hand-written compatibility field, and
 * the release where they forget is the release that needs it.
 *
 * So it is derived. Every entry in docs/api carries a `since`, and that folder
 * is already cross-checked against the TypeScript interfaces -- a new API
 * member cannot exist without a file, so it cannot exist without a version.
 * What is left is to find which of them a mod touches.
 *
 * **What this can and cannot see.** It reads source text, not a program: it
 * finds `api.slack.openMessage` and the aliases mods really write, and it does
 * not find `api[group][name]` built at runtime, nor a member whose behaviour
 * changed without its name changing. That gap is why a mod may also *declare*
 * `needsBetterSlack` in its manifest: the declaration may raise the floor this
 * computes and may never lower it, so the two cannot disagree in the direction
 * that would hurt.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEntry } from './api-doc.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Below any release, so "this mod needs nothing in particular" sorts lowest. */
export const NO_FLOOR = '0.0.0';

/**
 * Compare two version strings, with `unreleased` above every release.
 *
 * An entry that is on the default branch and in no release yet is genuinely
 * newer than anything anyone can be running, so a mod that uses one is
 * genuinely uninstallable until a release is cut. Sorting it to the top says
 * that rather than hiding it.
 */
export function compareVersions(a, b) {
  if (a === b) return 0;
  if (a === 'unreleased') return 1;
  if (b === 'unreleased') return -1;
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0) ? -1 : 1;
  }
  return 0;
}

/** group -> name -> since, out of docs/api. */
export function loadSinceTable() {
  const table = {};
  const dir = path.join(root, 'docs', 'api');
  const entries = readdirSync(dir)
    .filter((file) => file.endsWith('.md'))
    .map((file) => parseEntry(file, readFileSync(path.join(dir, file), 'utf8')));
  for (const entry of entries) {
    const group = (table[entry.group] ??= {});
    /*
     * One entry can document a pair -- `highlight · detect` is one page for two
     * functions -- so the title is split rather than used whole. A name with a
     * space in it would never match a call site.
     */
    for (const name of entry.name.split('·').map((part) => part.trim()).filter(Boolean)) {
      group[name] = entry.since;
    }
  }
  return table;
}

/** Every .js/.mjs file in a mod's folder, which is where its calls are. */
function sourceFiles(dir) {
  const out = [];
  const walk = (at) => {
    for (const name of readdirSync(at)) {
      const full = path.join(at, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(js|mjs)$/.test(name)) out.push(full);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

/**
 * Which API members a piece of source touches.
 *
 * Three shapes, because those are the three mods actually write:
 *
 * - `api.slack.openMessage(...)` -- the overwhelming majority.
 * - `const ui = api.ui.kit(document)` then `ui.button(...)` -- the kit is
 *   handed over as an object, and the variable is not always called `kit`, so
 *   the alias is picked up from the assignment and followed.
 * - `import { renderMarkdown } from '...'` -- the `tools` group is imported
 *   rather than received, which is the whole reason it is a group of its own.
 */
export function usedMembers(source, table) {
  const used = new Set();

  for (const [, group, name] of source.matchAll(/\bapi\.([a-zA-Z]\w*)\.([a-zA-Z]\w*)/g)) {
    if (table[group]?.[name]) used.add(`${group}.${name}`);
  }

  // An alias of a whole group: const helpers = api.helpers, const ui = api.ui.kit
  const aliases = new Map();
  for (const [, alias, group] of source.matchAll(/\b(?:const|let|var)\s+(\w+)\s*=\s*api\.([a-zA-Z]\w*)\b(?!\s*\.)/g)) {
    if (table[group]) aliases.set(alias, group);
  }
  for (const [, alias] of source.matchAll(/\b(?:const|let|var)\s+(\w+)\s*=\s*api\.ui\.kit\b/g)) {
    aliases.set(alias, 'kit');
  }
  // Destructuring: const { slack, ui } = api
  for (const [, inner] of source.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*api\b/g)) {
    for (const part of inner.split(',')) {
      const named = part.trim().split(':').map((p) => p.trim());
      const group = named[0];
      const alias = named[1] || named[0];
      if (table[group]) aliases.set(alias, group);
    }
  }
  for (const [alias, group] of aliases) {
    const rx = new RegExp(`\\b${alias}\\.([a-zA-Z]\\w*)`, 'g');
    for (const [, name] of source.matchAll(rx)) {
      if (table[group]?.[name]) used.add(`${group}.${name}`);
    }
  }

  // The tools group is imported, so its call sites carry no group at all.
  for (const name of Object.keys(table.tools ?? {})) {
    if (new RegExp(`\\b${name}\\s*\\(`).test(source)) used.add(`tools.${name}`);
  }

  return used;
}

/**
 * The floor for one mod folder, and what put it there.
 *
 * `from` is returned because a version on its own is an assertion. When the
 * gate refuses a mod, or an author disagrees with the number, the answer they
 * need is which call is responsible.
 */
export function floorForMod(dir, table = loadSinceTable()) {
  let floor = NO_FLOOR;
  const from = [];
  for (const file of sourceFiles(dir)) {
    for (const member of usedMembers(readFileSync(file, 'utf8'), table)) {
      const [group, name] = member.split('.');
      const since = table[group][name];
      const cmp = compareVersions(since, floor);
      if (cmp > 0) { floor = since; from.length = 0; }
      if (cmp >= 0 && !from.includes(member)) from.push(member);
    }
  }
  return { floor, from: from.sort() };
}
