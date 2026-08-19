/**
 * The live half of the API page.
 *
 * Everything here imports the real implementation rather than a copy of it:
 * the kit a mod gets from `api.ui.kit`, the helpers it reaches for first, the
 * markdown renderer the panel uses for a readme, Code Highlight's own
 * tokeniser and language detector, the theme builder's role derivation, and
 * the translator behind `api.i18n`. If one of them changes the page changes
 * with it, and if one stops compiling the site build fails.
 *
 * What is *not* here is anything that needs Slack: a toolbar button, a message
 * action, the web API. Those are shown as code, and the page says so. Building
 * a lookalike for a web page would be the second version of something this
 * project deliberately keeps single.
 *
 * Bundled into site/api-demos.js by scripts/build-api-page.mjs.
 */

import { createKit } from '../src/runtime/ui/kit.js';
import { KIT_CSS } from '../src/runtime/ui/kit-css.js';
import { createHelpers } from '../src/runtime/helpers.js';
import { createI18n } from '../src/runtime/i18n.js';
import { renderMarkdown } from '../src/runtime/ui/markdown.js';
import { highlight, LANGUAGES } from '../mods/plugins/code-highlight/tokenise.js';
import { detect } from '../mods/plugins/code-highlight/detect.js';
import { ROLES } from '../mods/plugins/theme-builder/roles.js';
import {
  contrast, derivePalette, formatCss, parseColour, readability,
} from '../mods/plugins/theme-builder/colour.js';

const kit = createKit(document);
const $ = (id) => document.getElementById(id);

/**
 * A real `api.helpers`, against a stub of the little the helpers ask for.
 *
 * The context is five things -- an id, a way to write CSS, a toast, a settings
 * store and a cleanup tracker -- so the page can supply all of them and get
 * the shipped implementation rather than an impression of it. Settings live in
 * memory here; in Slack they are a file the loader owns.
 */
const store = new Map();
const helperCss = document.createElement('style');
let toasted = () => {};
const helpers = createHelpers({
  pluginId: 'api-page',
  css: (text) => { helperCss.textContent = text; },
  toast: (message) => toasted(message),
  settings: {
    get: (key, fallback) => (store.has(key) ? store.get(key) : fallback),
    set: async (key, value) => { store.set(key, value); },
  },
  track: (cleanup) => cleanup,
});

function installStyles() {
  if (document.getElementById('sm-kit-css')) return;
  const style = document.createElement('style');
  style.id = 'sm-kit-css';
  style.textContent = KIT_CSS;
  document.head.append(style, helperCss);
}

/* -- the playground ------------------------------------------------------- *
 *
 * One shape for every demo: a stage, a row of controls that change the
 * arguments, and the call that produced what you are looking at. The code is
 * coloured by Code Highlight, which is itself one of the things documented
 * here.
 */

const el = (tag, className, children = []) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.append(...children);
  return node;
};

function control(spec, state, draw) {
  const id = `pg-${spec.key}-${Math.random().toString(36).slice(2, 7)}`;
  let input;
  if (spec.type === 'select') {
    input = kit.select(spec.options.map((o) => ({ value: o, label: o })), {
      value: state[spec.key],
      onChange: (value) => { state[spec.key] = value; draw(); },
    });
  } else if (spec.type === 'boolean') {
    input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'pg__check';
    input.checked = Boolean(state[spec.key]);
    input.addEventListener('change', () => { state[spec.key] = input.checked; draw(); });
  } else {
    input = kit.input({ value: state[spec.key], type: spec.type === 'number' ? 'number' : 'text' });
    input.addEventListener('input', () => {
      state[spec.key] = spec.type === 'number' ? Number(input.value) : input.value;
      draw();
    });
  }
  input.id = id;
  const label = el('label', 'pg__label');
  label.htmlFor = id;
  label.textContent = spec.label ?? spec.key;
  return el('div', 'pg__control', [label, input]);
}

function playground(name, spec) {
  const slot = document.querySelector(`[data-demo="${name}"]`);
  if (!slot) return;

  const state = {};
  for (const c of spec.controls ?? []) state[c.key] = c.value;

  const stage = el('div', 'pg__stage');
  const code = el('pre', 'pg__code');
  const draw = () => {
    try {
      const made = spec.render(state, { stage });
      if (made !== undefined) stage.replaceChildren(...[].concat(made).filter(Boolean));
      code.innerHTML = highlight(spec.code(state), 'javascript');
    } catch (err) {
      stage.textContent = `this demo threw: ${err.message}`;
    }
  };

  const parts = [stage];
  if (spec.controls?.length) {
    parts.push(el('div', 'pg__controls', spec.controls.map((c) => control(c, state, draw))));
  }
  parts.push(code);
  slot.replaceChildren(el('div', 'pg', parts));
  draw();
}

