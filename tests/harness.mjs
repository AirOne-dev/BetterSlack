// Shared test harness for mods.
//
// A mod only ever touches the world through the `api` object it is handed, so a
// test can hand it a recording stand-in and then assert on what it tried to do.
// The DOM comes from jsdom; nothing here needs Slack, Electron or a network.

import { JSDOM } from 'jsdom';

/** A Slack-shaped fragment: a message, a composer and a profile pane. */
export const SLACK_FIXTURE = `
<div class="p-client_container">
  <div class="p-view_header__actions"></div>
  <div class="p-control_strip">
    <div class="c-coachmark-anchor"><button data-qa="user-button"></button></div>
  </div>

  <div data-qa="message_container"
       data-msg-ts="1786386808.130969"
       data-msg-channel-id="C0BFQCYBRAB">
    <div class="c-message_kit__avatar">
      <img src="https://ca.slack-edge.com/T025V5WN2-U018V4TL14N-dc5119d9e23c-48">
    </div>
    <a class="c-timestamp" href="https://acme.slack.com/archives/C0BFQCYBRAB/p1786386808130969"></a>
    <div data-qa="message-text">hello world</div>
    <div data-qa="message-actions"></div>
  </div>

  <div data-qa="message_input">
    <div class="ql-editor"><p><br></p></div>
    <div><button data-qa="bold-composer-button"></button></div>
  </div>

  <div data-qa="member_profile_pane">
    <div class="p-r_member_profile__container">
      <img class="p-r_member_profile__avatar__img"
           src="https://ca.slack-edge.com/T025V5WN2-U018V4TL14N-dc5119d9e23c-512">
    </div>
  </div>
</div>`;

/**
 * Install a DOM as globals. Returns a cleanup that puts the globals back, so a
 * failing test cannot leak into the next one.
 */
export function installDom(html = SLACK_FIXTURE) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    url: 'https://app.slack.com/client/T025V5WN2/C0BFQCYBRAB',
    pretendToBeVisual: true,
  });

  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    location: dom.window.location,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    MutationObserver: dom.window.MutationObserver,
    CSS: dom.window.CSS ?? { escape: (s) => s.replace(/[^a-zA-Z0-9_-]/g, '\\$&') },
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 0),
    localStorage: dom.window.localStorage,
    Blob: dom.window.Blob,
    FormData: dom.window.FormData,
  };

  const previous = new Map();
  for (const [key, value] of Object.entries(globals)) {
    previous.set(key, globalThis[key]);
    globalThis[key] = value;
  }

  // jsdom has no clipboard or object URLs; record instead of failing.
  const recorded = { clipboard: [], objectUrls: [], downloads: [] };
  globalThis.navigator.clipboard = {
    writeText: async (text) => void recorded.clipboard.push(text),
  };
  dom.window.URL.createObjectURL = (blob) => {
    const url = `blob:mock/${recorded.objectUrls.length}`;
    recorded.objectUrls.push({ url, blob });
    return url;
  };
  dom.window.URL.revokeObjectURL = () => {};
  globalThis.URL = dom.window.URL;

  // Clicking an <a download> should be observable, not an actual navigation.
  dom.window.HTMLAnchorElement.prototype.click = function click() {
    if (this.hasAttribute('download')) {
      recorded.downloads.push({ name: this.getAttribute('download'), href: this.href });
    }
  };

  return {
    dom,
    document: dom.window.document,
    recorded,
    cleanup() {
      for (const [key, value] of previous) {
        if (value === undefined) delete globalThis[key];
        else globalThis[key] = value;
      }
      dom.window.close();
    },
  };
}

function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else el.setAttribute(k, v);
  }
  for (const c of children) el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

/**
 * A stand-in for the real plugin API.
 *
 * Registrations are recorded rather than applied, so a test can call the
 * handlers directly. Anything a mod is expected to render (modals, toasts) is
 * captured too.
 */
