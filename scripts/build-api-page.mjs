#!/usr/bin/env node
/**
 * site/api.html — the API reference, generated from the API.
 *
 * The page is built by reading the TypeScript interfaces rather than by
 * writing the same list a second time. `docs/api.md` and this page therefore
 * cannot disagree with the code about what exists: add a method and it appears
 * here; delete one and it leaves.
 *
 * Examples come from `docs/api.md`, keyed by the heading that names the entry,
 * so the prose stays in one place too. The live demos are the exception and
 * are wired by hand below -- there is no way to derive "show me this one
 * running" from a type.
 */

import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import * as esbuild from 'esbuild';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

/* -- reading the types ---------------------------------------------------- */

/** The body of the first `{ ... }` after a header, balanced. */
function bodyAfter(src, header) {
  const at = src.indexOf(header);
  if (at < 0) return null;
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(open + 1, i); }
  }
  return null;
}

/** One doc comment, flattened to a sentence or two. */
function flatten(lines) {
  return lines
    .join('\n')
    .replace(/^\s*\/\*\*/, '')
    .replace(/\*\/\s*$/, '')
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, '').trimEnd())
    .join('\n')
    .trim();
}

/**
 * Members declared at one indent, each with the comment above it.
 *
 * Nested object types are returned whole so the caller can recurse: `ui: { ...`
 * is a namespace, `css(...)` is an entry, and the difference is whether the
 * line opens a brace it does not close.
 */
function membersOf(block, indent) {
  const out = [];
  const lines = block.split('\n');
  let doc = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*\/\*\*/.test(line)) {
      doc = [line];
      while (i < lines.length && !/\*\//.test(lines[i])) { i += 1; doc.push(lines[i]); }
      continue;
    }
    const at = new RegExp(`^ {${indent}}(readonly )?([A-Za-z_]\\w*)\\s*([(<:?].*)$`).exec(line);
    if (!at) {
      if (line.trim() && !/^\s*\*/.test(line)) doc = [];
      continue;
    }
    const opensBlock = /\{\s*$/.test(line);
    let nested = null;
    if (opensBlock) {
      const rest = lines.slice(i).join('\n');
      nested = bodyAfter(rest, rest.slice(0, rest.indexOf('{') + 1));
      // Skip past the nested body so its members are not read twice.
      let depth = 0;
      for (; i < lines.length; i += 1) {
        for (const ch of lines[i]) {
          if (ch === '{') depth += 1;
          else if (ch === '}') depth -= 1;
        }
        if (depth === 0) break;
      }
    }
    out.push({
      name: at[2],
      signature: at[3].replace(/;\s*$/, '').trim(),
      doc: flatten(doc),
      nested,
    });
    doc = [];
  }
  return out;
}

/** Members of a named interface, wherever it lives. */
function interfaceMembers(file, name) {
  const body = bodyAfter(read(file), `export interface ${name}`);
  return body ? membersOf(body, 2) : [];
}

/* -- the model ------------------------------------------------------------ */

/**
 * How each namespace is reached, and where its type is written.
 *
 * `PluginApi` declares some inline and points at an interface for the rest;
 * both are listed here so the page has one shape for all of them.
 */
const NAMESPACES = [
  { key: 'helpers', title: 'api.helpers', from: ['src/runtime/helpers.ts', 'Helpers'] },
  { key: 'slack', title: 'api.slack', from: ['src/runtime/slack-api.ts', 'SlackApi'] },
  { key: 'ui', title: 'api.ui', inline: true },
  { key: 'dom', title: 'api.dom', inline: true },
  { key: 'i18n', title: 'api.i18n', from: ['src/runtime/i18n.ts', 'I18n'] },
  { key: 'settings', title: 'api.settings', inline: true },
  { key: 'commands', title: 'api.commands', inline: true },
  { key: 'files', title: 'api.files', inline: true },
  { key: 'assets', title: 'api.assets', inline: true },
  { key: 'themes', title: 'api.themes', inline: true },
  { key: 'app', title: 'api.app', inline: true },
  { key: 'log', title: 'api.log', inline: true },
];

