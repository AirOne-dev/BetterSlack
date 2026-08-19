/**
 * The live half of the API page.
 *
 * Everything here imports the real implementation rather than a copy of it:
 * the kit a mod gets from `api.ui.kit`, the markdown renderer the panel uses
 * for a readme, Code Highlight's own tokeniser and language detector, and the
 * theme builder's role derivation. If one of them changes, the page changes
 * with it, and if one of them stops compiling the site build fails.
 *
 * What is *not* here is anything that needs Slack: a toolbar button, a message
 * action, the web API. Those are shown as code with a note saying where they
 * run. Re-implementing them for a marketing page would be a second version of
 * something this project deliberately keeps single.
 *
 * Bundled into site/api-demos.js by scripts/build-api-page.mjs.
 */

import { createKit } from '../src/runtime/ui/kit.js';
import { KIT_CSS } from '../src/runtime/ui/kit-css.js';
import { renderMarkdown } from '../src/runtime/ui/markdown.js';
import { highlight, LANGUAGES } from '../mods/plugins/code-highlight/tokenise.js';
import { detect } from '../mods/plugins/code-highlight/detect.js';
import { ROLES } from '../mods/plugins/theme-builder/roles.js';
import {
  contrast, derivePalette, formatCss, parseColour, readability,
} from '../mods/plugins/theme-builder/colour.js';

const kit = createKit(document);
const $ = (id) => document.getElementById(id);

/** Put the kit's own stylesheet in the page, once. */
function installKitCss() {
  if (document.getElementById('sm-kit-css')) return;
  const style = document.createElement('style');
  style.id = 'sm-kit-css';
  style.textContent = KIT_CSS;
  document.head.append(style);
}

/* -- the component gallery ------------------------------------------------ */

/**
 * Each entry renders itself into its own slot and says what it was called
 * with, so the code beside the demo is the code that produced it rather than
 * an approximation of it.
 */
const DEMOS = {
  el: () => [kit.el('div', { class: 'sm-card' }, [
    kit.el('strong', {}, ['kit.el']),
    kit.el('p', { class: 'sm-hint', style: 'margin:4px 0 0' }, ['The same maker every primitive below is built from.']),
  ])],
  copyText: () => {
    const button = kit.button('Copy “#611f69”');
    const said = kit.el('span', { class: 'sm-hint', style: 'margin-left:10px' }, ['']);
    button.addEventListener('click', async () => {
      said.textContent = (await kit.copyText('#611f69')) ? 'copied' : 'the clipboard said no';
    });
    return [button, said];
  },
  button: () => [
    kit.button('Save', { variant: 'primary' }),
    kit.button('Cancel'),
    kit.button('Skip', { variant: 'ghost' }),
    kit.button('Remove', { variant: 'danger' }),
  ],
  buttonWide: () => [kit.button('Apply to every theme', { variant: 'primary', wide: true })],
  iconButton: () => [
    kit.iconButton('✎', { title: 'Rename' }),
    kit.iconButton('⧉', { title: 'Duplicate' }),
    kit.iconButton('🗑', { title: 'Delete', danger: true }),
  ],
  input: () => [kit.input({ value: 'Midnight', placeholder: 'Theme name' })],
  field: () => [kit.field('Theme name', kit.input({ value: 'Midnight' }), 'Shown in the panel and in the palette.')],
  select: () => [kit.select(
    [{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }],
    { value: 'dark' },
  )],
  segmented: () => [kit.segmented(
    [{ value: 'colours', label: 'Colours', count: 12 }, { value: 'css', label: 'CSS' }],
    { value: 'colours' },
  ).node],
  card: () => [kit.card('Palette', [kit.el('p', { class: 'sm-hint' }, ['Two colours, ten derived.'])], {
    actions: [kit.button('Reset', { variant: 'ghost' })],
  })],
  emptyState: () => [kit.emptyState('No themes yet', 'Build one and it appears here.', kit.button('New theme', { variant: 'primary' }))],
  swatch: () => ['sm', 'md', 'lg'].map((size) => kit.swatch('#611f69', { size })),
  checker: () => [kit.swatch('rgba(97, 31, 105, 0.35)', { size: 'lg' })],
  popover: () => {
    const anchor = kit.button('Open a popover');
    anchor.addEventListener('click', () => {
      const content = kit.el('div', { style: 'padding:12px;min-width:200px' }, [
        kit.el('p', { class: 'sm-hint', style: 'margin:0 0 10px' }, ['Anchored, and dismissed on a click outside.']),
        kit.button('Got it', { variant: 'primary', wide: true }),
      ]);
      const pop = kit.popover(content, anchor);
      content.querySelector('button').addEventListener('click', () => pop.close());
    });
    return [anchor];
  },
  confirm: () => {
    const trigger = kit.button('Delete the theme', { variant: 'danger' });
    const said = kit.el('span', { class: 'sm-hint', style: 'margin-left:10px' }, ['']);
    trigger.addEventListener('click', async () => {
      const yes = await kit.confirm({
        title: 'Delete Midnight?',
        body: 'The stylesheet goes with it. This cannot be undone.',
        action: 'Delete',
        cancel: 'Keep it',
        danger: true,
      });
      said.textContent = yes ? 'you chose Delete' : 'you chose Keep it';
    });
    return [trigger, said];
  },
  code: () => {
    const editor = kit.code({
      value: ':root {\n  --dt_color-base-pry: #0b0d12;\n  /* the message surface */\n}',
    });
    return [editor.node];
  },
};

