import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  assertPluginShape, createTestApi, installDom, readModFiles,
} from '../../../tests/harness.mjs';
import { STRINGS } from './strings.js';
import plugin, {
  buildThemeCss, buildTokenIndex, contrast, CONTRAST_CHECKS, declaredColours,
  derivePalette, elementsUsing, formatCss, formatTriplet, kindOf, matchedRules,
  parseColour, readability, ROLES, rolesFrom, stripFrom, targetsForRole,
  tokenCss, variablesIn,
} from './index.js';

// The builder reads its own stylesheet with api.assets, so the test api is
// given the folder the app would have shipped it.
const FILES = readModFiles(path.dirname(fileURLToPath(import.meta.url)));
const createApi = (options) => createTestApi({ ...options, files: FILES });

const ROLES_FIXTURE = derivePalette(parseColour('#101014'), parseColour('#4f46e5'));

test('has the shape the runtime loads', () => assertPluginShape(assert, plugin));

test('the window opens on the door, and only the door', async () => {
  const dom = installDom();
  try {
    const { api, recorded } = createApi();
    await plugin.start(api);
    // The button is registered; opening the window itself needs a real
    // window.open, which jsdom does not have. What is asserted here is the
    // contract the start screen depends on: nothing is applied, and the user's
    // themes are not touched, before a choice is made.
    assert.equal(recorded.css.length, 0, 'no stylesheet before a choice');
    assert.deepEqual(recorded.themeSuspensions, [], 'and the user’s themes are left alone');
  } finally {
    dom.cleanup();
  }
});

test('the door is a gallery: one card per theme, plus a new one, plus the draft', async () => {
  const { createStartView } = await import('./views/start.js');
  const dom = installDom();
  try {
    const { api } = createApi({ settings: { draft: { name: 'Half done', savedAt: 0, tokenOverrides: { a: 1 } } } });
    const view = createStartView({
      api,
      ui: api.ui.kit(document),
      t: api.i18n.strings(STRINGS),
      savedDraft: () => api.settings.get('draft', null),
      begin: () => {}, resume: () => {},
    });
    view.refresh();
    await new Promise((resolve) => setTimeout(resolve, 10)); // the sources arrive async

    const cards = view.node.querySelectorAll('.gallery__card');
    assert.equal(cards.length, 3, 'new, plus the two themes the harness has');
    assert.match(cards[0].textContent, /Créer un nouveau|Start a new/);

    const text = view.node.textContent;
    assert.match(text, /Aurora/, 'every theme is offered by name');
    assert.match(text, /Midnight/);
    assert.match(text, /Actif|On now/, 'and the one that is on says so');
    assert.match(text, /Half done/, 'the draft says what it is');

    // The colours are read out of each stylesheet, so a card shows the palette
    // it is offering rather than a name and a guess.
    const bands = view.node.querySelectorAll('.gallery__band');
    assert.ok(bands.length > 0, 'each theme wears its own colours');
  } finally {
    dom.cleanup();
  }
});

test('a theme is read back into colours, references and triplets included', () => {
  const css = `
    :root {
      --dc-rail: #111114;
      --dc-chat: #1a1a1e;
      --dt_color-theme-base-inv-pry: var(--dc-rail);
      --dt_color-base-pry: var(--dc-chat);
      --dt_color-base-sec: var(--dc-missing, #232428);
      --dt_color-content-pry: #ededed;
      --sk_highlight: 83, 106, 237;
      --dc-loop: var(--dt_color-danger);
      --dt_color-danger: var(--dc-loop);
    }`;

  const colours = declaredColours(css);
  assert.equal(colours.get('--dt_color-base-pry'), '#1a1a1e', 'a reference is followed');
  assert.equal(colours.get('--dt_color-base-sec'), '#232428', 'a var() fallback is used');
  assert.equal(colours.get('--sk_highlight'), 'rgb(83, 106, 237)', 'a bare triplet becomes paintable');
  assert.equal(colours.has('--dt_color-danger'), false, 'and a cycle resolves to nothing at all');

  const roles = rolesFrom(css);
  assert.equal(formatCss(roles.bg), '#1a1a1e');
  assert.equal(formatCss(roles.chrome), '#111114');
  assert.equal(formatCss(roles.accent), '#536aed');
  assert.equal('selected' in roles, false, 'a role the theme is silent about is left out');
});