/* -- the component kit ---------------------------------------------------- */

const KIT = {
  el: {
    controls: [
      { key: 'tag', type: 'select', options: ['div', 'p', 'strong', 'span'], value: 'p' },
      { key: 'text', type: 'text', value: 'Built with the same maker as everything below.' },
      { key: 'className', label: 'class', type: 'text', value: 'sm-hint' },
    ],
    render: (v) => kit.el(v.tag, { class: v.className }, [v.text]),
    code: (v) => `kit.el('${v.tag}', { class: '${v.className}' }, ['${v.text}'])`,
  },
  button: {
    controls: [
      { key: 'label', type: 'text', value: 'Save' },
      { key: 'variant', type: 'select', options: ['default', 'primary', 'ghost', 'danger'], value: 'primary' },
      { key: 'wide', type: 'boolean', value: false },
      { key: 'title', label: 'tooltip', type: 'text', value: 'Write the theme to disk' },
    ],
    render: (v) => kit.button(v.label, { variant: v.variant, wide: v.wide, title: v.title }),
    code: (v) => `kit.button('${v.label}', {\n  variant: '${v.variant}',\n  wide: ${v.wide},\n  title: '${v.title}',\n})`,
  },
  iconButton: {
    controls: [
      { key: 'glyph', type: 'text', value: '✎' },
      { key: 'title', type: 'text', value: 'Rename' },
      { key: 'danger', type: 'boolean', value: false },
    ],
    render: (v) => kit.iconButton(v.glyph, { title: v.title, danger: v.danger }),
    code: (v) => `kit.iconButton('${v.glyph}', { title: '${v.title}', danger: ${v.danger} })`,
  },
  input: {
    controls: [
      { key: 'value', type: 'text', value: 'Midnight' },
      { key: 'placeholder', type: 'text', value: 'Theme name' },
    ],
    render: (v) => kit.input({ value: v.value, placeholder: v.placeholder }),
    code: (v) => `kit.input({ value: '${v.value}', placeholder: '${v.placeholder}' })`,
  },
  field: {
    controls: [
      { key: 'label', type: 'text', value: 'Theme name' },
      { key: 'hint', type: 'text', value: 'Shown in the panel and in the palette.' },
    ],
    render: (v) => kit.field(v.label, kit.input({ value: 'Midnight' }), v.hint),
    code: (v) => `kit.field('${v.label}', kit.input({ value: 'Midnight' }),\n  '${v.hint}')`,
  },
  select: {
    controls: [
      { key: 'options', type: 'text', value: 'dark, light, follow the system' },
      { key: 'value', type: 'text', value: 'dark' },
    ],
    render: (v) => kit.select(
      v.options.split(',').map((o) => ({ value: o.trim(), label: o.trim() })),
      { value: v.value.trim() },
    ),
    code: (v) => `kit.select([\n${v.options.split(',').map((o) => `  { value: '${o.trim()}', label: '${o.trim()}' },`).join('\n')}\n], { value: '${v.value.trim()}' })`,
  },
  segmented: {
    controls: [
      { key: 'labels', type: 'text', value: 'Colours, CSS, Inspect' },
      { key: 'count', label: 'badge on the first', type: 'number', value: 12 },
    ],
    render: (v) => kit.segmented(
      v.labels.split(',').map((label, i) => ({
        value: label.trim().toLowerCase(),
        label: label.trim(),
        count: i === 0 && v.count ? v.count : undefined,
      })),
      { value: v.labels.split(',')[0].trim().toLowerCase() },
    ).node,
    code: (v) => `kit.segmented([\n${v.labels.split(',').map((l, i) => `  { value: '${l.trim().toLowerCase()}', label: '${l.trim()}'${i === 0 && v.count ? `, count: ${v.count}` : ''} },`).join('\n')}\n], { value: '${v.labels.split(',')[0].trim().toLowerCase()}' }).node`,
  },
  card: {
    controls: [
      { key: 'title', type: 'text', value: 'Palette' },
      { key: 'subtitle', type: 'text', value: 'Two colours, ten derived' },
      { key: 'action', label: 'action button', type: 'text', value: 'Reset' },
    ],
    render: (v) => kit.card(v.title, [kit.el('p', { class: 'sm-hint' }, [v.subtitle])], {
      actions: v.action ? [kit.button(v.action, { variant: 'ghost' })] : [],
    }),
    code: (v) => `kit.card('${v.title}', [\n  kit.el('p', { class: 'sm-hint' }, ['${v.subtitle}']),\n], { actions: [kit.button('${v.action}', { variant: 'ghost' })] })`,
  },
  emptyState: {
    controls: [
      { key: 'title', type: 'text', value: 'No themes yet' },
      { key: 'body', type: 'text', value: 'Build one and it appears here.' },
      { key: 'action', label: 'button', type: 'text', value: 'New theme' },
    ],
    render: (v) => kit.emptyState(v.title, v.body, v.action ? kit.button(v.action, { variant: 'primary' }) : undefined),
    code: (v) => `kit.emptyState('${v.title}', '${v.body}',\n  kit.button('${v.action}', { variant: 'primary' }))`,
  },
  swatch: {
    controls: [
      { key: 'colour', type: 'text', value: 'rgba(97, 31, 105, 0.55)' },
      { key: 'size', type: 'select', options: ['sm', 'md', 'lg'], value: 'lg' },
    ],
    render: (v) => kit.swatch(v.colour, { size: v.size }),
    code: (v) => `// a translucent colour reads as translucent: the checkerboard is kit.CHECKER\nkit.swatch('${v.colour}', { size: '${v.size}' })`,
  },
  popover: {
    controls: [{ key: 'label', type: 'text', value: 'Open a popover' }],
    render: (v) => {
      const anchor = kit.button(v.label);
      anchor.addEventListener('click', () => {
        const content = kit.el('div', { style: 'padding:12px;min-width:210px' }, [
          kit.el('p', { class: 'sm-hint', style: 'margin:0 0 10px' }, ['Anchored, and dismissed by a click outside.']),
        ]);
        kit.popover(content, anchor);
      });
      return anchor;
    },
    code: (v) => `const anchor = kit.button('${v.label}');\nanchor.addEventListener('click', () => {\n  kit.popover(content, anchor);\n});`,
  },
  confirm: {
    controls: [
      { key: 'title', type: 'text', value: 'Delete Midnight?' },
      { key: 'body', type: 'text', value: 'The stylesheet goes with it. This cannot be undone.' },
      { key: 'action', type: 'text', value: 'Delete' },
      { key: 'danger', type: 'boolean', value: true },
    ],
    render: (v) => {
      const trigger = kit.button(v.action, { variant: v.danger ? 'danger' : 'primary' });
      const said = kit.el('span', { class: 'sm-hint', style: 'margin-left:10px' }, ['']);
      trigger.addEventListener('click', async () => {
        const yes = await kit.confirm({
          title: v.title, body: v.body, action: v.action, cancel: 'Keep it', danger: v.danger,
        });
        said.textContent = yes ? `it resolved true` : 'it resolved false';
      });
      return [trigger, said];
    },
    code: (v) => `const yes = await kit.confirm({\n  title: '${v.title}',\n  body: '${v.body}',\n  action: '${v.action}',\n  cancel: 'Keep it',\n  danger: ${v.danger},\n});`,
  },
  copyText: {
    controls: [{ key: 'text', type: 'text', value: '#611f69' }],
    render: (v) => {
      const button = kit.button(`Copy ${v.text}`);
      const said = kit.el('span', { class: 'sm-hint', style: 'margin-left:10px' }, ['']);
      button.addEventListener('click', async () => {
        said.textContent = (await kit.copyText(v.text)) ? 'resolved true' : 'resolved false';
      });
      return [button, said];
    },
    code: (v) => `const ok = await kit.copyText('${v.text}');`,
  },
  code: {
    controls: [
      { key: 'value', type: 'text', value: ':root { --dt_color-base-pry: #0b0d12; }' },
    ],
    render: (v) => kit.code({ value: v.value }).node,
    code: (v) => `const editor = kit.code({ value: '${v.value}' });\ndocument.body.append(editor.node);\neditor.value(); // what is in it now`,
  },
};

