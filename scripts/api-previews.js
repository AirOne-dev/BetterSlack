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

import {
  addMessageAction, addProfileButton, addToolbarButton, createSlackApi, describeMessage,
} from '../src/runtime/slack-api.js';
import { keepMounted, onEach, onShortcut, waitFor } from '../src/runtime/dom.js';
import { PANEL_CSS } from '../src/runtime/ui/styles.js';
import { openPalette } from '../src/runtime/ui/palette.js';
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
  /*
   * BetterSlack's own panel stylesheet, so the palette and anything else that
   * wears `betterslack-` classes looks exactly as it does in the client. This
   * one is ours, unlike the Slack classes next door, so it is the real file
   * rather than an understudy.
   */
  const panel = document.createElement('style');
  panel.id = 'betterslack-panel-css';
  panel.textContent = PANEL_CSS;
  document.head.append(style, panel, helperCss);
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
  // `||`, not `??`: a control with no label carries an empty string, not null.
  label.textContent = spec.label || spec.key;
  return el('div', 'pg__control', [label, input]);
}

function playground(name, render) {
  const slot = document.querySelector(`[data-demo="${name}"]`);
  if (!slot) return;

  /*
   * The knobs are declared in `docs/api/<slug>.md` and arrive as JSON on the
   * slot. A preview is code and has to be; everything a writer writes about it
   * is not, and lives in the markdown.
   */
  let controls = [];
  try { controls = JSON.parse(slot.dataset.controls || '[]'); } catch { controls = []; }

  const state = {};
  for (const c of controls) state[c.key] = c.value;

  const stage = el('div', 'pg__stage slack-stage');
  stage.dataset.theme = document.getElementById('stage-theme')?.value ?? 'midnight';

  const draw = () => {
    try {
      const made = render(state, { stage });
      if (made !== undefined) stage.replaceChildren(...[].concat(made).filter(Boolean));
    } catch (err) {
      stage.textContent = `this demo threw: ${err.message}`;
    }
  };

  const parts = [el('div', 'pg', [stage])];
  if (controls.length) {
    parts.push(el('div', 'pg-knobs', [
      el('p', 'pg-knobs__title', [document.documentElement.lang === 'fr' ? 'Paramètres' : 'Props']),
      el('div', 'pg__controls', controls.map((c) => control(c, state, draw))),
    ]));
  }
  slot.replaceChildren(...parts);
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
    render: (v) => kit.el(v.tag, { class: v.className }, [v.text]),
  },
  button: {
    render: (v) => kit.button(v.label, { variant: v.variant, wide: v.wide, title: v.title }),
  },
  iconButton: {
    render: (v) => kit.iconButton(v.glyph, { title: v.title, danger: v.danger }),
  },
  input: {
    render: (v) => kit.input({ value: v.value, placeholder: v.placeholder }),
  },
  field: {
    render: (v) => kit.field(v.label, kit.input({ value: 'Midnight' }), v.hint),
  },
  select: {
    render: (v) => kit.select(
      v.options.split(',').map((o) => ({ value: o.trim(), label: o.trim() })),
      { value: v.value.trim() },
    ),
  },
  segmented: {
    render: (v) => kit.segmented(
      v.labels.split(',').map((label, i) => ({
        value: label.trim().toLowerCase(),
        label: label.trim(),
        count: i === 0 && v.count ? v.count : undefined,
      })),
      { value: v.labels.split(',')[0].trim().toLowerCase() },
    ).node,
  },
  card: {
    render: (v) => kit.card(v.title, [kit.el('p', { class: 'sm-hint' }, [v.subtitle])], {
      actions: v.action ? [kit.button(v.action, { variant: 'ghost' })] : [],
    }),
  },
  emptyState: {
    render: (v) => kit.emptyState(v.title, v.body, v.action ? kit.button(v.action, { variant: 'primary' }) : undefined),
  },
  swatch: {
    render: (v) => kit.swatch(v.colour, { size: v.size }),
  },
  popover: {
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
  },
  confirm: {
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
  },
  copyText: {
    render: (v) => {
      const button = kit.button(`Copy ${v.text}`);
      const said = kit.el('span', { class: 'sm-hint', style: 'margin-left:10px' }, ['']);
      button.addEventListener('click', async () => {
        said.textContent = (await kit.copyText(v.text)) ? 'resolved true' : 'resolved false';
      });
      return [button, said];
    },
  },
  code: {
    render: (v) => kit.code({ value: v.value }).node,
  },
};

/* -- helpers, which are the real ones ------------------------------------- */

const HELPERS = {
  toggle: {
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
  },
  describeHotkey: {
    render: (v) => kit.el('strong', { style: 'font-size:20px' }, [helpers.describeHotkey(v.combo)]),
  },
  debounce: {
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
  },
};