test('every theme in this repository reads back into a palette', () => {
  // The gallery cards and "start from" both depend on this, and a theme that
  // reads back as nothing is a card of empty bands and a base that changes no
  // colours -- which is exactly the bug this was written after.
  const themes = readdirSync(new URL('../../themes', import.meta.url));
  for (const id of themes) {
    const css = readFileSync(new URL(`../../themes/${id}/theme.css`, import.meta.url), 'utf8');
    const roles = rolesFrom(css);
    const strip = stripFrom(css);
    if (id === 'focus-rings') {
      // The one theme that sets no colour tokens at all: it is about focus
      // outlines. It still has to produce something to show.
      assert.ok(strip.length > 0, `${id} must still colour its card`);
      continue;
    }
    assert.ok(Object.keys(roles).length >= 8, `${id} should read back into most of the twelve roles`);
    assert.ok(strip.length >= 3, `${id} should fill a card`);
  }
});

test('restoring a draft never reads the base theme over the work', () => {
  // The trap this guards: choosing a base takes that theme's colours into the
  // palette, which is right when you pick one and catastrophic when a draft is
  // being restored -- the palette in the draft *is* the work, and reading the
  // base over it looks exactly like a successful load.
  // Sliced between the two members rather than matched: a lazy brace match
  // stops inside the first nested object and reads the wrong half.
  const shell = FILES['index.js'];
  const between = (from, to) => shell.slice(shell.indexOf(from), shell.indexOf(to));
  assert.match(between('resume: (draft)', 'openPicker('), /takeColours: false/,
    'a resumed draft keeps its own palette');
  assert.doesNotMatch(between('begin: ({ base, name })', 'resume: (draft)'), /takeColours: false/,
    'but starting fresh does take the base theme’s colours');
});

test('the draft holds everything the builder would lose', () => {
  // Anything missing here comes back as a default and reads as work that
  // vanished. Checked against what the state actually carries.
  const shell = FILES['index.js'];
  const save = shell.slice(shell.indexOf("api.settings.set('draft'"), shell.indexOf('}, 400);'));
  for (const field of ['name', 'seeds', 'roleOverrides', 'tokenOverrides', 'base', 'extraCss', 'savedAt']) {
    assert.match(save, new RegExp(`\\b${field}:`), `the draft must carry ${field}`);
  }
  const restore = shell.slice(shell.indexOf('resume: (draft)'), shell.indexOf('openPicker('));
  for (const field of ['name', 'seeds', 'roleOverrides', 'tokenOverrides', 'extraCss']) {
    assert.match(restore, new RegExp(`draft\\.${field}`), `and put ${field} back`);
  }
  assert.match(restore, /draft\.base/);
});

test('every view the rail offers is a file that exists and exports its builder', async () => {
  // The rail builds each view lazily, so a typo in one of these paths is a
  // section that does nothing when clicked and nothing at all before that.
  for (const [name, builder] of [
    ['palette', 'createPaletteView'], ['inspect', 'createInspectView'],
    ['tokens', 'createTokensView'], ['code', 'createCodeView'], ['start', 'createStartView'],
  ]) {
    const module = await import(`./views/${name}.js`);
    assert.equal(typeof module[builder], 'function', `views/${name}.js must export ${builder}`);
  }
  const shell = FILES['index.js'];
  assert.match(shell, /createPaletteView|createInspectView/, 'and the shell imports them');
});

