#!/usr/bin/env node
/**
 * The API reference: one page per entry, generated from the API.
 *
 * The list is read out of the TypeScript interfaces rather than written a
 * second time, so a method that exists has a page and a method that goes takes
 * its page with it. Prose comes from the doc comments, examples from the
 * matching `###` heading in `docs/api.md`, and the live demos are wired by
 * hand in `scripts/api-demos.js` -- there is no way to derive "show me this
 * one working" from a type.
 */

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');
const escape = (text) => String(text)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slugify = (text) => text.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();

/* -- reading the types ---------------------------------------------------- */

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

function flatten(lines) {
  return lines.join('\n')
    .replace(/^\s*\/\*\*/, '').replace(/\*\/\s*$/, '')
    .split('\n').map((l) => l.replace(/^\s*\*\s?/, '').trimEnd()).join('\n').trim();
}

/** Members declared at one indent, each with the comment above it. */
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
    let nested = null;
    if (/\{\s*$/.test(line)) {
      const rest = lines.slice(i).join('\n');
      nested = bodyAfter(rest, rest.slice(0, rest.indexOf('{') + 1));
      let depth = 0;
      for (; i < lines.length; i += 1) {
        for (const ch of lines[i]) {
          if (ch === '{') depth += 1;
          else if (ch === '}') depth -= 1;
        }
        if (depth === 0) break;
      }
    }
    out.push({ name: at[2], signature: at[3].replace(/;\s*$/, '').trim(), doc: flatten(doc), nested });
    doc = [];
  }
  return out;
}

const interfaceMembers = (file, name) => {
  const body = bodyAfter(read(file), `export interface ${name}`);
  return body ? membersOf(body, 2) : [];
};

/* -- the model ------------------------------------------------------------ */

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

/** Entries with a playground in scripts/api-demos.js, by slug. */
const LIVE = new Set([
  'kit-el', 'kit-button', 'kit-iconbutton', 'kit-input', 'kit-field', 'kit-select',
  'kit-segmented', 'kit-card', 'kit-emptystate', 'kit-swatch', 'kit-popover',
  'kit-confirm', 'kit-copytext', 'kit-code',
  'helpers-toggle', 'helpers-describehotkey', 'helpers-debounce', 'helpers-badge',
  'helpers-field', 'helpers-section', 'helpers-iconbutton', 'helpers-tooltip',
  'ui-toast', 'ui-modal', 'ui-confirm', 'ui-menu',
  'slack-addtoolbarbutton', 'slack-addmessageaction', 'slack-addprofilebutton',
  'slack-avatarurl', 'dom-h',
]);

/** Pages that are a tool rather than one entry. */
const TOOLS = [
  { slug: 'tool-markdown', name: 'renderMarkdown', group: 'Tools',
    blurb: 'What the panel runs on a mod’s README.' },
  { slug: 'tool-highlight', name: 'highlight · detect', group: 'Tools',
    blurb: 'Colour a code block, and work out its language first.' },
  { slug: 'tool-i18n', name: 'i18n fallbacks', group: 'Tools',
    blurb: 'English is the fallback for an unknown language and a missing key.' },
  { slug: 'tool-roles', name: 'derivePalette', group: 'Tools',
    blurb: 'Two colours in, the twelve theme roles out.' },
];

export function readApi() {
  const top = membersOf(bodyAfter(read('src/runtime/api.ts'), 'export interface PluginApi'), 2);
  const byName = new Map(top.map((m) => [m.name, m]));
  const groups = NAMESPACES.map((ns) => ({
    ...ns,
    doc: byName.get(ns.key)?.doc ?? '',
    entries: ns.inline ? membersOf(byName.get(ns.key)?.nested ?? '', 4) : interfaceMembers(ns.from[0], ns.from[1]),
  }));
  const covered = new Set(NAMESPACES.map((n) => n.key));
  return {
    groups,
    loose: top.filter((m) => !covered.has(m.name) && !m.name.startsWith('__')),
    kit: interfaceMembers('src/runtime/ui/kit.ts', 'Kit'),
  };
}