/* -- helpers, which are the real ones ------------------------------------- */

const HELPERS = {
  toggle: {
    controls: [
      { key: 'className', label: 'class on <html>', type: 'text', value: 'demo-zen' },
      { key: 'defaultOn', type: 'boolean', value: false },
    ],
    render: (v) => {
      for (const name of [...document.documentElement.classList]) {
        if (name.startsWith('demo-') || name.startsWith('betterslack-api-page')) {
          document.documentElement.classList.remove(name);
        }
      }
      const flag = helpers.toggle({
        key: `demo-${v.className}`,
        className: v.className,
        defaultOn: v.defaultOn,
        whenOn: '& .pg__watch { outline: 2px solid #36c5f0; }',
      });
      const watch = el('div', 'pg__watch');
      const state = kit.el('span', { class: 'sm-hint', style: 'margin-left:10px' }, []);
      const paint = () => {
        state.textContent = flag.on
          ? `on — <html class="${v.className}">`
          : 'off — the class is gone, and so is the CSS';
      };
      watch.append(kit.button('Toggle', { variant: 'primary' }), state);
      watch.querySelector('button').addEventListener('click', async () => {
        await flag.toggle();
        paint();
      });
      paint();
      return watch;
    },
    code: (v) => `const zen = api.helpers.toggle({\n  key: 'on',\n  className: '${v.className}',\n  defaultOn: ${v.defaultOn},\n  whenOn: '& .p-channel_sidebar { display: none !important; }',\n});\nawait zen.toggle();`,
  },
  describeHotkey: {
    controls: [{ key: 'combo', type: 'text', value: 'mod+shift+f' }],
    render: (v) => kit.el('strong', { style: 'font-size:20px' }, [helpers.describeHotkey(v.combo)]),
    code: (v) => `api.helpers.describeHotkey('${v.combo}')\n// ⌘⇧F on a Mac, Ctrl+Shift+F elsewhere`,
  },
  debounce: {
    controls: [{ key: 'ms', label: 'milliseconds', type: 'number', value: 400 }],
    render: (v, { stage }) => {
      const out = kit.el('p', { class: 'sm-hint' }, ['type below']);
      let typed = 0;
      let ran = 0;
      const run = helpers.debounce(() => {
        ran += 1;
        out.textContent = `${typed} keystrokes, ${ran} call${ran === 1 ? '' : 's'} through`;
      }, v.ms);
      const box = kit.input({ placeholder: 'type quickly, then stop' });
      box.addEventListener('input', () => { typed += 1; run(); });
      return [box, out];
    },
    code: (v) => `const search = api.helpers.debounce((q) => run(q), ${v.ms});\nbox.addEventListener('input', () => search(box.value));`,
  },
};