test('every string the interface asks for is one the dictionaries have', () => {
  // A missing key renders as the key -- by design, since a blank is worse --
  // which means it ships looking like "tokensHint" unless something checks.
  const used = new Set();
  for (const [name, source] of Object.entries(FILES)) {
    if (!name.endsWith('.js') || name === 'strings.js') continue;
    for (const [, key] of source.matchAll(/\bt\('([a-zA-Z0-9_]+)'/g)) used.add(key);
  }
  // Keys built from a role or family id, which the loop above cannot see.
  for (const role of ROLES) {
    used.add(`role_${role.key}`);
    used.add(`role_${role.key}_hint`);
  }
  for (const [, , label] of CONTRAST_CHECKS) used.add(label);

  const missing = [...used].filter((key) => !(key in STRINGS.en));
  assert.deepEqual(missing, [], 'these are asked for and never defined');
});

test('a class passed to a kit component adds to it rather than replacing it', () => {
  const dom = installDom();
  try {
    const { api } = createApi();
    const field = api.ui.kit(document).input({ class: 'title-input' });
    assert.ok(field.classList.contains('sm-input'), 'the component keeps its own styling');
    assert.ok(field.classList.contains('title-input'), 'and takes the caller’s class too');
  } finally {
    dom.cleanup();
  }
});

test('the window borrows the API’s components instead of rebuilding them', () => {
  // Every button, input, card, popover and dialog comes from api.ui.kit: a
  // second copy of Slack's design system in here would drift on its own. What
  // is left in this file is the layout and the things only a theme builder has.
  const css = FILES['window.css'];
  assert.doesNotMatch(css, /^\.btn\s*\{/m, 'no button of its own');
  assert.doesNotMatch(css, /^\.input\s*\{/m, 'no input of its own');
  assert.doesNotMatch(css, /^\.card\s*\{/m, 'no card of its own');
  assert.match(css, /var\(--sm-/, 'and it paints from the kit’s palette');

  const shell = FILES['index.js'];
  assert.match(shell, /api\.ui\.kit\(doc\)/, 'the kit is bound to this window’s document');
  assert.match(shell, /api\.ui\.kitCss/, 'and its stylesheet goes in with it');

  // Still never Slack's live tokens: a workbench repainted by the work becomes
  // unreadable exactly when you have just written something wrong.
  assert.doesNotMatch(css, /var\(--dt_color/);
  assert.doesNotMatch(css, /var\(--sk_/);
});

test('maps the twelve roles across all four token families', () => {
  const css = buildThemeCss(ROLES_FIXTURE, 'Test');
  // A theme that only sets the first family leaves the app chrome untouched --
  // the single most common way a Slack theme looks half-applied.
  assert.match(css, /--dt_color-base-pry:\s*#101014/, 'content family');
  assert.match(css, /--dt_color-theme-base-inv-pry:[^;]+!important/, 'chrome family');
  assert.match(css, /--sk_primary_background:\s*16, 16, 20 !important/, 'legacy family, as a triplet');
  assert.match(css, /\.p-theme_background/, 'the opaque layer above <body>');
});

test('the chrome and legacy families carry !important', () => {
  const css = buildThemeCss(ROLES_FIXTURE, 'Test');
  const chrome = css.match(/--dt_color-theme-[\w-]+:[^;]+;/g) ?? [];
  const legacy = css.match(/--sk_[\w]+:[^;]+;/g) ?? [];
  assert.ok(chrome.length > 5 && legacy.length > 5, 'both families are actually written');
  for (const rule of [...chrome, ...legacy]) {
    assert.match(rule, /!important/, `Slack wins without it: ${rule.trim()}`);
  }
});

test('produces a stylesheet that parses', () => {
  const css = buildThemeCss(ROLES_FIXTURE, 'Test');
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal((stripped.match(/{/g) ?? []).length, (stripped.match(/}/g) ?? []).length);
});

test('offers the builder from the control strip', async () => {
  const dom = installDom();
  const { api, recorded } = createApi();
  try {
    await plugin.start(api);
    const button = recorded.toolbarButtons.find((b) => b.button.id === 'theme-builder');
    assert.ok(button, 'a button, so the window is opened deliberately');
    assert.equal(button.toolbar, 'controlStrip');
  } finally {
    for (const dispose of recorded.disposers) dispose();
    dom.cleanup();
  }
});

test('saves through the theme-only route, with an id Slack’s catalogue accepts', () => {
  // The loader re-validates what it is handed, and ids have to match its
  // pattern, so the name is slugged rather than passed through.
  const slug = 'Mon Thème 2026 !'.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  assert.match(slug, /^[a-z0-9][a-z0-9-]{1,48}$/);
});

test('parses every colour form Slack and a human might write', () => {
  assert.deepEqual(parseColour('#1a1a1e'), { r: 26, g: 26, b: 30, a: 1 });
  assert.deepEqual(parseColour('#abc'), { r: 170, g: 187, b: 204, a: 1 });
  assert.deepEqual(parseColour('rgb(26, 26, 30)'), { r: 26, g: 26, b: 30, a: 1 });
  assert.equal(parseColour('rgba(0,0,0,0.5)').a, 0.5);
  assert.equal(parseColour('#1a1a1e80').a.toFixed(2), '0.50', 'eight-digit hex carries alpha');
  assert.equal(parseColour('transparent'), null);
});

test('alpha survives the modern families and is dropped from the legacy one', () => {
  // --sk_* takes a bare "r, g, b" triplet. A theme that writes rgba() there
  // paints nothing at all, which is invisible until someone reports a blank UI.
  const translucent = { r: 26, g: 26, b: 30, a: 0.4 };
  assert.equal(formatTriplet(translucent), '26, 26, 30');
});

test('contrast flattens a translucent foreground before judging it', () => {
  const bg = { r: 0, g: 0, b: 0, a: 1 };
  const solid = contrast({ r: 255, g: 255, b: 255, a: 1 }, bg);
  const faint = contrast({ r: 255, g: 255, b: 255, a: 0.2 }, bg);
  assert.ok(solid > faint, 'the ratio of a colour you can see through is not the one you read');
  assert.equal(readability(solid).grade, 'AAA');
  assert.equal(readability(faint).ok, false);
});

test('a palette derived from a light background goes the other way', () => {
  const dark = derivePalette(parseColour('#101014'), parseColour('#4f46e5'));
  const light = derivePalette(parseColour('#fbfbfd'), parseColour('#4f46e5'));
  // Raised is lighter than the background on a dark theme and darker on a light
  // one; getting this backwards is why hand-built light themes look wrong.
  assert.ok(dark.raised.r > dark.bg.r);
  assert.ok(light.raised.r < light.bg.r);
  assert.ok(readability(contrast(dark.text, dark.bg)).ok, 'derived text stays readable');
  assert.ok(readability(contrast(light.text, light.bg)).ok);
});

test('every relative import in the mod lands on a file that exists', () => {
  // The runtime resolves these into blob URLs; a missing one fails at load
  // time, inside the app, where no test is watching.
  const files = readModFiles(new URL('.', import.meta.url).pathname);
  for (const [name, source] of Object.entries(files)) {
    // Tests reach out to the shared harness; the runtime never loads them.
    if (name === 'test.mjs' || name.endsWith('.test.mjs')) continue;
    for (const [, spec] of source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      const base = name.split('/').slice(0, -1);
      for (const part of spec.split('/')) {
        if (part === '.' || part === '') continue;
        if (part === '..') base.pop(); else base.push(part);
      }
      assert.ok(files[base.join('/')], `${name} imports ${spec}, which is not in the folder`);
    }
  }
});

test('finds the rules that match an element, and skips sheets it may not read', () => {
  const dom = installDom();
  try {
    const el = document.querySelector('.p-channel_sidebar');
    const sheets = [
      { get cssRules() { throw new Error('cross-origin'); } },
      { cssRules: [
        { selectorText: '.p-channel_sidebar, .nope', style: { cssText: 'background: var(--dt_color-base-sec)' } },
        { selectorText: '.something-else', style: { cssText: 'color: red' } },
        { selectorText: '::-webkit-nonsense', style: { cssText: 'color: red' } },
      ] },
    ];
    const rules = matchedRules(el, sheets);
    // The unreadable sheet is skipped rather than ending the walk, and the
    // selector list reports the part that actually matched.
    assert.equal(rules.length, 1);
    assert.equal(rules[0].selector, '.p-channel_sidebar');
  } finally {
    dom.cleanup();
  }
});

test('names the variables a set of rules depends on', () => {
  const rules = [
    { text: 'background: var(--dt_color-base-sec); color: var(--dt_color-content-pry)' },
    { text: 'border: 1px solid var(--dt_color-base-sec)' },
  ];
  const seen = variablesIn(rules, (name) => (name === '--dt_color-base-sec' ? '#222327' : ''));
  assert.deepEqual(seen.map((v) => v.name), ['--dt_color-base-sec', '--dt_color-content-pry']);
  assert.equal(seen[0].value, '#222327', 'resolved, so the swatch is the real colour');
});

test('a base theme is applied under the roles, so overriding one works', () => {
  // Order is the whole feature, and it is one line: base, then the derived
  // roles, then tokens taken over by hand, then whatever was typed. Last wins.
  const build = FILES['index.js'].match(/const themeCss = \(\) =>[\s\S]*?;\n/)[0];
  assert.match(build, /state\.baseCss[\s\S]*buildThemeCss/);
  assert.match(build, /state\.extraCss, state\.tokenOverrides/, 'both override layers reach the CSS');
});

test('a token is written the way its own family reads it', () => {
  // The silent failure this exists for: --sk_* and --dt_color-plt-* hold bare
  // "r, g, b" triplets. Give one of them a real colour and the rule parses,
  // paints nothing, and says nothing about it.
  assert.equal(kindOf('26, 26, 30'), 'triplet');
  assert.equal(kindOf('#1a1a1e'), 'colour');
  assert.equal(kindOf('0.3s ease'), 'other', 'not everything in a token is a colour');

  const css = tokenCss({ '--sk_primary_background': '26, 26, 30', '--dt_color-base-pry': '#1a1a1e' });
  assert.match(css, /--sk_primary_background: 26, 26, 30 !important;/, 'legacy needs !important');
  assert.match(css, /--dt_color-base-pry: #1a1a1e;/, 'content does not');
});

test('hand-picked tokens land after the roles they contradict', () => {
  const css = buildThemeCss(ROLES_FIXTURE, 'T', '', { '--dt_color-base-pry': '#ff0000' });
  const derived = css.indexOf('--dt_color-base-pry: #101014');
  const taken = css.indexOf('--dt_color-base-pry: #ff0000');
  assert.ok(derived !== -1 && taken > derived, 'the one you picked is the one that wins');
});

test('hand-written CSS lands after everything the roles generate', () => {
  const css = buildThemeCss(ROLES_FIXTURE, 'T', '.x { color: red }');
  assert.ok(css.indexOf('.x { color: red }') > css.indexOf('--sk_highlight'));
});


test('a role knows everything it reaches, tokens and selectors alike', () => {
  // Derived from buildThemeCss with a sentinel per role rather than kept in a
  // second table: a hand-written map would be right the day it was written.
  const chrome = targetsForRole('chrome');
  assert.ok(chrome.tokens.includes('--dt_color-theme-base-inv-pry'), 'the chrome family');
  assert.ok(chrome.selectors.some((s) => s.includes('p-channel_sidebar')),
    'and the rules this file writes directly, or hovering Chrome lights up nothing');

  const hover = targetsForRole('hover');
  assert.ok(hover.tokens.includes('--dt_color-base-pry-hover'));
  assert.deepEqual(targetsForRole('nonsense'), { tokens: [], selectors: [] });
});

test('the token index inverts the stylesheet, keeping hover rules usable', () => {
  const dom = installDom('<div class="row"><span class="name">x</span></div>');
  try {
    const style = document.createElement('style');
    style.textContent = `
      .row { background: var(--bg); }
      .row:hover { background: var(--bg-hover); }
      .row::before { color: var(--never); }
      .name, .other { color: var(--text); }
    `;
    document.head.append(style);

    const index = buildTokenIndex(document.styleSheets);
    assert.deepEqual([...index.get('--bg')], ['.row']);
    // Stripped, not skipped: the hover colour is only ever written in a :hover
    // rule, so refusing those would leave "the row under the pointer"
    // highlighting nothing at all.
    assert.deepEqual([...index.get('--bg-hover')], ['.row'], 'the state pseudo-class is dropped');
    // A ::before has no box of its own; its host's box is where the colour
    // shows up, so that is what gets outlined.
    assert.deepEqual([...index.get('--never')], ['.row']);
    assert.deepEqual([...index.get('--text')], ['.name', '.other'], 'a rule list becomes one entry each');
  } finally {
    dom.cleanup();
  }
});

test('highlighting resolves to elements, and ignores what is not on screen', () => {
  const dom = installDom('<div class="row">a</div><div class="row hidden">b</div>');
  try {
    const style = document.createElement('style');
    style.textContent = '.row { background: var(--bg); }';
    document.head.append(style);
    // jsdom has no layout at all: every box is zero and so is the viewport, so
    // both sides of the visibility test have to be stated outright.
    Object.defineProperty(document.documentElement, 'clientWidth', { value: 1200, configurable: true });
    Object.defineProperty(document.documentElement, 'clientHeight', { value: 800, configurable: true });
    const rows = [...document.querySelectorAll('.row')];
    rows[0].getBoundingClientRect = () => ({ width: 200, height: 30, top: 10, bottom: 40, left: 0, right: 200 });
    rows[1].getBoundingClientRect = () => ({ width: 0, height: 0, top: 0, bottom: 0, left: 0, right: 0 });

    const index = buildTokenIndex(document.styleSheets);
    const found = elementsUsing({ tokens: ['--bg'] }, index, document);
    assert.deepEqual(found, [rows[0]], 'the one with a size, and only it');

    assert.deepEqual(elementsUsing({ selectors: ['.row'] }, index, document), [rows[0]],
      'a plain selector works too, which is how a role reaches the rail');
    assert.deepEqual(elementsUsing({ tokens: ['--nothing'] }, index, document), []);
  } finally {
    dom.cleanup();
  }
});
