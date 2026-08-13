// Shared test harness for mods.
//
// A mod only ever touches the world through the `api` object it is handed, so a
// test can hand it a recording stand-in and then assert on what it tried to do.
// The DOM comes from jsdom; nothing here needs Slack, Electron or a network.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
// The real helpers, so a mod's test covers the helper code it leans on rather
// than a stand-in that could drift from it.
import { createHelpers } from '../dist/helpers.mjs';
import { createI18n } from '../dist/i18n.mjs';

/** A Slack-shaped fragment: rail, sidebar, a message, a composer, a profile pane. */
export const SLACK_FIXTURE = `
<div class="p-client_container">
  <div class="p-view_header__actions">
    <button data-qa="avatar_stack" aria-label="View all members"></button>
  </div>
  <div class="p-control_strip">
    <div class="c-coachmark-anchor">
      <button data-qa="user-button">
        <span class="c-avatar">
          <img src="https://ca.slack-edge.com/T025V5WN2-U041KF85GP5-480e63356723-48">
        </span>
        <svg data-qa="presence_indicator" aria-label="Active"></svg>
      </button>
    </div>
  </div>

  <div class="p-tab_rail p-tab_rail__desktop" data-qa="tab_rail_desktop">
    <div class="p-tab_rail__tab_container" data-qa="tabs_full_height_class">
      <div class="p-tab_rail__tab_menu" data-qa="tabs_full_width_class">
        <button class="p-tab_rail__button p-tab_rail__button--active" data-qa="tab_rail_home_button">
          <div class="p-tab_rail__button__icon"></div>
          <div class="p-tab_rail__button__label">Home</div>
        </button>
        <button class="p-tab_rail__button" data-qa="tab_rail_dms_button">
          <div class="p-tab_rail__button__icon"></div>
          <div class="p-tab_rail__button__label">DMs</div>
        </button>
      </div>
    </div>
  </div>

  <div class="p-channel_sidebar" data-qa="channel-sidebar">
    <div class="p-ia4_sidebar_header p-ia4_home_header">
      <div class="p-ia4_sidebar_header__title">Acme</div>
      <div class="p-ia4_sidebar_header__controls"></div>
    </div>
    <div class="p-channel_sidebar__list"></div>
  </div>

  <div class="p-view_contents p-view_contents--primary">
    <div class="p-message_pane">
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
    </div>
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
export function createTestApi({ settings = {}, web = {}, locale = 'en-GB', files = {} } = {}) {
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
    navigations: [],
    savedThemes: [],
    hidden: [],
    huddles: [],
    vips: new Set(),
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
      // Observes, like the real one. A one-shot scan would quietly pass mods
      // that only work on what is already on screen -- and Slack renders almost
      // nothing before a mod starts.
      onEach: (selector, handler) => {
        const seen = new WeakSet();
        const scan = () => {
          for (const el of document.querySelectorAll(selector)) {
            if (seen.has(el)) continue;
            seen.add(el);
            handler(el);
          }
        };
        scan();
        const observer = new MutationObserver(scan);
        observer.observe(document.documentElement, { childList: true, subtree: true });
        recorded.disposers.push(() => observer.disconnect());
        return () => observer.disconnect();
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

      // The navigation and conversation helpers. Recorded rather than
      // performed, so a test can assert a mod called one instead of driving
      // Slack's UI to the same place.
      openConversation: (channelId) => recorded.navigations.push({ kind: 'channel', id: channelId }),
      openDirectMessage: async (userId) => {
        recorded.navigations.push({ kind: 'dm', id: userId });
        return `D-${userId}`;
      },
      openUserProfile: (userId) => recorded.navigations.push({ kind: 'profile', id: userId }),
      hideConversation: async (channelId) => { recorded.hidden.push(channelId); },
      filesFrom: async () => [],
      startHuddle: async (userId) => {
        recorded.huddles.push(userId);
        return true;
      },
      vipUsers: async () => [...recorded.vips],
      setVip: async (userId, isVip) => {
        if (isVip) recorded.vips.add(userId);
        else recorded.vips.delete(userId);
        return isVip;
      },
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
      userIdFromMessage: (message) => {
        const src = message.element?.querySelector('.c-message_kit__avatar img, .c-avatar img')?.src;
        const m = src?.match(/\/T[A-Z0-9]+-(U[A-Z0-9]+)-/i);
        return m ? m[1].toUpperCase() : null;
      },
      currentChannelId: () => {
        const match = location.pathname.match(/\/client\/[^/]+\/([A-Z0-9]+)/i);
        return match ? match[1].toUpperCase() : null;
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
        // Mounted for real, like the live one: a mod that fills a dialog in
        // after an await checks `body.isConnected` before touching it, and a
        // detached stand-in would make that check silently skip the update.
        const body = h('div', { class: 'slackmod-test-modal' });
        if (typeof options.content === 'string') body.append(h('p', {}, [options.content]));
        else if (options.content) body.append(options.content);
        document.body.append(body);
        const entry = { options, body, closed: false };
        recorded.modals.push(entry);
        return {
          body,
          close: () => {
            entry.closed = true;
            body.remove();
          },
        };
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

    // The mod's own folder. Tests that need it pass `files` to createTestApi;
    // the default is empty, so a plugin reading an asset it did not ship gets
    // the same error here as it would in the app.
    assets: {
      list: () => Object.keys(files),
      text: (path) => {
        const name = path.replace(/^\.\//, '');
        if (!(name in files)) throw new Error(`"${path}" is not in the mod folder`);
        return files[name];
      },
    },

    // The real implementation, so a mod's dictionaries are exercised rather
    // than a stand-in that always answers in English.
    i18n: createI18n(locale),

    css: (text) => recorded.css.push(text),
    saveTheme: async (options) => { recorded.savedThemes.push(options); },
    themes: {
      list: () => [
        { id: 'midnight', name: 'Midnight', description: 'A dark theme', enabled: false },
        { id: 'aurora', name: 'Aurora', description: 'Gradients', enabled: true },
      ],
      source: async (id) => `/* ${id} */ :root { --dt_color-base-pry: #101014; }`,
    },
    settings: {
      all: () => ({ ...store }),
      get: (key, fallback) => (key in store ? store[key] : fallback),
      set: async (key, value) => { store[key] = value; },
    },
    helpers: undefined, // assigned below, once `api` exists

    onDispose: (fn) => recorded.disposers.push(fn),
    log: {
      info: (...args) => recorded.logs.push(['info', ...args]),
      warn: (...args) => recorded.logs.push(['warn', ...args]),
      error: (...args) => recorded.logs.push(['error', ...args]),
    },
  };

  api.helpers = createHelpers({
    pluginId: api.id,
    css: (text) => recorded.css.push(text),
    saveTheme: async (options) => { recorded.savedThemes.push(options); },
    themes: {
      list: () => [
        { id: 'midnight', name: 'Midnight', description: 'A dark theme', enabled: false },
        { id: 'aurora', name: 'Aurora', description: 'Gradients', enabled: true },
      ],
      source: async (id) => `/* ${id} */ :root { --dt_color-base-pry: #101014; }`,
    },
    toast: (message, options) => api.ui.toast(message, options),
    settings: api.settings,
    track: (cleanup) => {
      recorded.disposers.push(cleanup);
      return cleanup;
    },
  });

  return {
    api,
    recorded,
    store,
    setConfirmAnswer: (value) => { confirmAnswer = value; },
  };
}

/**
 * Load a mod the way the runtime does: as a folder of files stitched into a
 * module graph, so a test exercises the same import resolution the app uses.
 *
 * Node resolves relative imports from disk on its own, so a mod's own test can
 * simply `import plugin from './index.js'`. This is here for tests that want to
 * assert on the *graph* — that every import lands somewhere real.
 */
export function readModFiles(dir) {
  const files = {};
  const walk = (current, prefix) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        walk(join(current, entry.name), rel);
      } else if (/\.(js|mjs|css)$/.test(entry.name)) {
        files[rel] = readFileSync(join(current, entry.name), 'utf8');
      }
    }
  };
  walk(dir, '');
  return files;
}

/** Every mod must satisfy this, whatever else its own test checks. */
export function assertPluginShape(assert, plugin) {
  assert.equal(typeof plugin, 'object', 'default export must be an object');
  assert.equal(typeof plugin.start, 'function', 'must export start()');
  if (plugin.stop !== undefined) {
    assert.equal(typeof plugin.stop, 'function', 'stop() must be a function when present');
  }
}