export function createTestApi({ settings = {}, web = {} } = {}) {
  const recorded = {
    css: [],
    toasts: [],
    modals: [],
    confirms: [],
    messageActions: [],
    toolbarButtons: [],
    profileButtons: [],
    shortcuts: [],
    mounted: [],
    saved: [],
    disposers: [],
    logs: [],
  };
  const store = { ...settings };
  let confirmAnswer = true;

  const webApi = {
    available: true,
    teamDomain: 'acme',
    selfId: 'U000SELF',
    call: async () => ({ ok: true }),
    userInfo: async () => ({ id: 'U018V4TL14N' }),
    presence: async () => ({ presence: 'active' }),
    teamInfo: async () => ({ team: { id: 'T025V5WN2' } }),
    dndInfo: async () => ({ dnd_enabled: false }),
    ...web,
  };

  const api = {
    id: 'test-mod',
    version: '0.0.0-test',
    manifest: { id: 'test-mod', name: 'Test', type: 'plugin' },

    dom: {
      h,
      waitFor: async (selector) => document.querySelector(selector),
      keepMounted: (container, id, factory) => {
        const target = document.querySelector(container);
        const node = factory();
        node.id = id;
        target?.append(node);
        recorded.mounted.push({ container, id, node });
        return () => node.remove();
      },
      onEach: (selector, handler) => {
        for (const el of document.querySelectorAll(selector)) handler(el);
        return () => {};
      },
      onShortcut: (match, handler) => {
        recorded.shortcuts.push({ match, handler });
        return () => {};
      },
    },

    slack: {
      web: webApi,
      addMessageAction: (action) => {
        recorded.messageActions.push(action);
        return () => {};
      },
      addToolbarButton: (toolbar, button) => {
        recorded.toolbarButtons.push({ toolbar, button });
        return () => {};
      },
      addProfileButton: (button) => {
        recorded.profileButtons.push(button);
        return () => {};
      },
      onProfilePane: () => () => {},
      describeMessage: (element) => ({
        element,
        channelId: element.getAttribute('data-msg-channel-id'),
        ts: element.getAttribute('data-msg-ts'),
        permalink: element.querySelector('a.c-timestamp')?.getAttribute('href') ?? null,
        text: element.querySelector('[data-qa="message-text"]')?.textContent ?? '',
      }),
      composer: {
        element: () => document.querySelector('.ql-editor'),
        focus: () => true,
        caretToEnd: () => {},
        insertText: (text) => {
          recorded.composerText = (recorded.composerText ?? '') + text;
          return true;
        },
        insertLink: (url, text) => {
          recorded.composerLink = { url, text };
          return true;
        },
        isEmpty: () => true,
      },
      selectors: {},
    },

    ui: {
      toast: (message, options = {}) => {
        const entry = { message, ...options, dismissed: false };
        recorded.toasts.push(entry);
        return { dismiss: () => { entry.dismissed = true; } };
      },
      modal: (options) => {
        const body = h('div');
        if (typeof options.content === 'string') body.append(h('p', {}, [options.content]));
        else if (options.content) body.append(options.content);
        const entry = { options, body, closed: false };
        recorded.modals.push(entry);
        return { body, close: () => { entry.closed = true; } };
      },
      confirm: async (options) => {
        recorded.confirms.push(options);
        return confirmAnswer;
      },
      tooltip: () => () => {},
    },

    files: {
      save: async (url, filename) => {
        if (recorded.downloadShouldFail) throw new Error(recorded.downloadShouldFail);
        const entry = { url, filename, bytes: 2048 };
        recorded.saved.push(entry);
        return { path: `/tmp/${filename}`, bytes: entry.bytes };
      },
    },

    css: (text) => recorded.css.push(text),
    settings: {
      all: () => ({ ...store }),
      get: (key, fallback) => (key in store ? store[key] : fallback),
      set: async (key, value) => { store[key] = value; },
    },
    onDispose: (fn) => recorded.disposers.push(fn),
    log: {
      info: (...args) => recorded.logs.push(['info', ...args]),
      warn: (...args) => recorded.logs.push(['warn', ...args]),
      error: (...args) => recorded.logs.push(['error', ...args]),
    },
  };

  return {
    api,
    recorded,
    store,
    setConfirmAnswer: (value) => { confirmAnswer = value; },
  };
}

/** Every mod must satisfy this, whatever else its own test checks. */
export function assertPluginShape(assert, plugin) {
  assert.equal(typeof plugin, 'object', 'default export must be an object');
  assert.equal(typeof plugin.start, 'function', 'must export start()');
  if (plugin.stop !== undefined) {
    assert.equal(typeof plugin.stop, 'function', 'stop() must be a function when present');
  }
}
