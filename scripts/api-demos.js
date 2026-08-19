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

import { addMessageAction, addProfileButton, addToolbarButton } from '../src/runtime/slack-api.js';
import { modal, toast, confirm as slackConfirm } from '../src/runtime/ui/widgets.js';
import { openMenu } from '../src/runtime/ui/menu.js';
import { h } from '../src/runtime/dom.js';
import { SLACK_FIXTURE } from '../tests/slack-fixture.mjs';
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

  const stage = el('div', 'pg__stage slack-stage');
  stage.dataset.theme = document.querySelector('.stage-theme')?.value ?? 'midnight';
  const code = el('pre', 'pg__code');
  const controls = el('div', 'pg__controls');

  const draw = () => {
    try {
      const made = spec.render(state, { stage });
      if (made !== undefined) stage.replaceChildren(...[].concat(made).filter(Boolean));
      code.innerHTML = highlight(spec.code(state), 'javascript');
    } catch (err) {
      stage.textContent = `this demo threw: ${err.message}`;
    }
  };

  if (spec.controls?.length) {
    controls.replaceChildren(...spec.controls.map((c) => control(c, state, draw)));
  }

  /*
   * Preview and Code, one at a time.
   *
   * Both are always in the document -- switching tabs must not rebuild a demo
   * you have just set up -- so the hidden one is hidden, not removed.
   */
  const preview = el('div', 'pg__panel', spec.controls?.length ? [stage, controls] : [stage]);
  const source = el('div', 'pg__panel', [code, copyButton(() => code.textContent)]);
  source.hidden = true;

  const tabs = el('div', 'pg__tabs');
  const tab = (label, panel, on) => {
    const button = el('button', 'pg__tab');
    button.type = 'button';
    button.textContent = label;
    button.setAttribute('aria-selected', String(on));
    button.addEventListener('click', () => {
      for (const other of tabs.querySelectorAll('.pg__tab')) other.setAttribute('aria-selected', 'false');
      button.setAttribute('aria-selected', 'true');
      preview.hidden = panel !== preview;
      source.hidden = panel !== source;
    });
    return button;
  };
  tabs.append(tab('Preview', preview, true), tab('Code', source, false));

  slot.replaceChildren(el('div', 'pg', [tabs, preview, source]));
  draw();
}