/* -- the Slack-styled widgets, now that the stage wears Slack ------------- */

const ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10 6.5v4M10 13.2v.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

const UI = {
  'ui-toast': {
    render: (v) => {
      const button = kit.button('Show the toast', { variant: 'primary' });
      button.addEventListener('click', () => toast(v.message, {
        variant: v.variant,
        action: v.action ? { label: v.action, onClick: () => {} } : undefined,
      }));
      return button;
    },
  },
  'ui-modal': {
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
  },
  'ui-confirm': {
    render: (v) => {
      const button = kit.button('Ask', { variant: v.danger ? 'danger' : 'primary' });
      const said = kit.el('span', { class: 'sm-hint', style: 'margin-left:10px' }, ['']);
      button.addEventListener('click', async () => {
        said.textContent = (await slackConfirm({ title: v.title, body: v.body, danger: v.danger }))
          ? 'resolved true' : 'resolved false';
      });
      return [button, said];
    },
  },
  'ui-menu': {
    render: (v) => {
      const anchor = kit.button('Open the menu');
      anchor.addEventListener('click', () => openMenu(anchor, v.items.split(',').map((label, i) => ({
        label: label.trim(),
        danger: i === v.items.split(',').length - 1,
        onSelect: () => {},
      }))));
      return anchor;
    },
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
    render: (v, { stage }) => {
      const frame = slackChrome();
      stage.replaceChildren(frame);
      addToolbarButton('demo', v.toolbar, { id: 'demo', label: v.label, icon: ICON, onClick: () => {} });
      focusChrome(frame, TOOLBAR_CONTAINER[v.toolbar]);
      return undefined;
    },
  },
  'slack-addmessageaction': {
    render: (v, { stage }) => {
      const frame = slackChrome();
      stage.replaceChildren(frame);
      addMessageAction('demo', { id: 'demo', label: v.label, icon: ICON, onClick: () => {} });
      focusChrome(frame, '[data-qa="message_container"]');
      return undefined;
    },
  },
  'slack-addprofilebutton': {
    render: (v, { stage }) => {
      const frame = slackChrome();
      stage.replaceChildren(frame);
      addProfileButton('demo', { id: 'demo', label: v.label, icon: ICON, onClick: () => {} });
      focusChrome(frame, '[data-qa="member_profile_pane"]');
      return undefined;
    },
  },
  'slack-avatarurl': {
    render: (v) => {
      const at = /-\d+$/.test(v.url) ? v.url.replace(/-\d+$/, `-${v.size}`) : null;
      return kit.el('code', { class: 'sm-hint', style: 'word-break:break-all' }, [at ?? 'null — not one of Slack\u2019s avatar URLs']);
    },
  },
};

/* -- helpers that need Slack's classes ----------------------------------- */

const SLACK_HELPERS = {
  'helpers-iconbutton': {
    render: (v) => helpers.iconButton({ icon: ICON, label: v.label, surface: v.surface, onClick: () => {} }),
  },
  'helpers-field': {
    render: (v) => helpers.field(v.label, v.value),
  },
  'helpers-section': {
    render: (v) => helpers.section(v.title, v.rows.split(',').map((row) => {
      const [label, value] = row.split(':');
      return helpers.field((label ?? '').trim(), (value ?? '').trim());
    })),
  },
  'helpers-badge': {
    render: (v, { stage }) => {
      const host = el('div', 'pg__badge-host');
      host.append(helpers.iconButton({ icon: ICON, label: 'Activity', surface: 'header', onClick: () => {} }));
      stage.replaceChildren(host);
      helpers.badge('.pg__badge-host button', 'demo-badge', () => v.value || null);
      return undefined;
    },
  },
  'helpers-tooltip': {
    render: (v) => {
      const button = helpers.iconButton({ icon: ICON, label: v.title, surface: 'header', onClick: () => {} });
      helpers.tooltip(button, v.title, v.subtitle);
      return [button, kit.el('span', { class: 'sm-hint', style: 'margin-left:10px' }, ['hover it'])];
    },
  },
};


/* -- more of the surface, running ---------------------------------------- */

/** A console pane, for the calls whose whole output is a line of text. */
function say(stage, lines) {
  return kit.el('pre', { class: 'pg__out' }, [lines.join('\n')]);
}

