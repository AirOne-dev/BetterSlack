#!/usr/bin/env node
/**
 * site/api.html, built from docs/api/.
 *
 * The markdown is the source. Every entry in the plugin API is one file there
 * -- description, signature, example, which preview to render and what knobs
 * it takes -- and this turns the folder into a page. Nothing about an entry is
 * written twice, so nothing about an entry can disagree with itself.
 *
 * The TypeScript is still consulted, but only as a check: if a signature in
 * the markdown has drifted from the interface, or an entry exists in one and
 * not the other, the build fails and says which. Docs are the source; code is
 * the proof.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import * as esbuild from 'esbuild';
import { readEntries } from './api-doc.mjs';
import { LANGUAGES } from '../mods/plugins/code-highlight/tokenise.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');
const escape = (text) => String(text)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ORDER = ['tools', 'kit', 'helpers', 'slack', 'ui', 'dom', 'i18n', 'settings',
  'commands', 'files', 'assets', 'themes', 'app', 'log', 'plugin'];

/*
 * `tools` is not part of `PluginApi`.
 *
 * These are the pieces a mod imports rather than receives -- the readme
 * renderer, the tokeniser, the palette derivation -- and they are worth a page
 * each, so the cross-check against the interfaces skips them rather than
 * calling them orphans.
 */
const NOT_ON_THE_API = new Set(['tools']);

/* -- the check against the code ------------------------------------------- */

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

