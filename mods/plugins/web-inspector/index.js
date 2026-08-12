/**
 * Web Inspector — a console and an element picker inside Slack.
 *
 * WHY THIS IS NOT A BUTTON THAT OPENS SLACK'S DEVTOOLS
 *
 * Slack's own DevTools are behind a main-process menu item
 * (TOGGLE_WEBAPP_DEVTOOLS, ⌘⌥I) that only appears with the developer menu
 * enabled. Nothing in Slack's renderer bridge exposes it, and a synthetic
 * ⌘⌥I does not reach it either — measured: macOS menu accelerators are handled
 * by the app menu, not by the renderer, so a CDP-injected key event does
 * nothing. The remaining routes are an OS-level keystroke (needs Accessibility
 * permission) or reopening a debugging port, and reopening the port would undo
 * the reason SlackMod uses a pipe in the first place.
 *
 * So this builds the two things you actually reach for instead:
 *
 *   Console   backed by api.devtools.evaluate, which runs through the loader's
 *             CDP session. That is *more* than the page can do: Slack's CSP has
 *             no 'unsafe-eval', so the page cannot evaluate a string at all.
 *   Elements  a picker that highlights what you hover, and reports the stable
 *             selector for what you click — data-qa first, then a BEM class,
 *             never a hashed CSS-module name.
 */

const PANEL_ID = 'slackmod-inspector-panel';
const OVERLAY_ID = 'slackmod-inspector-overlay';

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true">
  <path fill="currentColor" fill-rule="evenodd" d="M3.75 3.5A1.75 1.75 0 0 0 2 5.25v9.5c0 .97.78 1.75 1.75 1.75h12.5A1.75 1.75 0 0 0 18 14.75v-9.5A1.75 1.75 0 0 0 16.25 3.5H3.75Zm-.25 1.75a.25.25 0 0 1 .25-.25h12.5a.25.25 0 0 1 .25.25V7h-13V5.25ZM3.5 8.5v6.25c0 .14.11.25.25.25h12.5a.25.25 0 0 0 .25-.25V8.5h-13Z" clip-rule="evenodd"/>
  <path fill="currentColor" d="M5.7 10.2a.75.75 0 0 1 1.06 0l1.5 1.5a.75.75 0 0 1 0 1.06l-1.5 1.5a.75.75 0 0 1-1.06-1.06l.97-.97-.97-.97a.75.75 0 0 1 0-1.06Zm4.05 2.55a.75.75 0 0 0 0 1.5h3a.75.75 0 0 0 0-1.5h-3Z"/>