/** The copy button every code block on this page gets. */
function copyButton(text) {
  const button = el('button', 'pg__copy');
  button.type = 'button';
  button.textContent = 'Copy';
  button.addEventListener('click', async () => {
    const ok = await kit.copyText(text());
    button.textContent = ok ? 'Copied' : 'Press ⌘C';
    setTimeout(() => { button.textContent = 'Copy'; }, 1600);
  });
  return button;
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


/* -- the Slack-styled widgets, now that the stage wears Slack ------------- */

const ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10 6.5v4M10 13.2v.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

const UI = {
  'ui-toast': {
    controls: [
      { key: 'message', type: 'text', value: 'Theme saved' },
      { key: 'variant', type: 'select', options: ['info', 'success', 'warning', 'error'], value: 'success' },
      { key: 'action', label: 'action label', type: 'text', value: 'Undo' },
    ],
    render: (v) => {
      const button = kit.button('Show the toast', { variant: 'primary' });
      button.addEventListener('click', () => toast(v.message, {
        variant: v.variant,
        action: v.action ? { label: v.action, onClick: () => {} } : undefined,
      }));
      return button;
    },
    code: (v) => `api.ui.toast('${v.message}', {\n  variant: '${v.variant}',\n  action: { label: '${v.action}', onClick: () => undo() },\n});`,
  },
  'ui-modal': {
    controls: [
      { key: 'title', type: 'text', value: 'Channel notes' },
      { key: 'body', type: 'text', value: 'Kept on this machine only. Nothing is sent anywhere.' },
      { key: 'action', type: 'text', value: 'Save' },
      { key: 'width', type: 'number', value: 460 },
    ],
    render: (v) => {
      const button = kit.button('Open the dialog', { variant: 'primary' });
      button.addEventListener('click', () => {
        modal({
          title: v.title,
          content: h('p', { class: 'betterslack-hint' }, [v.body]),
          width: v.width,
          actions: [{ label: v.action, primary: true, onClick: () => true }],
        });
      });
      return button;
    },
    code: (v) => `api.ui.modal({\n  title: '${v.title}',\n  content: api.dom.h('p', {}, ['${v.body}']),\n  width: ${v.width},\n  actions: [{ label: '${v.action}', primary: true, onClick: () => true }],\n});`,
  },
  'ui-confirm': {
    controls: [
      { key: 'title', type: 'text', value: 'Remove Midnight?' },
      { key: 'body', type: 'text', value: 'Its files go with it.' },
      { key: 'danger', type: 'boolean', value: true },
    ],
    render: (v) => {
      const button = kit.button('Ask', { variant: v.danger ? 'danger' : 'primary' });
      const said = kit.el('span', { class: 'sm-hint', style: 'margin-left:10px' }, ['']);
      button.addEventListener('click', async () => {
        said.textContent = (await slackConfirm({ title: v.title, body: v.body, danger: v.danger }))
          ? 'resolved true' : 'resolved false';
      });
      return [button, said];
    },
    code: (v) => `const sure = await api.ui.confirm({\n  title: '${v.title}',\n  body: '${v.body}',\n  danger: ${v.danger},\n});`,
  },
  'ui-menu': {
    controls: [{ key: 'items', type: 'text', value: 'Rename, Duplicate, Remove' }],
    render: (v) => {
      const anchor = kit.button('Open the menu');
      anchor.addEventListener('click', () => openMenu(anchor, v.items.split(',').map((label, i) => ({
        label: label.trim(),
        danger: i === v.items.split(',').length - 1,
        onSelect: () => {},
      }))));
      return anchor;
    },
    code: (v) => `api.ui.menu(anchor, [\n${v.items.split(',').map((l, i, a) => `  { label: '${l.trim()}'${i === a.length - 1 ? ', danger: true' : ''}, onSelect: () => {} },`).join('\n')}\n]);`,
  },
};

/* -- Slack's chrome, mounted for real ------------------------------------ */

/**
 * The fixture the tests use, so the real `addToolbarButton` has the container
 * it looks for. Nothing here is a drawing of Slack: these are the shipped
 * functions, finding `.p-control_strip` and `[data-qa="message_container"]`
 * exactly as they do in the client.
 */
function slackChrome() {
  const frame = el('div', 'chrome');
  frame.innerHTML = SLACK_FIXTURE;
  /*
   * Nobody's face, and nothing fetched.
   *
   * The fixture carries avatar URLs because `userIdFromAvatarUrl` reads an id
   * out of one, and its ids are invented -- but a page that asks Slack's CDN
   * for them would still be a page making requests on a reader's behalf for
   * pictures that are not ours. Drawn instead, in the ink of whatever theme
   * the stage is wearing.
   */
  for (const img of frame.querySelectorAll('img')) {
    const avatar = document.createElement('span');
    avatar.className = img.className;
    avatar.setAttribute('style', 'display:inline-block;width:36px;height:36px;border-radius:8px;'
      + 'background:var(--dt_color-content-hgl-1, #7cc4ff);opacity:.5');
    img.replaceWith(avatar);
  }
  return frame;
}

/**
 * Mount all of it, show one part of it.
 *
 * The functions being demonstrated go looking for their own container, so the
 * whole fragment has to be in the document -- but a reader wants the strip the
 * button landed in, not a diagram of a client. Everything else is hidden, and
 * the chain from the target up to the root is put back.
 */
function focusChrome(frame, selector) {
  const target = frame.querySelector(selector);
  if (!target) return;
  for (const node of frame.querySelectorAll('*')) node.classList.add('is-out');
  for (let node = target; node && node !== frame; node = node.parentElement) node.classList.remove('is-out');
  for (const node of target.querySelectorAll('*')) node.classList.remove('is-out');
}

/** Where each toolbar puts a button, in the fragment above. */
const TOOLBAR_CONTAINER = {
  controlStrip: '.p-control_strip',
  composer: '[data-qa="message_input"]',
  channelHeader: '.p-view_header__actions',
};

const CHROME = {
  'slack-addtoolbarbutton': {
    controls: [
      { key: 'toolbar', type: 'select', options: ['controlStrip', 'composer', 'channelHeader'], value: 'controlStrip' },
      { key: 'label', type: 'text', value: 'Channel notes' },
    ],
    render: (v, { stage }) => {
      const frame = slackChrome();
      stage.replaceChildren(frame);
      addToolbarButton('demo', v.toolbar, { id: 'demo', label: v.label, icon: ICON, onClick: () => {} });
      focusChrome(frame, TOOLBAR_CONTAINER[v.toolbar]);
      return undefined;
    },
    code: (v) => `api.slack.addToolbarButton('${v.toolbar}', {\n  id: 'notes',\n  label: '${v.label}',\n  icon: '<svg viewBox="0 0 20 20">…</svg>',\n  onClick: () => open(),\n});`,
  },
  'slack-addmessageaction': {
    controls: [{ key: 'label', type: 'text', value: 'Copy link' }],
    render: (v, { stage }) => {
      const frame = slackChrome();
      stage.replaceChildren(frame);
      addMessageAction('demo', { id: 'demo', label: v.label, icon: ICON, onClick: () => {} });
      focusChrome(frame, '[data-qa="message_container"]');
      return undefined;
    },
    code: (v) => `api.slack.addMessageAction({\n  id: 'copy-link',\n  label: '${v.label}',\n  icon: '<svg viewBox="0 0 20 20">…</svg>',\n  onClick: (message) => copy(message.permalink),\n});`,
  },
  'slack-addprofilebutton': {
    controls: [{ key: 'label', type: 'text', value: 'Download picture' }],
    render: (v, { stage }) => {
      const frame = slackChrome();
      stage.replaceChildren(frame);
      addProfileButton('demo', { id: 'demo', label: v.label, icon: ICON, onClick: () => {} });
      focusChrome(frame, '[data-qa="member_profile_pane"]');
      return undefined;
    },
    code: (v) => `api.slack.addProfileButton({\n  id: 'download',\n  label: '${v.label}',\n  icon: '<svg viewBox="0 0 20 20">…</svg>',\n  onClick: ({ userId }) => save(userId),\n});`,
  },
  'slack-avatarurl': {
    controls: [
      { key: 'url', type: 'text', value: 'https://ca.slack-edge.com/T0EXAMPLE1-U0EXAMPLE1-06c4356b6ae3-48' },
      { key: 'size', type: 'select', options: ['24', '48', '72', '192', '512'], value: '192' },
    ],
    render: (v) => {
      const at = /-\d+$/.test(v.url) ? v.url.replace(/-\d+$/, `-${v.size}`) : null;
      return kit.el('code', { class: 'sm-hint', style: 'word-break:break-all' }, [at ?? 'null — not one of Slack\u2019s avatar URLs']);
    },
    code: (v) => `api.slack.avatarUrl(\n  '${v.url}',\n  ${v.size},\n);`,
  },
  'dom-h': {
    controls: [
      { key: 'tag', type: 'select', options: ['div', 'button', 'span'], value: 'button' },
      { key: 'className', label: 'class', type: 'text', value: 'c-button c-button--primary' },
      { key: 'text', type: 'text', value: 'Made with api.dom.h' },
    ],
    render: (v) => h(v.tag, { class: v.className }, [v.text]),
    code: (v) => `api.dom.h('${v.tag}', { class: '${v.className}' }, ['${v.text}']);`,
  },
};

/* -- helpers that need Slack's classes ----------------------------------- */

const SLACK_HELPERS = {
  'helpers-iconbutton': {
    controls: [
      { key: 'label', type: 'text', value: 'Notes' },
      { key: 'surface', type: 'select', options: ['strip', 'header', 'composer'], value: 'header' },
    ],
    render: (v) => helpers.iconButton({ icon: ICON, label: v.label, surface: v.surface, onClick: () => {} }),
    code: (v) => `api.helpers.iconButton({\n  icon: '<svg viewBox="0 0 20 20">…</svg>',\n  label: '${v.label}',\n  surface: '${v.surface}',\n  onClick: () => open(),\n});`,
  },
  'helpers-field': {
    controls: [
      { key: 'label', type: 'text', value: 'Time zone' },
      { key: 'value', type: 'text', value: 'Europe/Paris' },
    ],
    render: (v) => helpers.field(v.label, v.value),
    code: (v) => `api.helpers.field('${v.label}', '${v.value}');`,
  },
  'helpers-section': {
    controls: [
      { key: 'title', type: 'text', value: 'More details' },
      { key: 'rows', type: 'text', value: 'User ID: U04KY0Z61, Time zone: Europe/Paris' },
    ],
    render: (v) => helpers.section(v.title, v.rows.split(',').map((row) => {
      const [label, value] = row.split(':');
      return helpers.field((label ?? '').trim(), (value ?? '').trim());
    })),
    code: (v) => `api.helpers.section('${v.title}', [\n  api.helpers.field('User ID', user.id),\n  api.helpers.field('Time zone', user.tz_label),\n]);`,
  },
  'helpers-badge': {
    controls: [{ key: 'value', type: 'number', value: 3 }],
    render: (v, { stage }) => {
      const host = el('div', 'pg__badge-host');
      host.append(helpers.iconButton({ icon: ICON, label: 'Activity', surface: 'header', onClick: () => {} }));
      stage.replaceChildren(host);
      helpers.badge('.pg__badge-host button', 'demo-badge', () => v.value || null);
      return undefined;
    },
    code: (v) => `let unread = ${v.value};\napi.helpers.badge('[data-qa="betterslack_button"]', 'unread', () => unread);`,
  },
  'helpers-tooltip': {
    controls: [
      { key: 'title', type: 'text', value: 'Channel notes' },
      { key: 'subtitle', type: 'text', value: '⌘⇧N' },
    ],
    render: (v) => {
      const button = helpers.iconButton({ icon: ICON, label: v.title, surface: 'header', onClick: () => {} });
      helpers.tooltip(button, v.title, v.subtitle);
      return [button, kit.el('span', { class: 'sm-hint', style: 'margin-left:10px' }, ['hover it'])];
    },
    code: (v) => `api.helpers.tooltip(button, '${v.title}', '${v.subtitle}');`,
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

/*
 * One theme for every stage, whichever picker you touch.
 *
 * The tokens come from `mods/themes/<id>/theme.css`, scoped to `.slack-stage`
 * at build time, so switching here is the switch a user makes in the panel --
 * and a component that looks wrong in one theme looks wrong here too.
 */
function wireThemePickers() {
  const pickers = [...document.querySelectorAll('.stage-theme')];
  if (!pickers.length) return;
  const apply = (value) => {
    for (const stage of document.querySelectorAll('.slack-stage')) stage.dataset.theme = value;
    for (const other of pickers) other.value = value;
  };
  for (const picker of pickers) picker.addEventListener('change', () => apply(picker.value));
  apply(pickers[0].value);
}

/*
 * One panel at a time, and the list on the left never moves.
 *
 * A reference is read by jumping around it, and a jump that costs a page load
 * loses the theme you picked, the arguments you set and your place in the
 * list. So every entry is a section in this document and exactly one is shown;
 * the URL still names it, so a link to an entry is still a link.
 */
function router() {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  const stack = document.querySelector('.stack');
  const links = [...document.querySelectorAll('.side__list a')];
  if (!stack || !links.length) return;

  const show = (slug) => {
    const wanted = document.getElementById(`p-${slug}`) ?? stack.querySelector('.panel');
    for (const panel of stack.querySelectorAll('.panel')) panel.hidden = panel !== wanted;
    for (const link of links) {
      const current = link.getAttribute('href') === `#${wanted.id.slice(2)}`;
      link.toggleAttribute('aria-current', current);
      if (current) link.scrollIntoView({ block: 'nearest' });
    }
    /*
     * Twice, and the second one matters: a demo that mounts after this -- the
     * chrome fragment, the code editor -- can scroll its own ancestor into
     * view as it lays out, and the reader lands halfway down a panel they
     * have just opened.
     */
    stack.scrollTop = 0;
    requestAnimationFrame(() => {
      stack.scrollTop = 0;
      document.documentElement.scrollTop = 0;
    });
  };

  const fromHash = () => show(location.hash.slice(1) || stack.dataset.first);
  window.addEventListener('hashchange', fromHash);
  fromHash();
}

/** Narrow the list without leaving the page. */
function filter() {
  const box = document.getElementById('side-filter');
  if (!box) return;
  box.addEventListener('input', () => {
    const needle = box.value.trim().toLowerCase();
    for (const group of document.querySelectorAll('.side__group')) {
      let shown = 0;
      for (const item of group.querySelectorAll('li')) {
        const hit = !needle || (item.textContent ?? '').toLowerCase().includes(needle);
        item.hidden = !hit;
        if (hit) shown += 1;
      }
      group.hidden = shown === 0;
    }
  });
}
toasted = (message) => {
  const note = $('helpers-toast');
  if (note) note.textContent = `api.ui.toast(${JSON.stringify(message)})`;
};
for (const [name, spec] of Object.entries(KIT)) playground(`kit-${name.toLowerCase()}`, spec);
for (const [name, spec] of Object.entries(HELPERS)) playground(`helpers-${name.toLowerCase()}`, spec);
for (const group of [UI, CHROME, SLACK_HELPERS]) {
  for (const [slug, spec] of Object.entries(group)) playground(slug, spec);
}
mountI18n();
mountMarkdown();
mountHighlight();
mountRoles();
wireThemePickers();
router();
filter();

// The examples the generator wrote, given the same affordance as the live ones.
for (const block of document.querySelectorAll('.api-code')) {
  block.append(copyButton(() => block.querySelector('code')?.textContent ?? ''));
}