function mountGallery() {
  for (const [name, build] of Object.entries(DEMOS)) {
    const slot = document.querySelector(`[data-demo="${name}"]`);
    if (!slot) continue;
    try {
      slot.replaceChildren(...build());
    } catch (err) {
      slot.textContent = `this demo failed: ${err.message}`;
    }
  }
}

/* -- markdown ------------------------------------------------------------- */

function mountMarkdown() {
  const source = $('md-source');
  const out = $('md-out');
  if (!source || !out) return;
  const draw = () => {
    // The same call the panel makes for a mod's readme, escaping first and
    // dropping a javascript: URL.
    out.innerHTML = renderMarkdown(source.value);
  };
  source.addEventListener('input', draw);
  draw();
}

/* -- code highlighting ---------------------------------------------------- */

function mountHighlight() {
  const source = $('hl-source');
  const out = $('hl-out');
  const guess = $('hl-guess');
  const pick = $('hl-lang');
  if (!source || !out) return;

  if (pick) {
    pick.replaceChildren(
      new Option('detect it for me', ''),
      ...Object.keys(LANGUAGES).sort().map((id) => new Option(id, id)),
    );
  }
  const draw = () => {
    const chosen = pick && pick.value ? pick.value : detect(source.value);
    if (guess) {
      guess.textContent = pick && pick.value
        ? `forced to ${chosen}`
        : (chosen ? `detected: ${chosen}` : 'not confident — left alone, which is the point');
    }
    out.innerHTML = chosen ? highlight(source.value, chosen) : source.value.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'));
  };
  source.addEventListener('input', draw);
  pick?.addEventListener('change', draw);
  draw();
}

/* -- theme roles ---------------------------------------------------------- */

function mountRoles() {
  const base = $('role-base');
  const accent = $('role-accent');
  const grid = $('role-grid');
  const out = $('role-css');
  if (!base || !accent || !grid) return;

  const draw = () => {
    /*
     * The real derivation: two seeds in, twelve roles out. `derivePalette` is
     * the function the theme builder itself calls, so what the page shows is
     * what a theme would be painted with.
     */
    const palette = derivePalette(parseColour(base.value), parseColour(accent.value));
    grid.replaceChildren(...ROLES.map((role) => kit.el('div', { class: 'role' }, [
      kit.swatch(formatCss(palette[role.key]), { size: 'md' }),
      kit.el('div', { class: 'role__text' }, [
        kit.el('strong', {}, [role.key + (role.seed ? ' (seed)' : '')]),
        kit.el('span', { class: 'sm-hint' }, [formatCss(palette[role.key])]),
      ]),
    ])));
    if (out) {
      // `readability` answers with { grade, ok }, not a string: the grade is
      // what a person reads, and `ok` is what a builder would colour on.
      const ratio = contrast(palette.text, palette.bg);
      const verdict = readability(ratio);
      out.textContent = `contrast(text, bg) = ${ratio.toFixed(2)} — ${verdict.grade}`;
      out.classList.toggle('is-bad', !verdict.ok);
    }
  };
  base.addEventListener('input', draw);
  accent.addEventListener('input', draw);
  draw();
}

/* -- go ------------------------------------------------------------------- */

installKitCss();
mountGallery();
mountMarkdown();
mountHighlight();
mountRoles();