export function readApi() {
  const top = membersOf(bodyAfter(read('src/runtime/api.ts'), 'export interface PluginApi'), 2);
  const byName = new Map(top.map((m) => [m.name, m]));

  const groups = NAMESPACES.map((ns) => {
    const declared = byName.get(ns.key);
    const entries = ns.inline
      ? membersOf(declared?.nested ?? '', 4)
      : interfaceMembers(ns.from[0], ns.from[1]);
    return { ...ns, doc: declared?.doc ?? '', entries };
  });

  // Whatever is left on PluginApi and is not a namespace: id, css, onDispose…
  const covered = new Set(NAMESPACES.map((n) => n.key));
  const loose = top.filter((m) => !covered.has(m.name) && !m.name.startsWith('__'));

  return {
    groups,
    loose,
    kit: interfaceMembers('src/runtime/ui/kit.ts', 'Kit'),
  };
}

/* -- examples from the prose ---------------------------------------------- */

/**
 * The first fenced block under each `###` heading, keyed by every name the
 * heading mentions in backticks. One heading often documents two entries.
 */
function examples() {
  const md = read('docs/api.md');
  const found = new Map();
  const re = /^### (.+)$/gm;
  let match;
  while ((match = re.exec(md))) {
    const heading = match[1];
    const rest = md.slice(match.index + match[0].length);
    const fence = /```(?:js|ts|css|bash)?\n([\s\S]*?)```/.exec(rest.split(/^### /m)[0]);
    if (!fence) continue;
    for (const name of heading.match(/`([A-Za-z_]\w*)/g) ?? []) {
      found.set(name.slice(1), fence[1].trimEnd());
    }
  }
  return found;
}

/* -- the demos, wired by hand --------------------------------------------- */

/**
 * The kit primitives that have a demo wired in `scripts/api-demos.js`.
 *
 * Named here rather than discovered, because an empty dashed box under a
 * heading reads as a demo that broke rather than one that was never written.
 */
const KIT_DEMOS = new Set([
  'el', 'button', 'iconButton', 'field', 'input', 'select', 'segmented',
  'card', 'emptyState', 'swatch', 'popover', 'confirm', 'copyText', 'code',
]);

/**
 * Entries that run on this page, and how each one is introduced.
 *
 * A demo is wired by hand in `scripts/api-demos.js` -- there is no way to
 * derive "show me this one working" from a type -- so the two lists are kept
 * side by side and a name in one without the other is a visible hole rather
 * than a silent one.
 */
const LIVE_ENTRIES = new Set(['toggle', 'describeHotkey', 'debounce']);

const LIVE = {
  kit: `<div class="api-demo api-demo--flat"><p class="note">Every primitive is below, in
    <a href="#kit">the component gallery</a> — rendered by the same
    <code>createKit</code> a mod is handed.</p></div>`,
};

/**
 * Which entries cannot run outside Slack, said out loud.
 *
 * Anything that reaches for Slack's own markup, its stylesheet or its API only
 * means something inside the client. Saying so beside the example is more
 * honest than a lookalike, and it is the difference a reader most wants at a
 * glance.
 */
const NEEDS_SLACK = /^(add|open|on|current|describeMessage|userIdFrom|web|composer|selectors|vip|setVip|hideConversation|filesFrom|startHuddle|desktop|restart|avatarUrl|toast|modal|confirm|menu|palette|badge|tooltip|mount|each|iconButton|field|section|copy|poll|themes|saveTheme|files|assets|app|commands|settings|css|log|i18n)/;

const escape = (text) => String(text)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* -- the page ------------------------------------------------------------- */

function entryHtml(entry, example) {
  const doc = entry.doc
    ? entry.doc.split(/\n\s*\n/).map((p) => `<p>${escape(p).replace(/`([^`]+)`/g, '<code>$1</code>')}</p>`).join('\n')
    : '';
  const live = LIVE_ENTRIES.has(entry.name)
    ? `<div class="api-demo" data-demo="${escape(entry.name)}"></div>`
    : (LIVE[entry.name] ?? '');
  const tag = live
    ? '<span class="api-badge api-badge--live">live below</span>'
    : (NEEDS_SLACK.test(entry.name) ? '<span class="api-badge">inside Slack</span>' : '');
  return `<article class="api-entry" id="entry-${entry.id}">
  <h4><code>${escape(entry.name)}</code><span class="api-sig">${escape(entry.signature)}</span>${tag}</h4>
  ${doc}
  ${live}
  ${example ? `<pre class="api-code"><code>${escape(example)}</code></pre>` : ''}
</article>`;
}

export function buildApiPage() {
  const { groups, loose, kit } = readApi();
  const example = examples();
  let id = 0;
  const withIds = (list) => list.map((e) => ({ ...e, id: `${e.name}-${(id += 1)}` }));

  const sections = groups.map((group) => {
    const entries = withIds(group.entries);
    return { group, entries };
  });

  const nav = sections.map(({ group, entries }) => `<li><a href="#${group.key}">${group.title}</a>
    <ul>${entries.map((e) => `<li><a href="#entry-${e.id}">${escape(e.name)}</a></li>`).join('')}</ul></li>`).join('\n');

  const main = sections.map(({ group, entries }) => `<section class="api-group" id="${group.key}">
  <h3>${group.title}</h3>
  ${group.doc ? `<p class="section__lede">${escape(group.doc.split(/\n\s*\n/)[0])}</p>` : ''}
  ${entries.map((e) => entryHtml(e, example.get(e.name))).join('\n')}
</section>`).join('\n');

  const looseHtml = withIds(loose)
    .map((e) => entryHtml(e, example.get(e.name))).join('\n');

  const kitHtml = withIds(kit).map((e) => `<article class="api-entry">
  <h4><code>kit.${escape(e.name)}</code><span class="api-sig">${escape(e.signature)}</span></h4>
  ${e.doc ? `<p>${escape(e.doc.split(/\n\s*\n/)[0])}</p>` : ''}
  ${KIT_DEMOS.has(e.name)
    ? `<div class="api-demo" data-demo="${escape(e.name)}"></div>`
    : '<p class="note">No live demo: this one only makes sense against something already on screen.</p>'}
</article>`).join('\n');

  /*
   * Code Highlight's own stylesheet, inlined rather than restated. Its class
   * names are the tokeniser's output, so a second copy here would be a second
   * thing to keep in step with a file nobody would think to check.
   */
  const highlightCss = read('mods/plugins/code-highlight/highlight.css');

  const template = read('site/api-template.html');
  const page = template
    .replace('<!--NAV-->', nav)
    .replace('<!--GROUPS-->', main)
    .replace('<!--LOOSE-->', looseHtml)
    .replace('<!--KIT-->', kitHtml)
    .replaceAll('<!--COUNT-->', String(sections.reduce((n, s) => n + s.entries.length, 0) + loose.length))
    .replace('<!--HLCSS-->', highlightCss);
  writeFileSync(path.join(root, 'site/api.html'), page);

  return { groups: sections.length, entries: sections.reduce((n, s) => n + s.entries.length, 0) + loose.length, kit: kit.length };
}

export async function bundleDemos() {
  await esbuild.build({
    entryPoints: [path.join(root, 'scripts/api-demos.js')],
    outfile: path.join(root, 'site/api-demos.js'),
    bundle: true,
    format: 'iife',
    target: 'es2020',
    minify: false,
    logLevel: 'warning',
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await bundleDemos();
  const counts = buildApiPage();
  console.log(`site/api.html: ${counts.entries} entries across ${counts.groups} namespaces, ${counts.kit} kit primitives`);
}