/** The first fenced block under each `###` heading, by every name it names. */
function examples() {
  const md = read('docs/api.md');
  const found = new Map();
  const re = /^### (.+)$/gm;
  let match;
  while ((match = re.exec(md))) {
    const rest = md.slice(match.index + match[0].length).split(/^### /m)[0];
    const fence = /```(?:js|ts|css|bash)?\n([\s\S]*?)```/.exec(rest);
    if (!fence) continue;
    for (const name of match[1].match(/`([A-Za-z_]\w*)/g) ?? []) found.set(name.slice(1), fence[1].trimEnd());
  }
  return found;
}

/* -- the shell ------------------------------------------------------------ */

const THEMES = [];

/*
 * Code Highlight's own stylesheet, inlined rather than restated: its class
 * names are the tokeniser's output, so a second copy would be a second thing
 * to keep in step with a file nobody would think to check.
 */
const HIGHLIGHT_CSS = read('mods/plugins/code-highlight/highlight.css');

function shell({ title, description, depth, body, active = 'api' }) {
  const up = depth ? '../' : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<meta name="description" content="${escape(description)}">
<link rel="icon" href="${up}mark.svg" type="image/svg+xml">
<link rel="stylesheet" href="${up}style.css">
<link rel="stylesheet" href="${up}slack-context.css">
<link rel="stylesheet" href="${up}api-themes.css">
<style>${HIGHLIGHT_CSS}</style>
</head>
<body class="api-page">

<a class="skip" href="#main">Skip to content</a>

<header class="nav">
  <a class="nav__brand" href="${up}index.html">
    <img src="${up}mark.svg" alt="" width="26" height="26">
    <span>BetterSlack</span>
  </a>
  <nav class="nav__links">
    <a href="${up}api.html"${active === 'api' ? ' aria-current="page"' : ''}>API</a>
  </nav>
  <div class="nav__actions">
    <button class="lang" type="button" id="lang" aria-label="Français">FR</button>
    <a class="btn btn--ghost" href="https://github.com/AirOne-dev/BetterSlack">GitHub</a>
  </div>
</header>

${body}

<footer class="footer">
  <div class="footer__brand">
    <img src="${up}mark.svg" alt="" width="22" height="22">
    <span>BetterSlack <span id="version"></span></span>
  </div>
  <nav class="footer__links">
    <a href="${up}index.html">Home</a>
    <a href="${up}api.html">API</a>
    <a href="https://github.com/AirOne-dev/BetterSlack">GitHub</a>
    <a href="https://github.com/AirOne-dev/BetterSlack/blob/master/docs/getting-started.md" data-en="Getting started" data-fr="Démarrer">Getting started</a>
  </nav>
</footer>

<script src="${up}data.js"></script>
<script src="${up}app.js"></script>
<script src="${up}api-demos.js"></script>
</body>
</html>
`;
}

/** The picker that repaints a preview in any shipped theme. */
function themePicker(slug) {
  return `<div class="stage-bar">
  <label for="theme-${slug}" data-en="Theme" data-fr="Thème">Theme</label>
  <select id="theme-${slug}" class="stage-theme api-select">
    ${THEMES.map((t, i) => `<option value="${t.id}"${i === 0 ? ' selected' : ''}>${escape(t.name)}</option>`).join('\n    ')}
  </select>
  <span class="note" data-en="the same tokens that paint it in Slack" data-fr="les mêmes jetons qui le peignent dans Slack">the same tokens that paint it in Slack</span>
</div>`;
}

/* -- one panel per entry, all in one page --------------------------------- */

/**
 * Every entry is a panel in the same document, and exactly one is shown.
 *
 * Not ninety-eight files: a reference is read by jumping around it, and a jump
 * that costs a page load loses the theme you picked, the arguments you set and
 * your place in the list. The panels fill the viewport instead, the list on
 * the left never moves, and the URL still names what you are looking at.
 */
function panel({ group, entry, slug, example }) {
  const live = LIVE.has(slug);
  const doc = entry.doc
    ? entry.doc.split(/\n\s*\n/).map((p) => `<p>${escape(p).replace(/`([^`]+)`/g, '<code>$1</code>')}</p>`).join('\n')
    : '';
  return `<section class="panel" id="p-${slug}" hidden>
  <header class="panel__head">
    <p class="eyebrow">${escape(group.title)}</p>
    <h1><code>${escape(entry.name)}</code></h1>
    <p class="api-sig api-sig--big">${escape(entry.signature)}</p>
  </header>
  <div class="panel__body">
    ${doc}
    ${live ? `${themePicker(slug)}\n<div class="api-demo" data-demo="${escape(slug)}"></div>` : ''}
    ${example ? `<h2 data-en="Example" data-fr="Exemple">Example</h2>\n<pre class="api-code"><code>${escape(example)}</code></pre>` : ''}
    ${!live && !example ? '<p class="note" data-en="No example yet — the signature above is the whole of it." data-fr="Pas encore d’exemple — la signature ci-dessus dit tout.">No example yet — the signature above is the whole of it.</p>' : ''}
  </div>
</section>`;
}

function toolPanel(tool, markup) {
  return `<section class="panel" id="p-${tool.slug}" hidden>
  <header class="panel__head">
    <p class="eyebrow" data-en="Tools" data-fr="Outils">Tools</p>
    <h1><code>${escape(tool.name)}</code></h1>
    <p class="lede">${escape(tool.blurb)}</p>
  </header>
  <div class="panel__body">${markup}</div>
</section>`;
}

/* -- build ---------------------------------------------------------------- */

export function buildApiPage() {
  const { groups, loose, kit } = readApi();
  const example = examples();
  rmSync(path.join(root, 'site/api'), { recursive: true, force: true });

  const sections = [];
  const collect = (group, entries, prefix) => {
    sections.push({
      group,
      entries: entries.map((entry) => ({ ...entry, slug: `${prefix}-${slugify(entry.name)}` })),
    });
  };

  collect({ title: 'Component kit', key: 'kit', doc: 'What api.ui.kit(document) hands back.' }, kit, 'kit');
  for (const group of groups) collect(group, group.entries, group.key);
  collect({ title: 'On the api object', key: 'plugin', doc: '' }, loose, 'plugin');

  const first = TOOLS[0].slug;
  const nav = [
    `<li class="side__group"><p class="side__title" data-en="Tools" data-fr="Outils">Tools</p>
      <ul>${TOOLS.map((t) => `<li><a href="#${t.slug}">${escape(t.name)}</a></li>`).join('')}</ul></li>`,
    ...sections.map(({ group, entries }) => `<li class="side__group"><p class="side__title">${escape(group.title)}</p>
      <ul>${entries.map((e) => `<li><a href="#${e.slug}">${escape(e.name)}</a></li>`).join('')}</ul></li>`),
  ].join('\n');

  const panels = [
    ...TOOLS.map((tool) => toolPanel(tool, TOOL_MARKUP[tool.slug])),
    ...sections.flatMap(({ group, entries }) => entries.map((entry) => panel({
      group, entry, slug: entry.slug, example: example.get(entry.name),
    }))),
  ].join('\n');

  const body = `<main id="main" class="api">
  <aside class="side" aria-label="API contents">
    <label class="side__search">
      <input type="search" id="side-filter" placeholder="Filter…" aria-label="Filter the list">
    </label>
    <nav><ul class="side__list">${nav}</ul></nav>
  </aside>
  <div class="stack" data-first="${first}">${panels}</div>
</main>`;

  writeFileSync(path.join(root, 'site/api.html'), shell({
    title: 'BetterSlack — the plugin API',
    description: 'Every entry in the BetterSlack plugin API, most of them running in the browser.',
    depth: 0,
    body,
  }));

  const count = sections.reduce((n, s) => n + s.entries.length, 0) + TOOLS.length;
  return { pages: 1, entries: count };
}

/* -- the tool pages' own markup ------------------------------------------- */

const TOOL_MARKUP = {
  'tool-markdown': `<div class="api-split">
  <textarea id="md-source" class="api-input" rows="14" spellcheck="false"># Midnight

A deeper, cooler dark. Overrides Slack's **design tokens** rather than its class
names, so it survives a client update.

- one
- two

\`--dt_color-base-pry: #0b0d12;\`

[Not a link](javascript:alert(1))</textarea>
  <div id="md-out" class="api-output sm-md"></div>
</div>`,
  'tool-highlight': `<div class="api-toolbar">
  <label for="hl-lang" data-en="Language" data-fr="Langage">Language</label>
  <select id="hl-lang" class="api-select"></select>
  <span id="hl-guess" class="note"></span>
</div>
<div class="api-split">
  <textarea id="hl-source" class="api-input" rows="14" spellcheck="false">select channel, count(*) as messages
from events
where sent_at > now() - interval '7 days'
group by channel
order by messages desc
limit 10;</textarea>
  <pre class="api-output"><code id="hl-out" class="betterslack-hl"></code></pre>
</div>`,
  'tool-i18n': `<div class="api-toolbar">
  <label for="i18n-locale">locale</label>
  <select id="i18n-locale" class="api-select">
    <option value="en-GB">en-GB</option>
    <option value="fr-FR">fr-FR</option>
    <option value="de-DE">de-DE</option>
  </select>
  <label for="i18n-key">key</label>
  <select id="i18n-key" class="api-select">
    <option value="hello">hello</option>
    <option value="bye">bye</option>
    <option value="missing">missing</option>
  </select>
  <label for="i18n-name">name</label>
  <input id="i18n-name" class="api-select" value="Ada" size="8">
</div>
<p id="i18n-out" class="api-result"></p>
<pre class="api-code"><code>const t = api.i18n.strings({
  en: { hello: 'Hi {name}, {count} unread', bye: 'See you' },
  fr: { hello: 'Salut {name}, {count} non lus' },
});
t('hello', { name: 'Ada', count: 3 });</code></pre>`,
  'tool-roles': `<div class="api-toolbar">
  <label for="role-base" data-en="Background" data-fr="Fond">Background</label>
  <input type="color" id="role-base" value="#1a1a1e">
  <label for="role-accent" data-en="Accent" data-fr="Accent">Accent</label>
  <input type="color" id="role-accent" value="#536aed">
  <span id="role-css" class="note"></span>
</div>
<div id="role-grid" class="api-roles"></div>`,
};

export function buildThemeTokens() {
  const registry = JSON.parse(read('mods/registry.json'));
  const themes = registry.mods.filter((mod) => mod.type === 'theme');
  const blocks = themes.map((theme) => {
    const css = read(path.join('mods/themes', theme.id, theme.entry ?? 'theme.css'));
    const rootBlock = /:root[^{]*\{([\s\S]*?)\n\}/.exec(css);
    const declarations = (rootBlock ? rootBlock[1] : '').split('\n')
      .filter((line) => /^\s*--/.test(line)).join('\n');
    return `.slack-stage[data-theme="${theme.id}"] {\n${declarations}\n}`;
  });
  writeFileSync(path.join(root, 'site/api-themes.css'),
    `/* Generated by scripts/build-api-page.mjs from mods/themes -- do not edit. */\n\n${blocks.join('\n\n')}\n`);
  THEMES.length = 0;
  THEMES.push(...themes.map((theme) => ({ id: theme.id, name: theme.name })));
  return THEMES;
}

export async function bundleDemos() {
  await esbuild.build({
    entryPoints: [path.join(root, 'scripts/api-demos.js')],
    outfile: path.join(root, 'site/api-demos.js'),
    bundle: true,
    format: 'iife',
    target: 'es2020',
    logLevel: 'warning',
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await bundleDemos();
  buildThemeTokens();
  const counts = buildApiPage();
  console.log(`site/api: ${counts.pages} pages, ${counts.entries} entries`);
}