function membersOf(block, indent) {
  const out = [];
  const lines = block.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const at = new RegExp(`^ {${indent}}(readonly )?([A-Za-z_]\\w*)\\s*([(<:?].*)$`).exec(lines[i]);
    if (!at) continue;
    let nested = null;
    if (/\{\s*$/.test(lines[i])) {
      // Take the block whole and skip past it, so its members are not read as
      // if they were siblings of the thing that contains them.
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
    out.push({ name: at[2], signature: at[3].replace(/;\s*$/, '').trim(), nested });
  }
  return out;
}

const NAMESPACES = [
  ['helpers', 'src/runtime/helpers.ts', 'Helpers'],
  ['slack', 'src/runtime/slack-api.ts', 'SlackApi'],
  ['i18n', 'src/runtime/i18n.ts', 'I18n'],
  ['kit', 'src/runtime/ui/kit.ts', 'Kit'],
];

/** What the TypeScript says exists, by slug. */
function fromCode() {
  const slugify = (t) => t.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  const found = new Set();
  for (const [key, file, name] of NAMESPACES) {
    for (const member of membersOf(bodyAfter(read(file), `export interface ${name}`), 2)) {
      found.add(`${key}-${slugify(member.name)}`);
    }
  }
  const byReference = new Set(NAMESPACES.map(([key]) => key));
  for (const member of membersOf(bodyAfter(read('src/runtime/api.ts'), 'export interface PluginApi'), 2)) {
    if (byReference.has(member.name)) continue;
    if (member.name.startsWith('__')) continue;
    if (member.nested) {
      for (const child of membersOf(member.nested, 4)) {
        found.add(`${slugify(member.name)}-${slugify(child.name)}`);
      }
    } else {
      found.add(`plugin-${slugify(member.name)}`);
    }
  }
  return found;
}

/**
 * The markdown and the code have to agree.
 *
 * Only about *what exists* -- a signature is reformatted by hand often enough
 * that comparing them character by character would cry wolf. An entry in one
 * and not the other is the failure that matters: it means somebody added a
 * method and did not document it, or removed one and left its page behind.
 */
function crossCheck(groups) {
  const documented = new Set(groups
    .filter((group) => !NOT_ON_THE_API.has(group.key))
    .flatMap((group) => group.entries.map((entry) => entry.slug)));
  const declared = fromCode();
  const undocumented = [...declared].filter((slug) => !documented.has(slug));
  const orphaned = [...documented].filter((slug) => !declared.has(slug));
  if (undocumented.length || orphaned.length) {
    const parts = [];
    if (undocumented.length) parts.push(`in the code but not in docs/api/: ${undocumented.join(', ')}`);
    if (orphaned.length) parts.push(`in docs/api/ but not in the code: ${orphaned.join(', ')}`);
    throw new Error(parts.join('\n'));
  }
}

/**
 * A `preview:` has to name a renderer, and a renderer has to be named.
 *
 * Both halves matter. A preview naming nothing leaves an empty box under a
 * heading, which reads as a demo that broke; a renderer nobody names is a demo
 * that was written and then quietly lost, which is exactly what happened to
 * three of the helpers when this folder was first written.
 */
function crossCheckPreviews(groups) {
  const source = read('scripts/api-previews.js');
  const kit = [...source.matchAll(/^  ([a-zA-Z]+): \{$/gm)].map((m) => m[1]);
  const at = (name) => source.indexOf(`\n  ${name}: {`);
  const kitAt = source.indexOf('const KIT = {');
  const helpersAt = source.indexOf('const HELPERS = {');
  const restAt = source.indexOf('/* -- the Slack-styled widgets');
  const available = new Set([
    ...kit.filter((n) => at(n) > kitAt && at(n) < helpersAt).map((n) => `kit-${n.toLowerCase()}`),
    ...kit.filter((n) => at(n) > helpersAt && at(n) < restAt).map((n) => `helpers-${n.toLowerCase()}`),
    ...[...source.matchAll(/^  '([a-z0-9-]+)':/gm)].map((m) => m[1]),
  ]);

  const declared = new Set(groups.flatMap((g) => g.entries).filter((e) => e.preview).map((e) => e.preview));
  const missing = [...declared].filter((slug) => !available.has(slug));
  const unused = [...available].filter((slug) => !declared.has(slug));
  if (missing.length || unused.length) {
    const parts = [];
    if (missing.length) parts.push(`preview: names no renderer: ${missing.join(', ')}`);
    if (unused.length) parts.push(`renderer nobody names: ${unused.join(', ')}`);
    throw new Error(parts.join('\n'));
  }
}

/* -- the shell ------------------------------------------------------------ */

const THEMES = [];
const HIGHLIGHT_CSS = read('mods/plugins/code-highlight/highlight.css');

/* -- the guide -------------------------------------------------------------- *
 *
 * `docs/guide/*.md` is plain markdown with three keys at the top, and it is the
 * source the same way `docs/api/*.md` is: the page is generated from it, so a
 * step that is wrong is wrong in one place. The API entries have a format of
 * their own because every one of them has a signature and a preview; a guide
 * has neither, and forcing it into that shape would have meant inventing keys
 * nobody fills in.
 *
 * The renderer below is deliberately small -- headings, paragraphs, lists,
 * fenced code, and inline code, bold and links. Anything a step-by-step guide
 * needs and nothing else. A markdown dependency here would be a parser with a
 * specification standing between a writer and eight files.
 */

/*
 * What a fence says, and what the tokeniser calls it.
 *
 * Writers type ```js and ```yml; Code Highlight's grammars are named
 * `javascript` and `yaml`. There is no fallback on purpose: a skipped block
 * renders as flat grey text, which looks like a block that has no highlighting
 * rather than like a mistake -- five JavaScript examples in the guide once went
 * out uncoloured and nothing said so. The build fails instead, naming the
 * fence.
 *
 * The label above the block keeps what was written -- JS reads better than
 * JAVASCRIPT -- so the two are separate attributes.
 */
const ALIASES = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  sh: 'bash', shell: 'bash', console: 'bash', zsh: 'bash',
  yml: 'yaml', md: 'markdown', text: 'plain', txt: 'plain',
  /*
   * PowerShell is declared uncoloured rather than left to fail.
   *
   * install.ps1 has to appear in the guide, and the tokeniser has no PowerShell
   * grammar. Adding one would mean teaching the mod to *detect* PowerShell as
   * well -- Slack sends a code block with nothing to say what is in it -- or
   * Code Highlight's own count of the languages it handles becomes a claim that
   * is false everywhere except this page. Mapping it here is the honest middle:
   * the block is grey on purpose, and the label above it still reads PowerShell,
   * so it is a language we do not colour rather than a block that failed to.
   */
  powershell: 'plain', ps1: 'plain',
};

function languageOf(written) {
  const name = ALIASES[written] ?? written;
  if (name !== 'plain' && !(name in LANGUAGES)) {
    throw new Error(`docs/guide: \`\`\`${written} is not a language the tokeniser knows. `
      + `Use one of: ${Object.keys(LANGUAGES).join(', ')}`);
  }
  return name;
}

function renderInline(text) {
  return escape(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
}

function renderMarkdown(md) {
  const out = [];
  const lines = md.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Fenced code, taken verbatim and coloured in the page by the tokeniser
    // this project ships -- the same one Code Highlight uses in Slack.
    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      const body = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { body.push(lines[i]); i += 1; }
      i += 1;
      const written = fence[1] || 'js';
      out.push(`<pre class="api-code" data-lang="${escape(languageOf(written))}"`
        + ` data-label="${escape(written)}">`
        + `<code>${escape(body.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = /^(#{2,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i]) || (items.length && /^\s{2,}\S/.test(lines[i])))) {
        if (/^\s*[-*]\s+/.test(lines[i])) items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        else items[items.length - 1] += ` ${lines[i].trim()}`;
        i += 1;
      }
      out.push(`<ul>${items.map((it) => `<li>${renderInline(it)}</li>`).join('')}</ul>`);
      continue;
    }

    if (line.trim() === '') { i += 1; continue; }

    const para = [];
    while (i < lines.length && lines[i].trim() !== ''
      && !/^```/.test(lines[i]) && !/^#{2,4}\s/.test(lines[i]) && !/^\s*[-*]\s+/.test(lines[i])) {
      para.push(lines[i].trim());
      i += 1;
    }
    out.push(`<p>${renderInline(para.join(' '))}</p>`);
  }
  return out.join('\n');
}

/** The guide pages, in the order their `order:` key gives. */
function readGuide() {
  const dir = path.join(root, 'docs/guide');
  return readdirSync(dir).filter((f) => f.endsWith('.md')).map((file) => {
    const raw = readFileSync(path.join(dir, file), 'utf8');
    const parsed = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
    if (!parsed) throw new Error(`docs/guide/${file}: no front matter`);
    const meta = Object.fromEntries(parsed[1].split('\n')
      .filter(Boolean)
      .map((l) => {
        const at = l.indexOf(':');
        if (at === -1) throw new Error(`docs/guide/${file}: "${l}" is not key: value`);
        return [l.slice(0, at).trim(), l.slice(at + 1).trim()];
      }));
    for (const key of ['name', 'title', 'order']) {
      if (!meta[key]) throw new Error(`docs/guide/${file}: missing ${key}`);
    }
    const body = parsed[2].trim();
    if (!body) throw new Error(`docs/guide/${file}: nothing but front matter`);
    return { slug: `guide-${file.replace(/\.md$/, '')}`, name: meta.name, title: meta.title,
      order: Number(meta.order), body };
  }).sort((a, b) => a.order - b.order);
}

function guidePanel(page) {
  return `<section class="panel panel--guide" id="p-${page.slug}" hidden>
  <header class="panel__head">
    <p class="eyebrow">${escape(page.title)}</p>
    <h1>${escape(page.name)}</h1>
  </header>
  <div class="panel__body">
${renderMarkdown(page.body)}
  </div>
</section>`;
}

/*
 * When each page was last touched, from git rather than from a key somebody has
 * to remember to bump.
 *
 * In a file of its own, and deliberately not committed. Every other generated
 * file here is committed and checked for drift, which cannot work for this one:
 * the date of `docs/api/x.md` is the date of the commit that changes it, so a
 * page generated before that commit is stale the instant it is made, and CI --
 * which regenerates and compares -- would fail on every documentation change.
 * Generated fresh on each build instead, including in the job that publishes.
 *
 * That job needs `fetch-depth: 0`: the default checkout is one commit deep and
 * `git log` per file comes back empty.
 */
function buildUpdated(entries, guide) {
  const dateOf = (rel) => {
    try {
      return execFileSync('git', ['log', '-1', '--format=%cs', '--', rel],
        { cwd: root, encoding: 'utf8' }).trim();
    } catch {
      return '';
    }
  };
  const dates = {};
  for (const entry of entries) dates[entry.slug] = dateOf(`docs/api/${entry.slug}.md`);
  for (const page of guide) dates[page.slug] = dateOf(`docs/guide/${page.slug.replace(/^guide-/, '')}.md`);
  writeFileSync(path.join(root, 'site/api-updated.js'),
    `/* Generated by scripts/build-api-page.mjs from git -- not committed, see the note there. */\n`
    + `window.__API_UPDATED = ${JSON.stringify(dates, null, 2)};\n`);
  return dates;
}

function shell({ title, description, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<meta name="description" content="${escape(description)}">
<link rel="icon" href="mark.svg" type="image/svg+xml">
<link rel="stylesheet" href="style.css">
<link rel="stylesheet" href="slack-context.css">
<link rel="stylesheet" href="api-themes.css">
<style>${HIGHLIGHT_CSS}</style>
</head>
<body class="api-page">

<a class="skip" href="#main">Skip to content</a>

<header class="nav">
  <a class="nav__brand" href="index.html">
    <img src="mark.svg" alt="" width="26" height="26">
    <span>BetterSlack</span>
  </a>
  <nav class="nav__links">
    <a href="api.html" aria-current="page" data-en="Doc" data-fr="Doc">Doc</a>
  </nav>
  <div class="nav__actions">
    <label class="stage-bar" for="stage-theme">
      <span data-en="Theme" data-fr="Thème">Theme</span>
      <select id="stage-theme" class="api-select">
        ${THEMES.map((t, i) => `<option value="${t.id}"${i === 0 ? ' selected' : ''}>${escape(t.name)}</option>`).join('\n        ')}
      </select>
    </label>
    <button class="lang" type="button" id="lang" aria-label="Français">FR</button>
    <a class="btn btn--ghost" href="https://github.com/AirOne-dev/BetterSlack">GitHub</a>
  </div>
</header>

${body}

<script src="data.js"></script>
<script src="app.js"></script>
<script src="api-fixtures.js"></script>
<script src="api-updated.js"></script>
<script src="api-previews.js"></script>
</body>
</html>
`;
}

/* -- one panel per entry -------------------------------------------------- */

function panel(entry) {
  /*
   * The same renderer the guide uses, rather than a paragraph split of its own.
   * An entry's prose is markdown like any other: `addToolbarButton` lists its
   * three toolbars, and with paragraphs-only that list ran together into one
   * sentence with the indentation collapsed.
   */
  const prose = renderMarkdown(entry.prose);
  const preview = entry.preview
    ? `<div class="api-demo" data-demo="${escape(entry.preview)}" data-controls="${escape(JSON.stringify(entry.controls))}"></div>`
    : '';
  return `<section class="panel" id="p-${entry.slug}" hidden>
  <header class="panel__head">
    <p class="eyebrow">${escape(entry.title)}</p>
    <h1><code>${escape(entry.name)}</code></h1>
    <p class="api-sig api-sig--big">${escape(entry.signature)}</p>
    <p class="api-since">${entry.since === 'unreleased'
      ? 'Not in a release yet &mdash; a mod using this needs a BetterSlack built from the default branch.'
      : `Since BetterSlack ${escape(entry.since)}`}</p>
  </header>
  <div class="panel__body">
    ${prose}
    ${preview}
    <h2 data-en="Example" data-fr="Exemple">Example</h2>
    <pre class="api-code"><code>${escape(entry.example)}</code></pre>
  </div>
</section>`;
}

export function buildApiPage() {
  const groups = readEntries(path.join(root, 'docs/api'), ORDER);
  crossCheck(groups);
  crossCheckPreviews(groups);

  /*
   * The guide first, and it is what the page opens on.
   *
   * A reference is what you come back to; a guide is what you need the first
   * time. Landing somebody on `tools.highlight` because it sorted first was an
   * accident of the ordering, not a decision.
   */
  const guide = readGuide();
  const sections = [
    { title: guide[0].title, entries: guide, guide: true },
    ...groups.map((group) => ({ ...group, guide: false })),
  ];

  const first = sections[0].entries[0].slug;
  const nav = sections.map((group) => `<li class="side__group"><p class="side__title">${escape(group.title)}</p>
      <ul>${group.entries.map((e) => `<li><a href="#${e.slug}">${escape(e.name)}</a></li>`).join('')}</ul></li>`).join('\n');

  /*
   * The list is a column on a desktop and a drawer on a phone.
   *
   * Below 900px it cannot stay open above the content: in a 220px window that
   * is four entries of a hundred visible, on every page, taking a third of the
   * screen before anything you came for. The button below is what opens it
   * there, and says where you are while it is shut; on a desktop it is not
   * drawn at all.
   */
  const body = `<main id="main" class="api">
  <button class="side__open" type="button" id="side-open" aria-expanded="false" aria-controls="side-nav">
    <svg viewBox="0 0 20 20" aria-hidden="true" width="18" height="18">
      <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>
    </svg>
    <span class="side__open__label" id="side-open-label">Contents</span>
  </button>
  <div class="side__scrim" id="side-scrim" hidden></div>
  <aside class="side" id="side-nav" aria-label="API contents">
    <label class="side__search">
      <input type="search" id="side-filter" placeholder="Filter…" aria-label="Filter the list">
    </label>
    <label class="side__sort" for="side-order">
      <span data-en="Order" data-fr="Ordre">Order</span>
      <select id="side-order" class="api-select">
        <option value="name" data-en="A to Z" data-fr="De A à Z">A to Z</option>
        <option value="updated" data-en="Recently updated" data-fr="Modifiés récemment">Recently updated</option>
      </select>
    </label>
    <nav><ul class="side__list">${nav}</ul></nav>
  </aside>
  <div class="stack" data-first="${first}"><div class="stack__inner">${sections.flatMap((g) => g.entries.map(g.guide ? guidePanel : panel)).join('\n')}</div></div>
</main>`;

  writeFileSync(path.join(root, 'site/api.html'), shell({
    title: 'BetterSlack — documentation',
    description: 'How to install BetterSlack and write a plugin or a theme, and every entry in the plugin API, most of them running in the browser.',
    body,
  }));

  buildUpdated(groups.flatMap((g) => g.entries), guide);
  writeDocsIndex(groups);

  const entries = groups.reduce((n, g) => n + g.entries.length, 0);
  return {
    entries,
    guide: guide.length,
    previews: groups.flatMap((g) => g.entries).filter((e) => e.preview).length,
  };
}

/**
 * docs/api.md, which is a way in rather than the reference itself.
 *
 * The entries live one per file beside it; this is the list, generated from the
 * same folder the site is, so neither can fall behind the code. Written out by
 * hand it would be a thousand lines to keep in step with the types.
 */
function writeDocsIndex(groups) {
  const lines = [
    '# The plugin API',
    '',
    'A plugin is an ES module that exports `start(api)`. Everything it registers is',
    'undone when it is switched off.',
    '',
    'Each entry has a page of its own in [`docs/api/`](api/), with its signature, what',
    'it is for and an example. Most of them also run in a browser: the same list is at',
    '**<https://airone-dev.github.io/BetterSlack/api.html>**, where you can change the',
    'arguments and watch the result.',
    '',
    'The format those files are written in is described in',
    '[CLAUDE.md](../CLAUDE.md#the-api-documentation-format) — one file per entry, a',
    'few keys at the top, prose, and one example.',
    '',
    'Each entry says which release it arrived in. That is not decoration: a mod is',
    'refused by an install too old to run it, and the version it needs is worked out',
    'from exactly these numbers and what the mod calls.',
    '',
  ];
  for (const group of groups) {
    lines.push(`## ${group.title}`, '');
    for (const entry of group.entries) {
      const first = entry.prose.split(/\n/)[0].replace(/\s+/g, ' ');
      const since = entry.since === 'unreleased' ? ' _(unreleased)_' : ` _(since ${entry.since})_`;
      lines.push(`- [\`${entry.name}\`](api/${entry.slug}.md) — ${first}${since}`);
    }
    lines.push('');
  }
  writeFileSync(path.join(root, 'docs/api.md'), `${lines.join('\n')}`);
}

export function buildThemeTokens() {
  const registry = JSON.parse(read('mods/registry.json'));
  const themes = registry.mods.filter((mod) => mod.type === 'theme');
  const blocks = themes.map((theme) => {
    const css = read(path.join('mods/themes', theme.id, theme.entry ?? 'theme.css'));
    /*
     * Every `:root` block, not the first one.
     *
     * A theme declares its colours in two: the `--dt_color-*` families in one,
     * the legacy `--sk_*` triplets in another further down. Taking only the
     * first dropped the whole legacy family, whose fallbacks in BetterSlack's
     * own CSS are Slack's *light* defaults -- so on a dark theme the dialog's
     * hint text came out near-black on near-black, and the primary button lost
     * its fill. `--sk_foreground_low` alone is referenced 31 times.
     */
    const declarations = [...css.matchAll(/:root[^{]*\{([\s\S]*?)\n\}/g)]
      .flatMap((block) => block[1].split('\n'))
      .filter((line) => /^\s*--/.test(line))
      .join('\n');
    /*
     * Two more properties, because half of these themes are translucent by
     * design.
     *
     * `--dt_color-base-pry` is what Slack paints panes with, and in Aurora it is
     * `rgba(18, 16, 34, 0.34)` -- frosted glass, meant to sit over the gradient
     * the theme puts on `body`. Reproduce only the token and the preview is a
     * third-opaque smear of whatever the site is painted with, and a dialog is
     * unreadable. So the theme's own backdrop travels with its tokens:
     * `--api-backdrop` is the colour under the glass, `--api-backdrop-image`
     * whatever it draws on top of that, and the stage stacks the three the way
     * the client does. Taken from the theme's `body` rule, and from its opaque
     * `--dt_color-base-pry` when it has no such rule; the value may well be a
     * `var()` into the theme's own palette, which resolves in the page.
     */
    const bodyRule = /(?:^|\n)body\s*\{([^}]*)\}/.exec(css);
    const declared = (name, from) => {
      const found = new RegExp(`(?:^|;|\\n)\\s*${name}\\s*:([^;]+)`).exec(from ?? '');
      return found ? found[1].trim().replace(/\s*!important$/, '') : null;
    };
    const basePry = declared('--dt_color-base-pry', declarations);
    const backdrop = declared('background-color', bodyRule?.[1])
      ?? (basePry && !/rgba|hsla|transparent|\/\s*0?\.\d/.test(basePry) ? basePry : null);
    const image = declared('background-image', bodyRule?.[1]);
    const extra = [
      backdrop ? `  --api-backdrop: ${backdrop};` : null,
      image ? `  --api-backdrop-image: ${image};` : null,
    ].filter(Boolean).join('\n');

    /*
     * Both selectors, and the second is not decoration: a dialog, a menu and a
     * tooltip render into `document.body`, so tokens defined only on the
     * preview box never reach them -- which is exactly how the modal came to be
     * an unstyled heading at the bottom of the page.
     */
    return `.slack-stage[data-theme="${theme.id}"],\nbody.api-page[data-theme="${theme.id}"] {\n${declarations}${extra ? `\n${extra}` : ''}\n}`;
  });
  writeFileSync(path.join(root, 'site/api-themes.css'),
    `/* Generated by scripts/build-api-page.mjs from mods/themes -- do not edit. */\n\n${blocks.join('\n\n')}\n`);
  THEMES.length = 0;
  THEMES.push(...themes.map((theme) => ({ id: theme.id, name: theme.name })));
  return THEMES;
}

/*
 * A snapshot of the repository, for the entries whose answer *is* a file.
 *
 * `api.themes.source`, `api.assets.list` and `api.assets.text` hand a mod its
 * own folder. There is no folder on a web page and no honest way to invent one,
 * so the build takes a real one -- a theme's stylesheet and a plugin's files --
 * and writes it out beside the page. What the preview shows is what the call
 * returns in the client, from the same bytes, rather than a mock-up of it.
 *
 * A plain script rather than part of the bundle: it is data, it changes when
 * the mods change, and keeping it separate means a mod edit does not rebuild
 * the previews.
 */
export function buildFixtures() {
  const theme = 'midnight';
  const plugin = 'channel-notes';
  const lines = (text, count) => text.split('\n').slice(0, count).join('\n');

  const dir = path.join(root, 'mods/plugins', plugin);
  const files = readdirSync(dir).filter((name) => !name.startsWith('.')).sort();

  const snapshot = {
    theme: { id: theme, css: lines(read(path.join('mods/themes', theme, 'theme.css')), 46) },
    plugin: {
      id: plugin,
      files,
      manifest: JSON.parse(read(path.join('mods/plugins', plugin, 'mod.json'))),
      entry: lines(read(path.join('mods/plugins', plugin, 'index.js')), 34),
    },
  };
  writeFileSync(path.join(root, 'site/api-fixtures.js'),
    `/* Generated by scripts/build-api-page.mjs from mods/ -- do not edit. */\n`
    + `window.__API_FIXTURES = ${JSON.stringify(snapshot, null, 2)};\n`);
  return snapshot;
}

export async function bundlePreviews() {
  await esbuild.build({
    entryPoints: [path.join(root, 'scripts/api-previews.js')],
    outfile: path.join(root, 'site/api-previews.js'),
    bundle: true,
    format: 'iife',
    target: 'es2020',
    logLevel: 'warning',
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildFixtures();
  await bundlePreviews();
  buildThemeTokens();
  const counts = buildApiPage();
  console.log(`site/api.html: ${counts.entries} entries, ${counts.previews} with a preview`);
}
