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
import { PANEL_CSS, LAUNCHER_CSS } from '../src/runtime/ui/styles.js';
import { openPalette } from '../src/runtime/ui/palette.js';
import { modal, toast, confirm as slackConfirm } from '../src/runtime/ui/widgets.js';
import { openMenu } from '../src/runtime/ui/menu.js';
import { attachTooltip } from '../src/runtime/ui/tooltip.js';
import { userIdFromAvatarUrl } from '../src/runtime/web-api.js';
import { h } from '../src/runtime/dom.js';
import { SLACK_FIXTURE } from '../tests/slack-fixture.mjs';
import { SLACK_PREFS } from '../src/shared/protocol.js';
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
  /*
   * Every cleanup a helper hands back, collected for whoever is drawing.
   *
   * `helpers.mount`, `each`, `badge`, `hotkey` and `poll` all keep observing
   * after the call returns -- that is what they are for -- and in the client
   * the plugin host holds their cleanups. Here the drawing panel does: without
   * it, `keepMounted` from one entry went on putting its button into the next
   * entry's fake client, and `helpers.mount`'s demo showed a `kept` button
   * nobody on that page had asked for.
   */
  track: (cleanup) => { TRACKED.push(cleanup); return cleanup; },
});

/** Filled by `track` above, drained by `playground`'s draw. */
const TRACKED = [];

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
  /*
   * And the launcher's, which is not optional decoration: it is the only place
   * a toolbar button's icon is given a size. Without it every `addToolbarButton`
   * preview drew its SVG at whatever intrinsic size it had -- a pale rectangle
   * the height of the strip. The same omission once shipped in the client, and
   * is why `--healthcheck` reports `launcher`.
   */
  const launcher = document.createElement('style');
  launcher.id = 'betterslack-launcher-css';
  launcher.textContent = LAUNCHER_CSS;
  document.head.append(style, panel, launcher, helperCss);
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
  } else if (spec.type === 'textarea') {
    /*
     * For the defaults that are genuinely several lines. A `text` control is an
     * `<input>`, which collapses a newline to nothing on screen: the
     * renderMarkdown knob showed its whole sample as one unreadable line, and
     * editing it was impossible.
     */
    input = kit.el('textarea', { class: 'api-input', rows: '8', spellcheck: 'false' }, [state[spec.key] ?? '']);
    input.addEventListener('input', () => { state[spec.key] = input.value; draw(); });
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

/*
 * The demo of whichever entry is on screen, and only that one.
 *
 * Every preview used to be built at load. That is wrong here in a way it would
 * not be for drawings: `addToolbarButton` and `addMessageAction` are the
 * shipped functions, and the shipped functions mount by observing the whole
 * document -- so with four fake clients in the page at once, each one collected
 * every other entry's button. The `addProfileButton` preview showed a message
 * action it had never asked for.
 *
 * So a panel's demo is drawn when it is opened and torn down when it is left,
 * through the cleanup those same functions return. Control values live in the
 * closure and survive the round trip.
 */
const MOUNTED = new Map();

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

  let cleanups = [];
  const teardown = () => {
    for (const stop of cleanups.splice(0)) { try { stop(); } catch { /* already gone */ } }
    stage.replaceChildren();
  };
  const keep = (stop) => { if (typeof stop === 'function') cleanups.push(stop); };
  const draw = () => {
    teardown();
    TRACKED.length = 0;
    try {
      const made = render(state, { stage, keep });
      if (made !== undefined) stage.replaceChildren(...[].concat(made).filter(Boolean));
    } catch (err) {
      stage.textContent = `this demo threw: ${err.message}`;
    }
    // Whatever the helpers registered while that ran belongs to this panel.
    for (const stop of TRACKED.splice(0)) keep(stop);
  };

  const parts = [el('div', 'pg', [stage])];
  if (controls.length) {
    parts.push(el('div', 'pg-knobs', [
      el('p', 'pg-knobs__title', [document.documentElement.lang === 'fr' ? 'Paramètres' : 'Props']),
      el('div', 'pg__controls', controls.map((c) => control(c, state, draw))),
    ]));
  }
  slot.replaceChildren(...parts);
  const entry = {
    drawn: true,
    draw: () => { draw(); entry.drawn = true; },
    teardown: () => { teardown(); entry.drawn = false; },
  };
  MOUNTED.set(slot.closest('.panel')?.id ?? name, entry);
  return entry;
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

/*
 * Characters rather than an icon set, and one SVG.
 *
 * Each of these is a plain Unicode symbol that renders without a webfont, which
 * is what a window a mod opens has. The last entry is markup instead, since
 * `kit.iconButton` sets innerHTML and the commonest question about it is
 * whether that means you can pass your own drawing. You can.
 */
const GLYPHS = ['\u270e', '\ud83d\uddd1', '\u22ef', '\u2699', '\u2713', '\u2715', '\uff0b',
  '\u21bb', '\u2605', '\u2913', '\u21e7', '\u29c9', 'svg'];

const GLYPH_SVG = '<svg viewBox="0 0 20 20" aria-hidden="true">'
  + '<path d="M4 13.5V16h2.5l7.4-7.4-2.5-2.5L4 13.5Zm11.8-6.9a.7.7 0 0 0 0-1L14.4 4.2a.7.7 0 0 0-1 0l-1.2 1.2 2.5 2.5 1.1-1.3Z"'
  + ' fill="currentColor"/></svg>';

const KIT = {
  el: {
    render: (v) => kit.el(v.tag, { class: v.className }, [v.text]),
  },
  button: {
    render: (v) => kit.button(v.label, { variant: v.variant, wide: v.wide, title: v.title }),
  },
  iconButton: {
    /*
     * The glyph list, and what it honestly is.
     *
     * `kit.iconButton` sets the button's innerHTML to whatever it is handed, so
     * a glyph is any markup at all -- a character, an emoji, an inline SVG.
     * There is no list of "Slack's icons" to offer here and it would be wrong
     * to invent one: Slack's own icons are classes in Slack's stylesheet, and
     * the kit exists for a window a mod opens, where that stylesheet does not
     * reach. So this is a set of characters that need no font beyond the
     * system's, plus one entry that is a real SVG, because that is the answer
     * to the question the select provokes.
     */
    render: (v) => {
      const chosen = v.glyph === 'svg' ? GLYPH_SVG : v.glyph;
      const shown = kit.iconButton(chosen, { title: v.title, danger: v.danger, onClick: () => {} });
      return [
        shown,
        kit.el('span', { class: 'sm-hint' }, [
          v.glyph === 'svg' ? 'any markup, not just a character' : `kit.iconButton(${JSON.stringify(v.glyph)})`,
        ]),
        kit.el('div', { class: 'pg__glyphs' }, GLYPHS.map((glyph) => kit.iconButton(
          glyph === 'svg' ? GLYPH_SVG : glyph,
          { title: glyph, onClick: () => {} },
        ))),
      ];
    },
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
    // Full width and pre-filled: an editor is judged on how text sits in it, and
    // an empty box half the stage wide shows neither the wrapping nor the
    // colouring that is the whole point of the component.
    render: (v) => kit.code({ value: v.value, rows: Math.max(4, Number(v.rows) || 12) }).node,
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
function slackChrome({ pane = false } = {}) {
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
    img.classList.add('chrome__avatar');
    img.dataset.seed = (img.src.match(/-(U[A-Z0-9]+)-/) ?? [, 'U0'])[1];
    img.alt = '';
    /*
     * Transparent, and still the URL it was.
     *
     * `onProfilePane` and `userIdFromMessage` read the user id out of the
     * avatar's `src` -- that is the behaviour being demonstrated, so it has to
     * be the real `src` that is read. Drawing over the `<img>` with a `<span>`
     * broke it (userId came back null); leaving the URL alone would have this
     * page fetch faces from Slack's CDN on a reader's behalf.
     *
     * So the element keeps its `src` in the fragment of a 1x1 transparent SVG:
     * the browser requests nothing, `img.src` still ends in
     * `/T…-U…-…`, and the gradient behind it comes from the theme.
     */
    img.src = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E#`
      + new URL(img.src).pathname;
  }
  return dressChrome(frame, pane);
}

/*
 * The fixture, arranged as a client.
 *
 * `SLACK_FIXTURE` is the tests' fixture and stays that: the containers the
 * shipped functions go looking for, in a flat list, with nothing in them. That
 * is all jsdom needs and all a unit test should assert against -- but it draws
 * as five dashed boxes, which is what the toolbar previews were showing.
 *
 * So the page moves those same containers into the layout Slack uses and fills
 * the empty ones. The nodes are the fixture's own, in the fixture's own
 * classes: the functions being demonstrated still find `.p-control_strip` and
 * `[data-qa="message_container"]` because those are still what they are. Only
 * their arrangement is ours, and only here -- nothing below runs in the client.
 */
function dressChrome(frame, pane_ = false) {
  const client = frame.querySelector('.p-client_container');
  const pick = (selector) => frame.querySelector(selector);

  const rail = pick('.p-tab_rail');
  const sidebar = pick('.p-channel_sidebar');
  const primary = pick('.p-view_contents--primary');
  const header = pick('.p-view_header__actions');
  const strip = pick('.p-control_strip');
  const pane = pick('[data-qa="member_profile_pane"]');

  /* The rail: Slack's tabs, then the control strip pinned to the bottom of it. */
  const railColumn = el('div', 'chrome__rail');
  railColumn.append(rail, el('div', 'chrome__spacer'), strip);

  /* The sidebar's list, which the fixture leaves empty on purpose. */
  const list = pick('.p-channel_sidebar__list');
  for (const [name, state] of [['general', ''], ['releases', 'is-selected'], ['design', 'is-unread'], ['random', '']]) {
    const row = el('div', `p-channel_sidebar__channel ${state}`);
    row.innerHTML = `<span class="chrome__hash">#</span><span class="chrome__name">${name}</span>`;
    list.append(row);
  }

  /* The conversation: a header with the actions the fixture already carries. */
  const bar = el('div', 'p-view_header');
  const title = el('div', 'chrome__title');
  title.innerHTML = '<span class="chrome__hash">#</span>releases<span class="chrome__topic">Ships on Thursdays</span>';
  bar.append(title, header);

  const message = pick('[data-qa="message_container"]');
  const text = message.querySelector('[data-qa="message-text"]');
  text.replaceWith(Object.assign(document.createElement('div'), {
    className: 'chrome__lines',
    innerHTML: '<div class="chrome__who">Robin Vasquez <span class="chrome__when">11:04</span></div>'
      + '<div data-qa="message-text">Cutting 1.4 this afternoon — anything still open?</div>',
  }));
  message.append(el('div', 'chrome__filler'));

  const composer = pick('[data-qa="message_input"]');
  const editor = composer.querySelector('.ql-editor');
  if (editor) editor.innerHTML = '<p class="chrome__placeholder">Message #releases</p>';

  /* The profile pane, which is a right-hand column in the client. */
  const container = pane.querySelector('.p-r_member_profile__container');
  container.append(Object.assign(document.createElement('div'), {
    className: 'chrome__profile',
    innerHTML: '<div class="chrome__who">Robin Vasquez</div><div class="chrome__role">Release engineering</div>',
  }));

  /*
   * The profile pane is a fourth column and takes a quarter of the width, so it
   * is only shown by the entries that are about it. It stays in the document
   * either way: `addProfileButton` mounts by finding it.
   */
  if (!pane_) pane.classList.add('chrome__offstage');
  client.replaceChildren(railColumn, sidebar, el('div', 'chrome__main'), pane);
  frame.querySelector('.chrome__main').append(bar, primary);
  primary.querySelector('.p-message_pane').append(composer);
  return frame;
}

/**
 * Mount all of it, point at one part of it.
 *
 * The functions being demonstrated go looking for their own container, so the
 * whole client has to be in the document. It used to be hidden down to the one
 * container that mattered, which answered "where did my button go" with a
 * dashed rectangle and no client around it. Dimmed instead, with a ring on the
 * part in question: the answer to that question is *where*, and where needs the
 * rest of the window to be visible.
 *
 * The dimming is applied here rather than by a `:has()` selector for two
 * reasons. Opacity compounds -- a child of a 0.42 parent cannot be put back to
 * 1 -- so exactly one level may carry it, which a stylesheet cannot know; and
 * `:has()` has already silently matched nothing once on this page.
 */
function focusChrome(frame, selector) {
  const target = frame.querySelector(selector);
  if (!target) return;
  const dim = (node) => {
    for (const child of node.children) {
      if (child === target || child.contains(target)) dim(child);
      else child.classList.add('chrome__dim');
    }
  };
  dim(frame.querySelector('.p-client_container') ?? frame);
  target.classList.add('chrome__focus');
}

/** Where each toolbar puts a button, in the fragment above. */
const TOOLBAR_CONTAINER = {
  controlStrip: '.p-control_strip',
  composer: '[data-qa="message_input"]',
  channelHeader: '.p-view_header__actions',
};

const CHROME = {
  'slack-addtoolbarbutton': {
    render: (v, { stage, keep }) => {
      const frame = slackChrome();
      stage.replaceChildren(frame);
      keep(addToolbarButton('demo', v.toolbar, { id: 'demo', label: v.label, icon: ICON, onClick: () => {} }));
      focusChrome(frame, TOOLBAR_CONTAINER[v.toolbar]);
      return undefined;
    },
  },
  'slack-addmessageaction': {
    render: (v, { stage, keep }) => {
      const frame = slackChrome();
      stage.replaceChildren(frame);
      keep(addMessageAction('demo', { id: 'demo', label: v.label, icon: ICON, onClick: () => {} }));
      focusChrome(frame, '[data-qa="message_container"]');
      return undefined;
    },
  },
  'slack-addprofilebutton': {
    render: (v, { stage, keep }) => {
      const frame = slackChrome({ pane: true });
      stage.replaceChildren(frame);
      keep(addProfileButton('demo', { id: 'demo', label: v.label, icon: ICON, onClick: () => {} }));
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
  'helpers-cache': {
    /*
     * The real helper, against the page's in-memory settings. What it shows is
     * the decision `swr` makes: the stored value is handed back at once, and
     * the callback fires only when the fresh answer is not the stored one.
     */
    render: (v) => {
      const store = helpers.cache('preview-demo', { keys: 4 });
      store.set('list', v.stored);
      const out = kit.el('pre', { class: 'pg__out' }, ['']);
      const held = store.swr('list', async () => v.fresh, (fresh) => {
        out.textContent += `\nonFresh fired: ${JSON.stringify(fresh)}`;
      });
      out.textContent = `store.swr(...) returned ${JSON.stringify(held)}  — synchronously`;
      if (v.stored === v.fresh) {
        out.textContent += '\n\n(the answer matches what was stored, so nothing repaints)';
      }
      return out;
    },
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
      stage.append(say(stage, [
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
      const out = kit.el('span', { class: 'sm-hint' }, ['the fixture composer is a real contenteditable']);
      const say = (what, ok) => { out.textContent = `${what} -> ${ok}`; };

      const text = kit.button('insertText()', { variant: 'primary' });
      text.addEventListener('click', () => say('insertText', slack.composer.insertText(v.text)));
      const link = kit.button('insertLink()');
      link.addEventListener('click', () => say('insertLink', slack.composer.insertLink(v.link, 'the thread')));
      const empty = kit.button('isEmpty()');
      empty.addEventListener('click', () => say('isEmpty', slack.composer.isEmpty()));

      stage.append(text, link, empty, out);
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
      stage.append(seen);
      return undefined;
    },
  },
  'helpers-mount': {
    render: (v, { stage }) => {
      const frame = slackChrome();
      stage.replaceChildren(frame);
      focusChrome(frame, '.p-control_strip');
      /*
       * A Slack-classed button, not `kit.button`.
       *
       * The kit is for a window a mod opens, where there is no stylesheet at
       * all; its colours are its own. Mounted into Slack's rail on a light
       * theme it came out white on cream. Anything going into Slack's chrome
       * borrows Slack's classes, which is the rule in the client too.
       */
      helpers.mount('.p-control_strip', 'demo-mounted', () => helpers.iconButton({
        icon: ICON, label: 'mounted', surface: 'rail', onClick: () => {},
      }));
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
    render: (v, { stage, keep }) => {
      const frame = slackChrome();
      stage.replaceChildren(frame);
      focusChrome(frame, '.p-control_strip');
      const out = kit.el('p', { class: 'sm-hint' }, ['']);
      keep(keepMounted('.p-control_strip', 'demo-keep',
        () => helpers.iconButton({ icon: ICON, label: 'kept', surface: 'rail', onClick: () => {} })));
      const remove = kit.button('remove it', { variant: 'danger' });
      remove.addEventListener('click', () => {
        frame.querySelector('#demo-keep')?.remove();
        out.textContent = 'taken out — and put straight back';
      });
      stage.append(remove, out);
      return undefined;
    },
  },
  'dom-oneach': {
    render: (v, { stage, keep }) => {
      const list = kit.el('div', { class: 'pg__rows' }, []);
      const out = kit.el('p', { class: 'sm-hint' }, ['0 rows seen']);
      let seen = 0;
      keep(onEach('.pg__rows > .row', (row) => {
        seen += 1;
        row.style.color = 'var(--dt_color-content-hgl-1, #7cc4ff)';
        out.textContent = `${seen} rows seen — including the ones added later`;
      }));
      const add = kit.button('add a row', { variant: 'primary' });
      add.addEventListener('click', () => list.append(kit.el('div', { class: 'row' }, ['a new row'])));
      list.append(kit.el('div', { class: 'row' }, ['a row that was already here']));
      return [list, add, out];
    },
  },
  'dom-onshortcut': {
    render: (v, { keep }) => {
      const out = kit.el('p', { class: 'sm-hint' }, ['press F1 with this page focused']);
      keep(onShortcut((event) => event.key === 'F1', () => { out.textContent = 'F1 — the match ran'; }));
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
      const sheet = kit.el('style');
      sheet.textContent = v.css ?? '';
      const target = kit.el('div', { class: 'pg__cssdemo' }, [
        kit.el('div', { class: 'p-channel_sidebar' }, ['#\u00a0general']),
      ]);
      stage.replaceChildren(sheet, target, source(`api.css(\`${v.css ?? ''}\`);`, 'javascript'));
      return undefined;
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


/* -- the last of what can honestly run ------------------------------------ */

const REST = {
  'kit-checker': {
    render: () => [
      kit.el('div', { style: `padding:18px;border-radius:10px;background:${kit.CHECKER}` }, [
        kit.el('div', { style: 'width:120px;height:56px;border-radius:8px;background:rgba(97,31,105,.45)' }),
      ]),
      kit.el('span', { class: 'sm-hint' }, ['the same colour without it would read as a flat grey-purple']),
    ],
  },
  'slack-useridfrommessage': {
    render: (v, { stage }) => {
      const frame = slackChrome();
      stage.replaceChildren(frame);
      focusChrome(frame, '[data-qa="message_container"]');
      // Read off the mounted avatar, which keeps its real path in a fragment
      // precisely so this still works without fetching anybody's face.
      const url = frame.querySelector('.c-message_kit__avatar img')?.src ?? '';
      stage.append(kit.el('pre', { class: 'pg__out' }, [
        `from ${url}`,
        `      -> ${userIdFromAvatarUrl(url)}`,
      ]));
      return undefined;
    },
  },
  'slack-currentchannelid': {
    render: () => {
      const slack = createSlackApi('demo');
      return kit.el('pre', { class: 'pg__out' }, [
        `location.pathname   ${location.pathname}`,
        `currentChannelId()  ${slack.currentChannelId()}`,
        '',
        'null here, because this page is not a conversation. In Slack it is the',
        'channel on screen, read out of the URL rather than from the DOM.',
      ]);
    },
  },
  'ui-tooltip': {
    render: (v) => {
      const button = kit.button('hover me');
      attachTooltip(button, { title: v.title, subtitle: v.subtitle, placement: v.placement });
      return [button, kit.el('span', { class: 'sm-hint' }, [`placement: ${v.placement}`])];
    },
  },
  'ui-kit': {
    render: () => [
      kit.button('Save', { variant: 'primary' }),
      kit.button('Cancel'),
      kit.iconButton('✎', { title: 'Rename' }),
      kit.input({ value: 'Midnight' }),
      kit.swatch('#611f69'),
    ],
  },
  'i18n-language': {
    render: () => kit.el('pre', { class: 'pg__out' }, [
      `locale    ${createI18n().locale}`,
      `language  ${createI18n().language}`,
    ]),
  },
  'settings-all': {
    render: () => kit.el('pre', { class: 'pg__out' }, [
      JSON.stringify(Object.fromEntries(store), null, 2) || '{}',
    ]),
  },
  'settings-onchange': {
    render: (v) => {
      const out = kit.el('pre', { class: 'pg__out' }, ['waiting for a change…']);
      const button = kit.button('set() something', { variant: 'primary' });
      let n = 0;
      button.addEventListener('click', () => {
        n += 1;
        store.set('ticks', n);
        out.textContent = `the handler ran with ${JSON.stringify(Object.fromEntries(store))}`;
      });
      return [button, out];
    },
  },
  'themes-list': {
    render: () => kit.el('div', { class: 'pg__rows' }, (window.CATALOGUE?.themes ?? []).map(
      (theme) => kit.el('div', { class: 'row' }, [`${theme.id} — ${theme.name}`]),
    )),
  },
  'app-mods': {
    render: () => {
      const mods = [...(window.CATALOGUE?.themes ?? []), ...(window.CATALOGUE?.plugins ?? [])];
      return kit.el('pre', { class: 'pg__out' }, [
        `${mods.length} mods in the catalogue`,
        '',
        ...mods.slice(0, 6).map((mod) => `  ${mod.id.padEnd(22)} v${mod.version}`),
        '  …',
      ]);
    },
  },
  'log-warn': {
    render: () => kit.el('pre', { class: 'pg__out' }, [
      '[betterslack:member-sidebar] presence lookup stopped',
      '',
      'The loader forwards warnings that mention betterslack even without',
      'BETTERSLACK_VERBOSE, so this line reaches the terminal too.',
    ]),
  },
  'log-error': {
    render: () => kit.el('pre', { class: 'pg__out' }, [
      '[betterslack:user-inspector] WebApiError: users.info failed: user_not_found',
      '',
      'An uncaught one is always forwarded: a mod that threw at boot says so in',
      'the terminal instead of hiding in a DevTools window nobody opened.',
    ]),
  },
  'commands-add': {
    render: (v) => kit.el('div', { class: 'betterslack-palette__list' }, [
      kit.el('div', { class: 'betterslack-palette__row' }, [
        kit.el('span', { class: 'betterslack-palette__icon betterslack-palette__icon--glyph' }, [v.icon]),
        kit.el('span', { class: 'betterslack-palette__text' }, [
          kit.el('span', { class: 'betterslack-palette__title' }, [v.title]),
          kit.el('span', { class: 'betterslack-palette__sub' }, [v.subtitle]),
        ]),
        kit.el('span', { class: 'betterslack-palette__source' }, ['Channel Notes']),
      ]),
    ]),
  },
};

/* -- the rest, imitated --------------------------------------------------- *
 *
 * The entries here reach something a web page has not got: Slack's API, the
 * loader's filesystem, another mod, a window that can be restarted. Saying so
 * and stopping was the honest answer and a poor one -- a reference is read to
 * find out what a call *looks* like, and "not available here" answers nothing.
 *
 * So each of these draws what the call produces, from the nearest real thing
 * available. Where the data can be real it is real: the mod folder and the
 * theme stylesheet are this repository's own, snapshotted at build time into
 * site/api-fixtures.js. Where it cannot be -- a workspace, a download folder --
 * it is invented, and the preview says which by wearing the note below rather
 * than by leaving the reader to guess.
 */

const FIXTURES = (typeof window !== 'undefined' && window.__API_FIXTURES) || {
  theme: { id: 'midnight', css: '' },
  plugin: { id: 'channel-notes', files: [], manifest: {}, entry: '' },
};

/** The line that says an answer is invented rather than fetched. */
function stubbed(text) {
  return kit.el('p', { class: 'pg__stub' }, [text]);
}

/** A block of code, coloured by the tokeniser this page also documents. */
function source(text, language = 'javascript') {
  const code = kit.el('code', { class: 'betterslack-hl' });
  code.innerHTML = highlight(text, language);
  return kit.el('pre', { class: 'api-output pg__source' }, [code]);
}

/** Invented people, the same ones everywhere on this page. */
const PEOPLE = [
  { id: 'U0EXAMPLE1', name: 'Robin Vasquez', title: 'Release engineering', presence: 'active' },
  { id: 'U0EXAMPLE2', name: 'Sam Okonkwo', title: 'Design systems', presence: 'away' },
  { id: 'U0EXAMPLE3', name: 'Nadia Prescott', title: 'Support', presence: 'active' },
];

/** One row of the Mods panel, in the panel's own classes. */
function modRow(mod) {
  const row = kit.el('div', { class: 'betterslack-row' }, [
    kit.el('div', { class: 'betterslack-row__text' }, [
      kit.el('div', { class: 'betterslack-row__name' }, [mod.name]),
      kit.el('div', { class: 'betterslack-row__desc' }, [mod.description]),
    ]),
  ]);
  const toggle = kit.el('input', { type: 'checkbox', class: 'pg__check' });
  toggle.checked = Boolean(mod.enabled);
  if (mod.onToggle) toggle.addEventListener('change', () => mod.onToggle(toggle.checked));
  row.append(mod.installed === false
    ? kit.button('Install', { variant: 'primary' })
    : toggle);
  return row;
}

/*
 * A profile with a status on it, and the workspace emoji that may or may not
 * know the name in it.
 *
 * The custom emoji here is this repository's own picture rather than a Slack
 * URL: the page fetches nothing from Slack, and a broken image would document
 * the opposite of what these two entries are about.
 */
const STATUS_EMOJI = {
  palm_tree: 'mark.svg',
  glitch_crab: 'mark.svg',
  tada: 'mark.svg',
};

function statusFixture(v) {
  const profile = {
    status_text: v.text ?? '',
    status_emoji: v.emoji ? `:${v.emoji}:` : '',
    status_expiration: 0,
  };
  const custom = new Map();
  if (v.known && STATUS_EMOJI[v.emoji]) custom.set(v.emoji, STATUS_EMOJI[v.emoji]);
  return [profile, custom];
}

const IMITATED = {
  /* -- Slack's own surface ------------------------------------------------ */

  'slack-web': {
    render: (v) => {
      const person = PEOPLE.find((p) => p.id === v.user) ?? PEOPLE[0];
      const answer = {
        ok: true,
        users: [{
          id: person.id,
          name: person.name.toLowerCase().replace(' ', '.'),
          profile: { real_name: person.name, title: person.title, image_192: `https://ca.slack-edge.com/T0EXAMPLE1-${person.id}-…-192` },
        }],
      };
      return [
        kit.el('div', { class: 'pg__card' }, [
          kit.el('span', { class: 'chrome__avatar', 'data-seed': person.id }),
          kit.el('div', {}, [
            kit.el('div', { class: 'chrome__who' }, [person.name]),
            kit.el('div', { class: 'chrome__role' }, [person.title]),
          ]),
        ]),
        source(`await api.slack.web.users(['${person.id}'])\n\n${JSON.stringify(answer, null, 2)}`, 'json'),
        stubbed('The call and its shape are real; the workspace behind them is not.'),
      ];
    },
  },

  'slack-desktop': {
    render: (v) => {
      /*
       * The real list, not a plausible one: `api.slack.desktop.keys()` answers
       * from SLACK_PREFS and refuses anything else by name, so a preview that
       * invented a key would be documenting a call that fails.
       */
      const rows = SLACK_PREFS.map((pref) => {
        const wanted = pref.key === v.key ? (pref.type === 'boolean' ? v.value : String(v.value)) : null;
        return kit.el('tr', { class: pref.key === v.key ? 'is-current' : '' }, [
          kit.el('td', {}, [kit.el('code', {}, [pref.key])]),
          kit.el('td', {}, [pref.type]),
          kit.el('td', {}, [wanted === null ? '—' : String(wanted)]),
          kit.el('td', {}, [kit.el('span', { class: 'sm-hint' }, [
            pref.restart ? 'read when the window is created — needs a restart' : 'applies at once',
          ])]),
        ]);
      });
      const pref = SLACK_PREFS.find((p) => p.key === v.key) ?? SLACK_PREFS[0];
      return [
        source(`api.slack.desktop.keys()          // the ${SLACK_PREFS.length} below, and nothing else\n`
          + `api.slack.desktop.get(${JSON.stringify(pref.key)})\n`
          + `await api.slack.desktop.set(${JSON.stringify(pref.key)}, ${JSON.stringify(pref.type === 'boolean' ? v.value : String(v.value))});\n`
          + `api.slack.desktop.needsRestart(${JSON.stringify(pref.key)})  // ${pref.restart}`),
        kit.el('div', { class: 'pg__legend' }, ['key · type · what this preview would set · when it takes effect']),
        kit.el('table', { class: 'pg__table pg__prefs' }, rows),
        stubbed(pref.note),
      ];
    },
  },

  'slack-currentteamid': {
    render: () => {
      const slack = createSlackApi('demo');
      return [
        source(`location.pathname        ${location.pathname}\n`
          + `api.slack.currentTeamId()    ${slack.currentTeamId()}\n`
          + `api.slack.currentChannelId() ${slack.currentChannelId()}\n\n`
          + '// Null on this page: it is not a Slack client, so there is neither a\n'
          + '// /client/<team>/<channel> address nor a drawn avatar to read one from.'),
        stubbed('In Slack these answer about the workspace on screen, which at a cold start is not the one in the URL.'),
      ];
    },
  },

  'slack-openstatuseditor': {
    render: (v, { stage }) => {
      const frame = slackChrome();
      const strip = frame.querySelector('.p-control_strip');
      const menu = kit.el('div', { class: 'c-menu pg__fakemenu' }, [
        kit.el('ul', { class: 'c-menu__items' }, [
          kit.el('li', { class: 'c-menu_item__li' }, [
            kit.el('button', { class: 'c-menu_item__button', 'data-qa': 'main-menu-custom-status-item' }, [
              kit.el('span', { class: 'c-menu_item__label' }, ['Set a status']),
            ]),
          ]),
          kit.el('li', { class: 'c-menu_item__li' }, [
            kit.el('button', { class: 'c-menu_item__button' }, [
              kit.el('span', { class: 'c-menu_item__label' }, ['Pause notifications']),
            ]),
          ]),
        ]),
      ]);
      strip.append(menu);
      stage.replaceChildren(frame, kit.el('pre', { class: 'pg__out' }, [
        'await api.slack.openStatusEditor()',
        '',
        'The account menu is opened first, then the entry below is pressed.',
        'data-qa rather than the words beside it: the label is translated,',
        'the attribute is not.',
      ]));
      focusChrome(frame, '.p-control_strip');
      return undefined;
    },
  },

  'slack-restart': {
    render: () => {
      const button = kit.button('Restart Slack', { variant: 'primary' });
      const out = kit.el('pre', { class: 'pg__out' }, ['']);
      button.addEventListener('click', async () => {
        const ok = await slackConfirm({
          title: 'Restart Slack?',
          body: 'The translucent window is chosen when Slack starts, so this preference needs a restart to take effect.',
          action: 'Restart',
        });
        out.textContent = ok
          ? 'api.slack.restart({ windowVibrancy: true })\n\n'
            + 'The loader stops Slack, writes the preferences, launches it again\n'
            + 'and rebuilds its CDP connection in place. Same terminal, same run.'
          : 'cancelled — nothing written';
      });
      return [button, out, stubbed('The dialog is the shipped one; nothing is restarted from a web page.')];
    },
  },

  'slack-vipusers': {
    render: (v) => {
      const ids = v.pref.split(',').map((id) => id.trim()).filter(Boolean);
      return [
        source(`users.prefs.get(name: 'vip_users')\n  -> ${JSON.stringify(v.pref)}\n\n`
          + `api.slack.vipUsers()\n  -> ${JSON.stringify(ids)}`),
        kit.el('div', { class: 'pg__people' }, ids.map((id) => {
          const person = PEOPLE.find((p) => p.id === id);
          return kit.el('div', { class: 'pg__card' }, [
            kit.el('span', { class: 'chrome__avatar', 'data-seed': id }),
            kit.el('div', {}, [
              kit.el('div', { class: 'chrome__who' }, [person?.name ?? id]),
              kit.el('div', { class: 'chrome__role' }, [person ? 'VIP' : 'not in this workspace']),
            ]),
          ]);
        })),
      ];
    },
  },

  'slack-setvip': {
    render: (v, { stage }) => {
      const vips = new Set(v.vips.split(',').map((id) => id.trim()).filter(Boolean));
      const out = kit.el('pre', { class: 'pg__out' }, ['']);
      const draw = () => {
        out.textContent = `users.prefs.set(name: 'vip_users', value: '${[...vips].join(',')}')`;
      };
      const list = kit.el('div', { class: 'pg__people' }, PEOPLE.map((person) => {
        const star = kit.button(vips.has(person.id) ? '★ VIP' : '☆ Add', { variant: vips.has(person.id) ? 'primary' : 'default' });
        star.addEventListener('click', () => {
          if (vips.has(person.id)) vips.delete(person.id); else vips.add(person.id);
          star.textContent = vips.has(person.id) ? '★ VIP' : '☆ Add';
          star.className = `c-button c-button--medium c-button--${vips.has(person.id) ? 'primary' : 'outline'}`;
          draw();
        });
        return kit.el('div', { class: 'pg__card' }, [
          kit.el('span', { class: 'chrome__avatar', 'data-seed': person.id }),
          kit.el('div', {}, [kit.el('div', { class: 'chrome__who' }, [person.name])]),
          star,
        ]);
      }));
      draw();
      return [list, out, stubbed('Read, edit, write — the whole list every time, which is why two windows can clobber each other.')];
    },
  },

  'slack-starthuddle': {
    render: (v, { stage }) => {
      const frame = slackChrome();
      const header = frame.querySelector('.p-view_header__actions');
      const start = helpers.iconButton({ icon: ICON, label: 'Start a huddle', surface: 'header', onClick: () => {} });
      start.setAttribute('data-qa', 'huddle_channel_header_button__start_button');
      header.prepend(start);
      stage.replaceChildren(frame, kit.el('pre', { class: 'pg__out' }, [
        'api.slack.startHuddle(\'U0EXAMPLE2\')',
        '',
        'It clicks this button. The profile pane’s huddle control is only a menu',
        'trigger; the channel header’s is the one that starts anything, and a plain',
        'element.click() is enough. Slack opens a separate window for the call.',
      ]));
      focusChrome(frame, '[data-qa="huddle_channel_header_button__start_button"]');
      return undefined;
    },
  },

  'slack-hideconversation': {
    render: (v, { stage }) => {
      const frame = slackChrome();
      const rows = [...frame.querySelectorAll('.p-channel_sidebar__channel')];
      const target = rows.find((row) => row.textContent?.includes(v.channel)) ?? rows[3];
      const button = kit.button(`Hide #${v.channel}`, { variant: 'danger' });
      button.addEventListener('click', () => {
        target.classList.toggle('chrome__hidden');
        button.textContent = target.classList.contains('chrome__hidden') ? `Show #${v.channel}` : `Hide #${v.channel}`;
      });
      stage.replaceChildren(frame, button);
      focusChrome(frame, '.p-channel_sidebar');
      return undefined;
    },
  },

  'slack-openconversation': {
    render: (v, { stage }) => {
      const frame = slackChrome();
      const link = kit.el('pre', { class: 'pg__out' }, [`slack://channel?team=T0EXAMPLE1&id=${v.channel}`]);
      const rows = [...frame.querySelectorAll('.p-channel_sidebar__channel')];
      const go = kit.button('Open it', { variant: 'primary' });
      go.addEventListener('click', () => {
        for (const row of rows) row.classList.remove('is-selected');
        (rows.find((row) => row.textContent?.includes(v.name)) ?? rows[0]).classList.add('is-selected');
        frame.querySelector('.chrome__title').firstChild.nextSibling.textContent = v.name;
      });
      stage.replaceChildren(frame, go, link, stubbed(
        'Assigning that URL hands it to the desktop app’s protocol handler, which routes it in place — same document, no reload.'));
      focusChrome(frame, '.p-channel_sidebar');
      return undefined;
    },
  },

  'slack-openmessage': {
    render: (v, { stage }) => {
      const frame = slackChrome();
      const message = frame.querySelector('[data-qa="message_container"]');
      const go = kit.button('Open the message', { variant: 'primary' });
      go.addEventListener('click', () => {
        // Slack's own flash: it fades out on its own, so re-running has to take
        // the class off before putting it back or the second click does nothing.
        message.classList.remove('chrome__flash');
        void message.offsetWidth;
        message.classList.add('chrome__flash');
      });
      stage.replaceChildren(frame, go, kit.el('pre', { class: 'pg__out' }, [
        `slack://channel?team=T0EXAMPLE1&id=${v.channel}&message=${v.ts}`,
      ]), stubbed(
        'In the client, the desktop app routes that URL in place and highlights the message it lands on.'));
      focusChrome(frame, '.p-message_pane');
      return undefined;
    },
  },

  'slack-opendirectmessage': {
    render: (v, { stage }) => {
      const frame = slackChrome();
      const list = frame.querySelector('.p-channel_sidebar__list');
      const row = el('div', 'p-channel_sidebar__channel');
      row.innerHTML = '<span class="chrome__avatar" data-seed="U0EXAMPLE2" style="width:18px;height:18px;border-radius:5px;margin-right:6px"></span>'
        + '<span class="chrome__name">Sam Okonkwo</span>';
      list.append(row);
      const go = kit.button('Open the DM', { variant: 'primary' });
      go.addEventListener('click', () => {
        for (const other of list.children) other.classList.remove('is-selected');
        row.classList.add('is-selected');
      });
      stage.replaceChildren(frame, go, kit.el('pre', { class: 'pg__out' }, [
        `api.slack.openDirectMessage('${v.user}')`,
        '',
        'conversations.open gives the DM channel id, then the deep link opens it.',
      ]));
      focusChrome(frame, '.p-channel_sidebar');
      return undefined;
    },
  },

  'slack-openuserprofile': {
    render: (v, { stage }) => {
      const frame = slackChrome({ pane: true });
      stage.replaceChildren(frame, kit.el('pre', { class: 'pg__out' }, [
        `slack://user?team=T0EXAMPLE1&id=${v.user}`,
        '',
        'Not everyone has one: an app, or a conversation with yourself, gives a',
        'pane that never appears. Try ids in turn rather than trusting the first.',
      ]));
      focusChrome(frame, '[data-qa="member_profile_pane"]');
      return undefined;
    },
  },

  'slack-onprofilepane': {
    render: (v, { stage, keep }) => {
      const frame = slackChrome({ pane: true });
      stage.replaceChildren(frame);
      const slack = createSlackApi('demo');
      keep(slack.onProfilePane(({ element, userId }) => {
        element.querySelector('.p-r_member_profile__container')?.append(
          helpers.section(v.title, [helpers.field('User id', userId ?? 'unknown')]),
        );
      }));
      focusChrome(frame, '[data-qa="member_profile_pane"]');
      return undefined;
    },
  },

  'slack-filesfrom': {
    render: (v) => {
      const person = PEOPLE.find((p) => p.id === v.user) ?? PEOPLE[0];
      const all = [
        { name: 'release-notes-1.4.pdf', size: '284 KB', type: 'pdf', ts: '2 days ago' },
        { name: 'sidebar-before-after.png', size: '1.1 MB', type: 'png', ts: '5 days ago' },
        { name: 'rollout-plan.md', size: '4 KB', type: 'md', ts: 'last week' },
        { name: 'timings.csv', size: '18 KB', type: 'csv', ts: 'last week' },
      ];
      const files = all.slice(0, Math.max(1, Math.min(Number(v.limit) || all.length, all.length)));
      return [
        kit.el('div', { class: 'pg__card' }, [
          kit.el('span', { class: 'chrome__avatar', 'data-seed': person.id }),
          kit.el('div', {}, [
            kit.el('div', { class: 'chrome__who' }, [person.name]),
            kit.el('div', { class: 'chrome__role' }, [`${files.length} of ${all.length} files, newest first`]),
          ]),
        ]),
        kit.el('div', { class: 'pg__files' }, files.map((file) => kit.el('div', { class: 'pg__file' }, [
          kit.el('span', { class: 'pg__file__kind' }, [file.type.toUpperCase()]),
          kit.el('div', {}, [
            kit.el('div', { class: 'chrome__who' }, [file.name]),
            kit.el('div', { class: 'chrome__role' }, [`${file.size} · ${file.ts}`]),
          ]),
        ]))),
        source(`await api.slack.filesFrom('${person.id}'${v.limit ? `, ${v.limit}` : ''})\n\n`
          + JSON.stringify(files.map((f) => ({
            name: f.name,
            url_private: `https://files.slack.com/…/${f.name}`,
          })), null, 2), 'json'),
        stubbed('Without a limit you get Slack’s own default page, which is rarely what a panel wants to draw.'),
      ];
    },
  },

  /* -- somebody's status --------------------------------------------------- */

  /*
   * Both entries draw from the same three sources the runtime does, and the
   * `known` knob is what makes the third one visible: turn it off and the
   * workspace no longer has that emoji, so `describeStatus` reports
   * `imageUrl: null` and `statusNode` draws the sentence alone rather than a
   * shortcode.
   */
  'slack-describestatus': {
    render: (v) => {
      const [profile, custom] = statusFixture(v);
      const status = createSlackApi('demo').describeStatus(profile, custom);
      return [
        source(`const custom = await api.slack.web.emoji();\n`
          + `api.slack.describeStatus(user, custom)\n\n`
          + JSON.stringify(status, null, 2), 'json'),
        stubbed(status?.imageUrl
          ? 'Resolved from the workspace\u2019s own emoji.'
          : 'Nothing knows that name, so there is no image \u2014 the sentence still draws.'),
      ];
    },
  },

  'slack-emojiurl': {
    render: (v) => {
      const custom = new Map();
      if (v.known && STATUS_EMOJI[v.name]) custom.set(v.name, STATUS_EMOJI[v.name]);
      const url = createSlackApi('demo').emojiUrl(v.name, custom);
      const line = kit.el('div', { class: 'pg__card' }, [
        url
          ? kit.el('img', { src: url, alt: `:${v.name}:`, style: 'width:20px;height:20px' })
          : kit.el('span', { class: 'sm-hint' }, ['(nothing draws it)']),
        kit.el('code', {}, [`:${v.name}:`]),
      ]);
      return [
        line,
        source(`api.slack.emojiUrl('${v.name}', custom)\n\n${JSON.stringify(url)}`, 'javascript'),
        stubbed(url
          ? 'Resolved from the workspace\u2019s own emoji.'
          : 'Neither the workspace nor the page knows that name, so there is no image \u2014 and the raw shortcode is never printed in its place.'),
      ];
    },
  },

  'slack-statusnode': {
    render: (v, { stage }) => {
      const [profile, custom] = statusFixture(v);
      const slack = createSlackApi('demo');
      const status = slack.describeStatus(profile, custom);
      if (!status) return kit.el('span', { class: 'sm-hint' }, ['no status set — nothing to draw']);
      const row = kit.el('div', { class: 'pg__card' }, [
        kit.el('span', { class: 'chrome__avatar', 'data-seed': 'U0EXAMPLE1' }),
        kit.el('div', {}, [
          kit.el('div', { class: 'chrome__who' }, ['Robin Vasquez']),
          slack.statusNode(status, profile),
        ]),
      ]);
      return [row, stubbed('The node, its stylesheet and its rules are the shipped ones.')];
    },
  },

  /* -- the loader's side -------------------------------------------------- */

  'files-save': {
    render: (v, { stage }) => {
      const out = kit.el('div', { class: 'pg__downloads' }, []);
      const button = kit.button('Save it', { variant: 'primary' });
      button.addEventListener('click', () => {
        out.replaceChildren(kit.el('div', { class: 'pg__file' }, [
          kit.el('span', { class: 'pg__file__kind' }, ['JPG']),
          kit.el('div', {}, [
            kit.el('div', { class: 'chrome__who' }, [v.filename]),
            kit.el('div', { class: 'chrome__role' }, [`~/Downloads/${v.filename} — 48 320 bytes`]),
          ]),
        ]));
        toast(`Saved ${v.filename}`, { variant: 'success' });
      });
      return [
        source(`const { path, bytes } = await api.files.save(\n  '${v.url}',\n  '${v.filename}',\n);`),
        button,
        out,
        stubbed('The loader fetches it, because Slack’s CDN serves without CORS headers and the renderer cannot.'),
      ];
    },
  },

  'files-screenshot': {
    render: (v, { stage }) => {
      const frame = slackChrome();
      const flash = el('div', 'pg__flash');
      const shot = kit.button('Take the shot', { variant: 'primary' });
      const out = kit.el('pre', { class: 'pg__out' }, ['']);
      shot.addEventListener('click', () => {
        flash.classList.remove('is-firing');
        void flash.offsetWidth;
        flash.classList.add('is-firing');
        out.textContent = `api.files.screenshot({ size: '${v.size}', filename: '${v.filename}' })\n\n`
          + `~/Downloads/${v.filename} — ${v.size}, webp`;
      });
      const wrap = el('div', 'pg__shotframe', [frame, flash]);
      stage.replaceChildren(wrap, shot, out);
      return undefined;
    },
  },

  'assets-list': {
    render: () => [
      kit.el('ul', { class: 'pg__tree' }, FIXTURES.plugin.files.map(
        (name) => kit.el('li', {}, [kit.el('code', {}, [name])]),
      )),
      kit.el('p', { class: 'sm-hint' }, [`mods/plugins/${FIXTURES.plugin.id}/, read by the loader — this repository’s own folder.`]),
    ],
  },

  'assets-text': {
    render: (v) => [
      kit.el('p', { class: 'sm-hint' }, [`api.assets.text(${JSON.stringify(v.file)})`]),
      source(v.file.endsWith('.json') ? JSON.stringify(FIXTURES.plugin.manifest, null, 2) : FIXTURES.plugin.entry,
        v.file.endsWith('.json') ? 'json' : 'javascript'),
    ],
  },

  'themes-source': {
    render: () => [
      kit.el('p', { class: 'sm-hint' }, [`await api.themes.source('${FIXTURES.theme.id}') — the first lines of it`]),
      source(FIXTURES.theme.css, 'css'),
    ],
  },

  'themes-suspend': {
    render: (v, { stage }) => {
      const frame = slackChrome();
      const button = kit.button('Suspend the themes', { variant: 'primary' });
      let off = false;
      button.addEventListener('click', () => {
        off = !off;
        frame.dataset.theme = off ? 'none' : '';
        frame.classList.toggle('chrome--bare', off);
        button.textContent = off ? 'Restore them' : 'Suspend the themes';
      });
      stage.replaceChildren(frame, button, kit.el('p', { class: 'sm-hint' }, [
        'The whole theme layer detaches, and the user’s settings are untouched. The theme builder holds it back like this so the preview shows what it is painting rather than what was already on.',
      ]));
      return undefined;
    },
  },

  'plugin-savetheme': {
    render: (v, { stage }) => {
      const editor = kit.code({ value: v.css });
      const save = kit.button('Save the theme', { variant: 'primary' });
      const out = kit.el('pre', { class: 'pg__out' }, ['']);
      save.addEventListener('click', () => {
        out.textContent = `~/.betterslack/mods/themes/${v.id}/theme.css\n${editor.value.length} bytes — it shows up in the panel as an installed theme`;
        toast(`Saved “${v.id}”`, { variant: 'success' });
      });
      stage.replaceChildren(editor.node, save, out);
      return undefined;
    },
  },

  /* -- BetterSlack itself -------------------------------------------------- */

  'app-commands': {
    render: () => {
      const rows = [
        { id: 'motion:toggle', title: 'Turn Motion off', source: 'Motion', shortcut: '' },
        { id: 'theme-builder:open', title: 'Open the theme builder', source: 'Theme Builder', shortcut: '' },
        { id: 'demo-mode:toggle', title: 'Turn demo mode on', source: 'Demo Mode', shortcut: '' },
      ];
      return kit.el('table', { class: 'pg__table' }, rows.map((row) => kit.el('tr', {}, [
        kit.el('td', {}, [kit.el('code', {}, [row.id])]),
        kit.el('td', {}, [row.title]),
        kit.el('td', {}, [kit.el('span', { class: 'sm-hint' }, [row.source])]),
        kit.el('td', {}, [kit.el('span', { class: 'sm-hint' }, [row.shortcut])]),
      ])));
    },
  },

  'app-openpanel': {
    render: () => {
      const button = kit.button('Open the panel', { variant: 'primary' });
      button.addEventListener('click', () => modal({
        title: 'BetterSlack',
        body: 'The panel is the Mods dialog, on ⌘⇧M. api.app.openPanel() is what a command or a button calls to bring it up.',
        actions: [{ label: 'Close', primary: true }],
      }));
      return button;
    },
  },

  'app-openmod': {
    render: (v) => {
      const button = kit.button(`Open ${v.id}`, { variant: 'primary' });
      button.addEventListener('click', () => modal({
        title: v.id,
        body: 'A mod’s page: its icon, version and author, its description in your language, a screenshot, its README and its settings. Not the row’s settings drawer, which is what this used to open when settings were all there was.',
        actions: [{ label: 'Close', primary: true }],
      }));
      return button;
    },
  },

  'app-setenabled': {
    render: (v, { stage }) => {
      const out = kit.el('pre', { class: 'pg__out' }, ['']);
      const row = modRow({
        name: 'Motion', description: 'Slack with the frames in between.',
        enabled: v.enabled,
        onToggle: (on) => { out.textContent = `api.app.setEnabled('motion', ${on})`; },
      });
      return [row, out, kit.el('p', { class: 'sm-hint' }, [
        'A plugin is code that keeps running after the theme that wanted it is off, so nothing switches one on without asking.',
      ])];
    },
  },

  'app-setinstalled': {
    render: (v, { stage }) => {
      const out = kit.el('pre', { class: 'pg__out' }, ['']);
      const shelf = kit.el('div', { class: 'pg__shelf' }, [
        modRow({ name: 'Aurora', description: 'Frosted glass over a drifting gradient.', installed: false }),
        modRow({ name: 'Terminal', description: 'Monospace, square corners, phosphor.', installed: false }),
      ]);
      for (const button of shelf.querySelectorAll('button')) {
        button.addEventListener('click', () => {
          const name = button.closest('.betterslack-row').querySelector('.betterslack-row__name').textContent;
          out.textContent = `api.app.setInstalled('${name.toLowerCase()}', true)\n\n`
            + 'The folder is fetched through the loader, which re-validates the manifest:\nfiles off the network are untrusted whichever button asked for them.';
          button.textContent = 'Installed';
          button.disabled = true;
        });
      }
      return [shelf, out];
    },
  },

  /* -- the api object itself ----------------------------------------------- */

  'plugin-id': {
    render: () => [
      source(`api.id            // '${FIXTURES.plugin.id}'\n`
        + `api.settings.get() // scoped to it\n`
        + `api.css(…)         // one stylesheet, keyed on it`),
      kit.el('p', { class: 'sm-hint' }, ['The folder name, which is also the key everything else is filed under.']),
    ],
  },

  'plugin-version': {
    render: () => [
      source(`api.version            // '2.0.1'  — BetterSlack's\n`
        + `api.manifest.version   // '${FIXTURES.plugin.manifest.version ?? '1.0.0'}'  — this mod's\n\n`
        + '// The two move independently: a mod carries its own version and updates\n'
        + '// on its own, so a one-line fix to a theme does not mean pulling the\n'
        + '// loader and the runtime with it.'),
      stubbed('The BetterSlack version is whatever the client is running; the mod version is this repository\u2019s.'),
    ],
  },

  'plugin-manifest': {
    render: () => source(JSON.stringify(FIXTURES.plugin.manifest, null, 2), 'json'),
  },

  'plugin-ondispose': {
    render: (v, { stage, keep }) => {
      const out = kit.el('pre', { class: 'pg__out' }, ['running — leave this entry and come back']);
      const timer = setInterval(() => {
        out.textContent = `tick ${Number((out.textContent.match(/\d+/) ?? [0])[0]) + 1} — still running`;
      }, 1000);
      keep(() => clearInterval(timer));
      return [out, kit.el('p', { class: 'sm-hint' }, [
        'This preview registers its cleanup exactly as a mod does, and the page runs it when you navigate away — which is what onDispose is for.',
      ])];
    },
  },

  'ui-kitcss': {
    render: () => [
      kit.el('div', { class: 'pg__kitrow' }, [
        kit.button('Primary', { variant: 'primary' }),
        kit.button('Default'),
        kit.input({ value: 'A field' }),
        kit.swatch('#7cc4ff', { size: 'md' }),
      ]),
      kit.el('p', { class: 'sm-hint' }, [
        `api.ui.kitCss — ${Math.round(KIT_CSS.length / 1024)} kB of stylesheet, and what the row above is wearing. `
        + 'A window a mod opens is a blank document: none of Slack’s stylesheet reaches it, so the kit brings its own.',
      ]),
      source(`const win = window.open('', 'my-window');\nwin.document.head.append(\n  Object.assign(win.document.createElement('style'), { textContent: api.ui.kitCss }),\n);\nconst kit = api.ui.kit(win.document);`),
    ],
  },
};

/* -- the tools, as previews ----------------------------------------------- */

/** A two-column editor: type on the left, watch the right. */
const TOOLS = {
  'i18n-strings': {
    render: (v) => {
      const out = kit.el('p', { class: 'api-result' }, ['']);
      const TABLES = {
        en: { hello: 'Hi {name}, {count} unread', bye: 'See you' },
        fr: { hello: 'Salut {name}, {count} non lus' },
      };
      // The real translator: English is required and is the fallback for an
      // unknown language *and* for a missing key.
      const t = createI18n(v.locale).strings(TABLES);
      out.textContent = t(v.key, { name: v.name, count: 3 });
      return out;
    },
  },
  'tools-markdown': {
    /*
     * The rendered README and nothing else. It used to carry its own textarea
     * beside the output, which was a second place to type after the controls
     * below already were one -- and the two never agreed about which held the
     * source.
     */
    render: (v) => {
      const out = kit.el('div', { class: 'api-output sm-md' });
      out.innerHTML = renderMarkdown(v.source ?? '');
      return out;
    },
  },
  'tools-highlight': {
    render: (v) => {
      // `auto` rather than an empty option: a select whose first entry is blank
      // reads as a control that has not loaded.
      const forced = v.language && v.language !== 'auto' ? v.language : '';
      const chosen = forced || detect(v.source ?? '');
      const code = kit.el('code', { class: 'betterslack-hl' });
      code.innerHTML = chosen
        ? highlight(v.source ?? '', chosen)
        : (v.source ?? '').replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'));
      return [
        kit.el('p', { class: 'sm-hint' }, [
          forced
            ? `forced to ${chosen}`
            : (chosen ? `detected: ${chosen}` : 'not confident — left alone, which is the point'),
        ]),
        kit.el('pre', { class: 'api-output' }, [code]),
      ];
    },
  },

  'tools-roles': {
    render: (v) => {
      const palette = derivePalette(parseColour(v.background), parseColour(v.accent));
      const ratio = contrast(palette.text, palette.bg);
      const verdict = readability(ratio);
      return [
        kit.el('div', { class: 'api-roles' }, ROLES.map((role) => kit.el('div', { class: 'role' }, [
          kit.swatch(formatCss(palette[role.key]), { size: 'md' }),
          kit.el('div', { class: 'role__text' }, [
            kit.el('strong', {}, [role.key + (role.seed ? ' (seed)' : '')]),
            kit.el('span', { class: 'sm-hint' }, [formatCss(palette[role.key])]),
          ]),
        ]))),
        kit.el('p', { class: `sm-hint${verdict.ok ? '' : ' is-bad'}` }, [
          `contrast(text, bg) = ${ratio.toFixed(2)} — ${verdict.grade}`,
        ]),
      ];
    },
  },
};

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
    // And the body, for everything that renders outside the box that asked.
    document.body.dataset.theme = picker.value;
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
    for (const panel of stack.querySelectorAll('.panel')) {
      if (panel === wanted) continue;
      MOUNTED.get(panel.id)?.teardown();
      panel.hidden = true;
    }
    const shown = MOUNTED.get(wanted.id);
    if (shown && !shown.drawn) shown.draw();
    wanted.hidden = false;
    for (const link of links) {
      const current = link.getAttribute('href') === `#${wanted.id.slice(2)}`;
      link.toggleAttribute('aria-current', current);
      if (current) {
        link.scrollIntoView({ block: 'nearest' });
        DRAWER.label(link);
      }
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

  const fromHash = () => { show(location.hash.slice(1) || stack.dataset.first); DRAWER.close(); };
  window.addEventListener('hashchange', fromHash);
  fromHash();
}

/*
 * The list as a drawer, below 900px.
 *
 * Everything here is behaviour the CSS cannot do on its own: what the button
 * says, closing on a choice, and closing on Escape. The breakpoint itself is
 * the stylesheet's -- the button is simply not drawn above it, so none of this
 * runs on a desktop except the label, which nobody sees.
 */
function drawer() {
  const open = document.getElementById('side-open');
  const scrim = document.getElementById('side-scrim');
  if (!open || !scrim) return { label: () => {}, close: () => {} };

  const set = (on) => {
    document.body.classList.toggle('is-drawer-open', on);
    open.setAttribute('aria-expanded', String(on));
    scrim.hidden = !on;
    if (on) document.getElementById('side-filter')?.focus();
  };
  open.addEventListener('click', () => set(!document.body.classList.contains('is-drawer-open')));
  scrim.addEventListener('click', () => set(false));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.body.classList.contains('is-drawer-open')) set(false);
  });

  return {
    close: () => set(false),
    /** What the button says while the drawer is shut: where you are. */
    label: (link) => {
      const node = document.getElementById('side-open-label');
      if (!node || !link) return;
      const group = link.closest('.side__group')?.querySelector('.side__title')?.textContent ?? '';
      node.textContent = group ? `${group} · ${link.textContent}` : link.textContent;
    },
  };
}

const DRAWER = drawer();

/*
 * The order of each group, which is a choice rather than a fact.
 *
 * A to Z is what the build writes and what you want when you know the name.
 * By date is what you want when you do not: it puts what changed last at the
 * top of its group, from the same `site/api-updated.js` the foot of each page
 * reads. Groups keep their own order either way -- sorting across them would
 * mix `api.helpers` into `api.slack`, and the grouping is the map.
 */
function order() {
  const picker = document.getElementById('side-order');
  if (!picker) return;
  const dates = (typeof window !== 'undefined' && window.__API_UPDATED) || {};

  const apply = () => {
    const byDate = picker.value === 'updated';
    for (const group of document.querySelectorAll('.side__group')) {
      const list = group.querySelector('ul');
      if (!list) continue;
      const items = [...list.children];
      items.sort((a, b) => {
        const linkA = a.querySelector('a');
        const linkB = b.querySelector('a');
        if (!linkA || !linkB) return 0;
        if (!byDate) {
          // The build's own order, kept on the element so a return to A to Z is
          // exact rather than a re-sort that might disagree with it.
          return Number(a.dataset.at ?? 0) - Number(b.dataset.at ?? 0);
        }
        const slugA = linkA.getAttribute('href')?.slice(1) ?? '';
        const slugB = linkB.getAttribute('href')?.slice(1) ?? '';
        /*
         * No date means no commit yet, which means it is being written right
         * now -- the newest thing there is. Left as an empty string it sorted
         * to the bottom of "recently updated", which is the opposite of true.
         */
        const dateA = dates[slugA] || '9999-99-99';
        const dateB = dates[slugB] || '9999-99-99';
        if (dateA === dateB) return Number(a.dataset.at ?? 0) - Number(b.dataset.at ?? 0);
        return dateA < dateB ? 1 : -1;
      });
      list.append(...items);
    }
    localStorage.setItem('betterslack-api-order', picker.value);
  };

  // Stamped once, before anything moves: this is the order the build wrote.
  for (const group of document.querySelectorAll('.side__group')) {
    [...(group.querySelector('ul')?.children ?? [])].forEach((li, at) => { li.dataset.at = String(at); });
  }

  const saved = localStorage.getItem('betterslack-api-order');
  if (saved && [...picker.options].some((o) => o.value === saved)) picker.value = saved;
  picker.addEventListener('change', apply);
  apply();
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
for (const group of [UI, CHROME, SLACK_HELPERS, MORE, TOOLS, REST, IMITATED]) {
  for (const [slug, spec] of Object.entries(group)) PREVIEWS[slug] = spec.render;
}
for (const slot of document.querySelectorAll('[data-demo]')) {
  const render = PREVIEWS[slot.dataset.demo];
  if (render) playground(slot.dataset.demo, render);
  else slot.remove();
}
// Built, then emptied: the controls stay, the demo waits for its panel to be
// opened. See MOUNTED above for why nothing may be mounted in the background.
for (const { teardown } of MOUNTED.values()) teardown();
/*
 * When this page was last touched, at the foot of it.
 *
 * From git, through a file the build regenerates: a date nobody has to remember
 * to bump is a date that is still true a year from now.
 */
function stampDates() {
  const dates = (typeof window !== 'undefined' && window.__API_UPDATED) || {};
  const fr = document.documentElement.lang === 'fr';
  for (const panel of document.querySelectorAll('.panel')) {
    const when = dates[panel.id.replace(/^p-/, '')];
    if (!when) continue;
    const foot = document.createElement('p');
    foot.className = 'panel__updated';
    foot.dataset.en = `Last updated ${when}`;
    foot.dataset.fr = `Mis à jour le ${when}`;
    foot.textContent = fr ? foot.dataset.fr : foot.dataset.en;
    (panel.querySelector('.panel__body') ?? panel).append(foot);
  }
}

stampDates();
wireThemePicker();
order();
router();
filter();

/*
 * The written examples, coloured by the same tokeniser the live ones use, and
 * given the same copy button. They were plain grey text until now, which made
 * the page look like it had two kinds of code in it.
 */
for (const block of document.querySelectorAll('.api-code')) {
  const code = block.querySelector('code');
  /*
   * The guide's fences say what they are; an API entry's example is always
   * JavaScript. The tokeniser here is Code Highlight's, which is the same one
   * running in Slack, and it knows json, css and bash among twenty-one others
   * -- so the guide's manifests and stylesheets are coloured as what they are
   * rather than as JavaScript that happens to parse.
   *
   * The build resolves the name a writer typed (```js) to the one the tokeniser
   * uses (`javascript`) and fails on anything it does not know, so a language
   * arriving here is one of its grammars.
   */
  const language = block.dataset.lang ?? 'javascript';
  if (code && language in LANGUAGES) {
    code.innerHTML = highlight(code.textContent ?? '', language);
  }
  block.append(copyButton(() => code?.textContent ?? ''));
}