</svg>`;

/** True for CSS-module output like `circleButton__cMiUK`, whose suffix churns. */
export function isHashedClass(name) {
  return /__[A-Za-z0-9]*[A-Z][A-Za-z0-9]*$/.test(name);
}

/**
 * The steadiest way to address an element, best first:
 * a data-qa attribute, then a hand-written BEM class, then the tag.
 */
export function stableSelectorFor(element) {
  if (!element || !element.tagName) return null;
  const qa = element.getAttribute?.('data-qa');
  if (qa) return `[data-qa="${qa}"]`;

  const classes = (element.className?.toString?.() ?? '').split(/\s+/).filter(Boolean);
  const stable = classes.filter((c) => /^[cp]-/.test(c) && !isHashedClass(c));
  if (stable.length > 0) return `.${stable[0]}`;

  const role = element.getAttribute?.('role');
  if (role) return `${element.tagName.toLowerCase()}[role="${role}"]`;
  return element.tagName.toLowerCase();
}

/** Walk up until something addressable turns up. */
export function describeElement(element) {
  const chain = [];
  let node = element;
  while (node && node.tagName && chain.length < 6) {
    chain.push({
      tag: node.tagName.toLowerCase(),
      selector: stableSelectorFor(node),
      qa: node.getAttribute?.('data-qa') ?? null,
      classes: (node.className?.toString?.() ?? '').split(/\s+/).filter(Boolean),
    });
    node = node.parentElement;
  }
  return chain;
}

export default {
  /**
   * @param {import('../../../src/runtime/api.js').PluginApi} api
   */
  start(api) {
    api.css(`
      #${OVERLAY_ID} {
        position: fixed; z-index: 2147482900; pointer-events: none;
        background: rgba(88, 101, 242, 0.28);
        outline: 1px solid rgba(88, 101, 242, 0.9);
        border-radius: 2px; transition: all 40ms linear;
      }
      #${OVERLAY_ID}::after {
        content: attr(data-label);
        position: absolute; left: 0; top: 100%; margin-top: 4px;
        padding: 2px 6px; border-radius: 4px; white-space: nowrap;
        font: 600 11px/1.4 Monaco, Menlo, monospace;
        background: #111214; color: #f2f3f5;
      }
      #${PANEL_ID} {
        position: fixed; right: 16px; bottom: 16px; z-index: 2147482800;
        width: min(560px, 46vw); height: min(420px, 52vh);
        display: flex; flex-direction: column; overflow: hidden;
        border-radius: 10px; font-family: Lato, Slack-Lato, sans-serif;
        background: var(--dt_color-base-pry, #fff);
        color: var(--dt_color-content-pry, #1d1c1d);
        border: 1px solid var(--dt_color-otl-sec, rgba(94,93,96,.35));
        box-shadow: 0 16px 44px rgba(0,0,0,.4);
        backdrop-filter: blur(20px);
      }
      #${PANEL_ID} header {
        display: flex; align-items: center; gap: 8px; padding: 8px 10px;
        border-bottom: 1px solid var(--dt_color-otl-sec, rgba(94,93,96,.35));
      }
      #${PANEL_ID} header strong { font-size: 13px; }
      #${PANEL_ID} .sm-tab {
        all: unset; cursor: pointer; font-size: 12px; font-weight: 700;
        padding: 4px 10px; border-radius: 6px; color: var(--dt_color-content-sec, #454447);
      }
      #${PANEL_ID} .sm-tab[aria-selected="true"] {
        background: var(--dt_color-content-hgl-2, #007a5a); color: #fff;
      }
      #${PANEL_ID} .sm-spacer { flex: 1; }
      #${PANEL_ID} .sm-body { flex: 1; overflow: auto; padding: 8px 10px; }
      #${PANEL_ID} .sm-log {
        font: 12px/1.5 Monaco, Menlo, monospace; white-space: pre-wrap;
        word-break: break-word; padding: 3px 0;
        border-bottom: 1px solid var(--dt_color-otl-ter, rgba(94,93,96,.12));
      }
      #${PANEL_ID} .sm-log--error { color: var(--dt_color-content-imp, #c01343); }
      #${PANEL_ID} .sm-log--warn { color: var(--dt_color-content-hgl-3, #6b5000); }
      #${PANEL_ID} .sm-log--in { color: var(--dt_color-content-sec, #454447); }
      #${PANEL_ID} .sm-input {
        display: flex; gap: 6px; padding: 8px 10px;
        border-top: 1px solid var(--dt_color-otl-sec, rgba(94,93,96,.35));
      }
      #${PANEL_ID} .sm-input input {
        flex: 1; font: 12px/1.5 Monaco, Menlo, monospace; padding: 6px 8px;
        border-radius: 6px; color: inherit;
        background: var(--dt_color-base-sec, #f8f8f8);
        border: 1px solid var(--dt_color-otl-sec, rgba(94,93,96,.35));
      }
      #${PANEL_ID} .sm-btn {
        all: unset; cursor: pointer; font-size: 12px; font-weight: 700;
        padding: 5px 10px; border-radius: 6px;
        border: 1px solid var(--dt_color-otl-sec, rgba(94,93,96,.35));
      }
      #${PANEL_ID} .sm-btn:hover { background: var(--dt_color-base-pry-hover, rgba(0,0,0,.06)); }
      #${PANEL_ID} .sm-sel {
        font: 700 12px/1.5 Monaco, Menlo, monospace;
        background: var(--dt_color-base-sec, #f8f8f8);
        padding: 6px 8px; border-radius: 6px; margin-bottom: 6px;
        display: flex; justify-content: space-between; gap: 8px; align-items: center;
      }
      #${PANEL_ID} .sm-chain { font: 12px/1.6 Monaco, Menlo, monospace; opacity: .85; }
      #${PANEL_ID} .sm-hashed { text-decoration: line-through; opacity: .5; }
    `);

    let panel = null;
    let tab = 'console';
    const logs = [];
    let picking = false;

    const addLog = (kind, text) => {
      logs.push({ kind, text });
      if (logs.length > 300) logs.shift();
      if (panel && tab === 'console') renderBody();
    };

    // Capture what Slack and other mods print, so the console is useful the
    // moment it is opened rather than only from then on.
    const original = {};
    for (const level of ['log', 'warn', 'error']) {
      original[level] = console[level];
      console[level] = (...args) => {
        addLog(level, args.map((a) => {
          try { return typeof a === 'string' ? a : JSON.stringify(a); }
          catch { return String(a); }
        }).join(' '));
        original[level](...args);
      };
    }
    const onError = (event) => addLog('error', event.message ?? String(event.reason ?? event));
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onError);

    const overlay = () => {
      let node = document.getElementById(OVERLAY_ID);
      if (!node) {
        node = api.dom.h('div', { id: OVERLAY_ID });
        document.body.append(node);
      }
      return node;
    };

    let selected = null;

    const onPickMove = (event) => {
      const target = event.target;
      if (!target || target.closest?.(`#${PANEL_ID}`)) return;
      const rect = target.getBoundingClientRect();
      const node = overlay();
      Object.assign(node.style, {
        left: `${rect.left}px`, top: `${rect.top}px`,
        width: `${rect.width}px`, height: `${rect.height}px`, display: 'block',
      });
      node.dataset.label = stableSelectorFor(target) ?? target.tagName.toLowerCase();
    };

    const stopPicking = () => {
      picking = false;
      document.removeEventListener('mousemove', onPickMove, true);
      document.removeEventListener('click', onPickClick, true);
      document.getElementById(OVERLAY_ID)?.remove();
      if (panel) render();
    };

    const onPickClick = (event) => {
      if (event.target?.closest?.(`#${PANEL_ID}`)) return;
      event.preventDefault();
      event.stopPropagation();
      selected = describeElement(event.target);
      tab = 'elements';
      stopPicking();
    };

    const startPicking = () => {
      picking = true;
      document.addEventListener('mousemove', onPickMove, true);
      document.addEventListener('click', onPickClick, true);
      render();
    };

    const evaluate = async (expression) => {
      addLog('in', `› ${expression}`);
      const result = await api.devtools.evaluate(expression);
      if (result.error) addLog('error', result.error);
      else {
        const value = result.value;
        addLog('log', typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? String(value));
      }
    };

    const renderBody = () => {
      const body = panel?.querySelector('.sm-body');
      if (!body) return;
      body.replaceChildren();

      if (tab === 'console') {
        for (const entry of logs) {
          body.append(api.dom.h('div', { class: `sm-log sm-log--${entry.kind}` }, [entry.text]));
        }
        body.scrollTop = body.scrollHeight;
        return;
      }

      if (!selected) {
        body.append(api.dom.h('div', { class: 'sm-log sm-log--in' }, [
          picking ? 'Click any element in Slack. Escape cancels.' : 'Press Pick, then click an element.',
        ]));
        return;
      }

      const best = selected[0];
      const row = api.dom.h('div', { class: 'sm-sel' }, [
        api.dom.h('span', {}, [best.selector ?? best.tag]),
      ]);
      const copy = api.dom.h('button', { class: 'sm-btn' }, ['Copy']);
      copy.addEventListener('click', async () => {
        await navigator.clipboard.writeText(best.selector ?? best.tag);
        api.ui.toast('Selector copied', { variant: 'success' });
      });
      row.append(copy);
      body.append(row);

      const chain = api.dom.h('div', { class: 'sm-chain' });
      for (const step of selected) {
        const line = api.dom.h('div', {}, [`${step.tag}  `]);
        for (const cls of step.classes) {
          line.append(api.dom.h('span', { class: isHashedClass(cls) ? 'sm-hashed' : '' }, [`.${cls} `]));
        }
        chain.append(line);
      }
      body.append(chain);
      body.append(api.dom.h('div', { class: 'sm-log sm-log--in' }, [
        'Struck-through classes are CSS-module output and change on Slack’s next build.',
      ]));
    };

    const render = () => {
      if (!panel) return;
      panel.replaceChildren();

      const tabs = ['console', 'elements'].map((name) => {
        const button = api.dom.h('button', {
          class: 'sm-tab', role: 'tab', 'aria-selected': String(tab === name),
        }, [name === 'console' ? 'Console' : 'Elements']);
        button.addEventListener('click', () => { tab = name; render(); });
        return button;
      });

      const pick = api.dom.h('button', { class: 'sm-btn' }, [picking ? 'Cancel' : 'Pick']);
      pick.addEventListener('click', () => (picking ? stopPicking() : startPicking()));

      const clear = api.dom.h('button', { class: 'sm-btn' }, ['Clear']);
      clear.addEventListener('click', () => { logs.length = 0; renderBody(); });

      const close = api.dom.h('button', { class: 'sm-btn' }, ['×']);
      close.addEventListener('click', () => toggle(false));

      panel.append(api.dom.h('header', {}, [
        api.dom.h('strong', {}, ['Inspector']),
        ...tabs,
        api.dom.h('span', { class: 'sm-spacer' }),
        pick, clear, close,
      ]));
      panel.append(api.dom.h('div', { class: 'sm-body' }));

      if (tab === 'console') {
        const input = api.dom.h('input', {
          type: 'text', spellcheck: 'false', placeholder: 'Expression, then Enter',
        });
        input.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' || input.value.trim() === '') return;
          const expression = input.value;
          input.value = '';
          void evaluate(expression);
        });
        panel.append(api.dom.h('div', { class: 'sm-input' }, [input]));
        queueMicrotask(() => input.focus());
      }

      renderBody();
    };

    const toggle = (next) => {
      const wanted = next ?? !panel;
      if (!wanted) {
        stopPicking();
        panel?.remove();
        panel = null;
        return;
      }
      if (panel) return;
      panel = api.dom.h('div', { id: PANEL_ID, role: 'dialog', 'aria-label': 'Inspector' });
      document.body.append(panel);
      render();
    };

    api.dom.onShortcut(
      (event) => event.key === 'Escape' && picking,
      () => stopPicking(),
    );

    // Above the SlackMod button: both insert before the avatar, so without an
    // explicit anchor this one would land underneath it.
    api.slack.addToolbarButton('controlStrip', {
      id: 'inspector',
      label: 'Inspector',
      description: 'Console and element picker',
      icon: ICON,
      before: '#slackmod-control-button',
      onClick: () => toggle(),
    });

    api.onDispose(() => {
      stopPicking();
      panel?.remove();
      for (const level of ['log', 'warn', 'error']) console[level] = original[level];
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onError);
    });
  },

  stop() {},
};