/* -- i18n ----------------------------------------------------------------- */

function mountI18n() {
  const locale = $('i18n-locale');
  const key = $('i18n-key');
  const name = $('i18n-name');
  const out = $('i18n-out');
  if (!locale || !out) return;

  const TABLES = {
    en: { hello: 'Hi {name}, {count} unread', bye: 'See you' },
    fr: { hello: 'Salut {name}, {count} non lus' },
  };
  const draw = () => {
    // The real translator: English is required and is the fallback for an
    // unknown language *and* for a missing key.
    const t = createI18n(locale.value).strings(TABLES);
    out.textContent = t(key.value, { name: name.value, count: 3 });
  };
  for (const node of [locale, key, name]) node.addEventListener('input', draw);
  locale.addEventListener('change', draw);
  draw();
}

/* -- markdown ------------------------------------------------------------- */

function mountMarkdown() {
  const source = $('md-source');
  const out = $('md-out');
  if (!source || !out) return;
  const draw = () => { out.innerHTML = renderMarkdown(source.value); };
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
    out.innerHTML = chosen
      ? highlight(source.value, chosen)
      : source.value.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'));
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
    const palette = derivePalette(parseColour(base.value), parseColour(accent.value));
    grid.replaceChildren(...ROLES.map((role) => kit.el('div', { class: 'role' }, [
      kit.swatch(formatCss(palette[role.key]), { size: 'md' }),
      kit.el('div', { class: 'role__text' }, [
        kit.el('strong', {}, [role.key + (role.seed ? ' (seed)' : '')]),
        kit.el('span', { class: 'sm-hint' }, [formatCss(palette[role.key])]),
      ]),
    ])));
    if (out) {
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

installStyles();
toasted = (message) => {
  const note = $('helpers-toast');
  if (note) note.textContent = `api.ui.toast(${JSON.stringify(message)})`;
};
for (const [name, spec] of Object.entries(KIT)) playground(name, spec);
for (const [name, spec] of Object.entries(HELPERS)) playground(name, spec);
mountI18n();
mountMarkdown();
mountHighlight();
mountRoles();