const MORE = {
  'slack-selectors': {
    render: () => {
      const slack = createSlackApi('demo');
      return kit.el('table', { class: 'pg__table' }, Object.entries(slack.selectors).map(
        ([name, value]) => kit.el('tr', {}, [
          kit.el('td', {}, [name]),
          kit.el('td', {}, [kit.el('code', {}, [value])]),
        ]),
      ));
    },
  },
  'slack-describemessage': {
    render: (v, { stage }) => {
      const frame = slackChrome();
      stage.replaceChildren(frame);
      focusChrome(frame, '[data-qa="message_container"]');
      const message = describeMessage(frame.querySelector('[data-qa="message_container"]'));
      frame.append(say(stage, [
        `channelId: ${message.channelId}`,
        `ts:        ${message.ts}`,
        `text:      ${message.text}`,
        `permalink: ${message.permalink}`,
      ]));
      return undefined;
    },
  },
  'slack-composer': {
    render: (v, { stage }) => {
      const frame = slackChrome();
      stage.replaceChildren(frame);
      focusChrome(frame, '[data-qa="message_input"]');
      const slack = createSlackApi('demo');
      const button = kit.button('insert()', { variant: 'primary' });
      button.addEventListener('click', () => {
        slack.composer.insert(v.text);
        slack.composer.focus();
      });
      frame.append(button);
      return undefined;
    },
  },
  'helpers-each': {
    render: (v, { stage }) => {
      const frame = slackChrome();
      stage.replaceChildren(frame);
      focusChrome(frame, '[data-qa="message_container"]');
      const seen = kit.el('span', { class: 'sm-hint' }, ['']);
      helpers.each('[data-qa="message_container"]', (message) => {
        message.style.outline = '2px solid var(--dt_color-content-hgl-1, #7cc4ff)';
        seen.textContent = 'the handler ran on every match, and will run on new ones';
      });
      frame.append(seen);
      return undefined;
    },
  },
  'helpers-mount': {
    render: (v, { stage }) => {
      const frame = slackChrome();
      stage.replaceChildren(frame);
      focusChrome(frame, '.p-control_strip');
      helpers.mount('.p-control_strip', 'demo-mounted', () => {
        const node = kit.button('mounted');
        return node;
      });
      return undefined;
    },
  },
  'helpers-hotkey': {
    render: (v, { stage }) => {
      const out = kit.el('p', { class: 'sm-hint' }, [`press ${helpers.describeHotkey(v.combo)} with this page focused`]);
      let count = 0;
      helpers.hotkey(v.combo, () => {
        count += 1;
        out.textContent = `${helpers.describeHotkey(v.combo)} fired ${count}×`;
      });
      return out;
    },
  },
  'helpers-poll': {
    render: (v) => {
      const out = kit.el('p', { class: 'sm-hint' }, ['…']);
      let ticks = 0;
      helpers.poll(() => {
        ticks += 1;
        out.textContent = `${ticks} tick${ticks === 1 ? '' : 's'} — and it stops while this tab is hidden`;
      }, Math.max(250, v.ms));
      return out;
    },
  },
  'helpers-copy': {
    render: (v) => {
      const button = kit.button('copy()', { variant: 'primary' });
      const out = kit.el('span', { class: 'sm-hint', style: 'margin-left:10px' }, ['']);
      toasted = (message) => { out.textContent = `api.ui.toast(${JSON.stringify(message)})`; };
      button.addEventListener('click', () => helpers.copy(v.text, 'Link copied'));
      return [button, out];
    },
  },
  'kit-hoverable': {
    render: () => {
      const out = kit.el('span', { class: 'sm-hint', style: 'margin-left:10px' }, ['not hovered']);
      const row = kit.button('hover me');
      kit.hoverable(row, {
        enter: () => { out.textContent = 'enter'; },
        leave: () => { out.textContent = 'leave'; },
      });
      return [row, out];
    },
  },
  'dom-h': {
    render: (v) => h(v.tag, { class: v.className }, [v.text]),
  },
  'dom-waitfor': {
    render: (v, { stage }) => {
      const out = kit.el('p', { class: 'sm-hint' }, ['looking for .late-arrival…']);
      const late = document.createElement('div');
      late.className = 'late-arrival';
      waitFor('.late-arrival', 4000).then((found) => {
        out.textContent = found ? 'found it — resolved with the element' : 'timed out — resolved null, it does not throw';
      });
      setTimeout(() => stage.append(late), 900);
      return out;
    },
  },
  'dom-keepmounted': {
    render: (v, { stage }) => {
      const frame = slackChrome();
      stage.replaceChildren(frame);
      focusChrome(frame, '.p-control_strip');
      const out = kit.el('p', { class: 'sm-hint' }, ['']);
      keepMounted('.p-control_strip', 'demo-keep', () => kit.button('kept'));
      const remove = kit.button('remove it', { variant: 'danger' });
      remove.addEventListener('click', () => {
        frame.querySelector('#demo-keep')?.remove();
        out.textContent = 'taken out — and put straight back';
      });
      frame.append(remove, out);
      return undefined;
    },
  },
  'dom-oneach': {
    render: (v, { stage }) => {
      const list = kit.el('div', { class: 'pg__rows' }, []);
      const out = kit.el('p', { class: 'sm-hint' }, ['0 rows seen']);
      let seen = 0;
      onEach('.pg__rows > .row', (row) => {
        seen += 1;
        row.style.color = 'var(--dt_color-content-hgl-1, #7cc4ff)';
        out.textContent = `${seen} rows seen — including the ones added later`;
      });
      const add = kit.button('add a row', { variant: 'primary' });
      add.addEventListener('click', () => list.append(kit.el('div', { class: 'row' }, ['a new row'])));
      list.append(kit.el('div', { class: 'row' }, ['a row that was already here']));
      return [list, add, out];
    },
  },
  'dom-onshortcut': {
    render: () => {
      const out = kit.el('p', { class: 'sm-hint' }, ['press F1 with this page focused']);
      onShortcut((event) => event.key === 'F1', () => { out.textContent = 'F1 — the match ran'; });
      return out;
    },
  },
  'settings-set': {
    render: (v, { stage }) => {
      const out = kit.el('pre', { class: 'pg__out' }, [JSON.stringify(Object.fromEntries(store), null, 2)]);
      const button = kit.button('set()', { variant: 'primary' });
      button.addEventListener('click', async () => {
        store.set(v.key, v.value);
        out.textContent = JSON.stringify(Object.fromEntries(store), null, 2);
      });
      return [button, out];
    },
  },
  'settings-get': {
    render: (v) => kit.el('pre', { class: 'pg__out' }, [
      String(store.has(v.key) ? store.get(v.key) : v.fallback),
    ]),
  },
  'plugin-css': {
    render: (v, { stage }) => {
      const style = document.createElement('style');
      style.textContent = v.css;
      return [style, kit.el('p', { class: 'pg__paint' }, ['this line is painted by the CSS beside it'])];
    },
  },
  'log-info': {
    render: (v) => say(null, [
      `[betterslack:my-plugin] ${v.message}`,
      '',
      'and the same line in the loader’s terminal, which is where',
      'a mod that failed at boot says so.',
    ]),
  },
  'i18n-locale': {
    render: () => say(null, [`locale:   ${createI18n().locale}`, `language: ${createI18n().language}`]),
  },
  'ui-palette': {
    render: () => {
      const button = kit.button('Open the palette', { variant: 'primary' });
      button.addEventListener('click', () => openPalette(
        (query) => [
          { id: 'a', title: 'Go to #releases', subtitle: 'channel', source: 'Slack', run: () => {} },
          { id: 'b', title: 'Open BetterSlack', subtitle: '⌘⇧M', source: 'BetterSlack', run: () => {} },
          { id: 'c', title: 'Change the shortcuts', source: 'Command Palette', run: () => {} },
        ].filter((row) => row.title.toLowerCase().includes(query.toLowerCase())),
        { placeholder: 'Jump to…', empty: 'Nothing matches' },
      ));
      return button;
    },
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
/*
 * One picker, in the bar, for the whole page.
 *
 * It used to sit above each preview, which meant choosing a theme and then
 * losing it at the next entry. Remembered too, so it survives a reload.
 */
function wireThemePicker() {
  const picker = document.getElementById('stage-theme');
  if (!picker) return;
  const saved = localStorage.getItem('betterslack-api-theme');
  if (saved && [...picker.options].some((o) => o.value === saved)) picker.value = saved;
  const apply = () => {
    for (const stage of document.querySelectorAll('.slack-stage')) stage.dataset.theme = picker.value;
    localStorage.setItem('betterslack-api-theme', picker.value);
  };
  picker.addEventListener('change', apply);
  apply();
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
/** Every preview, by the slug the markdown names in its `preview:` line. */
const PREVIEWS = {};
for (const [name, spec] of Object.entries(KIT)) PREVIEWS[`kit-${name.toLowerCase()}`] = spec.render;
for (const [name, spec] of Object.entries(HELPERS)) PREVIEWS[`helpers-${name.toLowerCase()}`] = spec.render;
for (const group of [UI, CHROME, SLACK_HELPERS, MORE]) {
  for (const [slug, spec] of Object.entries(group)) PREVIEWS[slug] = spec.render;
}
for (const slot of document.querySelectorAll('[data-demo]')) {
  const render = PREVIEWS[slot.dataset.demo];
  if (render) playground(slot.dataset.demo, render);
  else slot.remove();
}
mountI18n();
mountMarkdown();
mountHighlight();
mountRoles();
wireThemePicker();
router();
filter();

/*
 * The written examples, coloured by the same tokeniser the live ones use, and
 * given the same copy button. They were plain grey text until now, which made
 * the page look like it had two kinds of code in it.
 */
for (const block of document.querySelectorAll('.api-code')) {
  const code = block.querySelector('code');
  if (code) code.innerHTML = highlight(code.textContent ?? '', 'javascript');
  block.append(copyButton(() => code?.textContent ?? ''));
}
