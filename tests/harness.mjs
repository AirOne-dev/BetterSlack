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
import { createKit } from '../dist/ui/kit.mjs';
import { openMenu } from '../dist/ui/menu.mjs';
import { KIT_CSS } from '../dist/ui/kit-css.mjs';

/** A Slack-shaped fragment: rail, sidebar, a message, a composer, a profile pane. */
export const SLACK_FIXTURE = `
<div class="p-client_container">
  <div class="p-view_header__actions">
    <button data-qa="avatar_stack" aria-label="View all members"></button>
  </div>
  <div class="p-control_strip">
    <div class="c-coachmark-anchor">
      <button data-qa="user-button">
        <span class="c-avatar" data-mask="mask__base-member">
          <img src="https://ca.slack-edge.com/T025V5WN2-U041KF85GP5-480e63356723-48">
          <!-- Where Slack keeps your own availability, and swaps the modifier
               the moment it changes. Measured against Slack 4.51. -->
          <span class="c-avatar__presence c-presence c-presence--active block"></span>
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

  /*
   * Defined rather than assigned.
   *
   * Node 22 ships its own `globalThis.navigator`, and it is a getter with no
   * setter: `globalThis.navigator = …` throws "Cannot set property navigator of
   * #<Object> which has only a getter", and every test that installs a DOM dies
   * on the first line. It passed for a long time only because the machine it
   * was written on runs Node 20. Nine tests failed the moment CI moved.
   */
  const previous = new Map();
  for (const [key, value] of Object.entries(globals)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
      enumerable: true,
    });
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
      // Put back exactly what was there, getter and all, so a suite that runs
      // in one process leaves the next test the globals it expects.
      for (const [key, descriptor] of previous) {
        if (descriptor === undefined) delete globalThis[key];
        else Object.defineProperty(globalThis, key, descriptor);
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
export function createTestApi({
  settings = {},
  web = {},
  locale = 'en-GB',
  files = {},
  // The catalogue a mod sees through `api.app`. Empty by default: a mod that
  // reads it should behave with nothing installed.
  mods = [],
} = {}) {
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
    themeSuspensions: [],
    menus: [],
    settingsListeners: [],
    commands: [],
    logs: [],
    navigations: [],
    savedThemes: [],
    hidden: [],
    huddles: [],
    vips: new Set(),
    /** Panels opened through `api.app`: a tab name, or { mod: id }. */
    panels: [],
    /** Every `api.ui.palette(...)`, with the source it was given. */
    palettes: [],
    /** `api.app.setEnabled` / `setInstalled` calls. */
    modChanges: [],
    /** Every `api.files.screenshot(...)`, with what was still visible. */
    screenshots: [],
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

  // Built on whatever the test supplied above rather than stubbed separately,
  // so a test that overrides `userInfo` or `presence` sees its own answers come
  // back through the batched and combined forms as well.
  if (!web.users) {
    webApi.users = async (ids) => {
      const wanted = [...new Set(ids)].filter(Boolean);
      const out = new Map();
      if (!wanted.length) return out;
      // The batch form first, exactly as the real one does, so a test that
      // stubs `call('users.info', { users })` still sees the request it expects.
      const res = await webApi
        .call('users.info', { users: wanted.join(','), include_locale: true })
        .catch(() => null);
      if (Array.isArray(res?.users)) {
        for (const user of res.users) out.set(user.id, user);
        return out;
      }
      for (const id of wanted) {
        const user = await webApi.userInfo(id).catch(() => null);
        if (user) out.set(id, { ...user, id: user.id ?? id });
      }
      return out;
    };
  }
  if (!web.availability) {
    webApi.availability = async (userId) => {
      const [presence, dnd] = await Promise.all([
        webApi.presence(userId).catch(() => null),
        webApi.dndInfo(userId).catch(() => null),
      ]);
      // The same rule as the runtime: `dnd_enabled` alone is a *schedule*, so
      // it only counts while now is inside the window it describes. Someone
      // with quiet hours every night is not away all day.
      const now = Date.now() / 1000;
      const scheduled = Boolean(dnd?.dnd_enabled)
        && Number(dnd?.next_dnd_start_ts) <= now
        && now < Number(dnd?.next_dnd_end_ts);
      if (dnd?.snooze_enabled || scheduled) return { state: 'dnd', presence, dnd };
      if (!presence) return { state: 'unknown', presence, dnd };
      return { state: presence.presence === 'active' ? 'active' : 'away', presence, dnd };
    };
  }

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

      // The real rule, not a stub: Slack serves avatars as `<base>-<size>`,
      // and anything else is left alone.
      avatarUrl: (url, size) =>
        typeof url === 'string' && /-\d+$/.test(url) ? url.replace(/-\d+$/, `-${size}`) : null,

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
        const body = h('div', { class: 'betterslack-test-modal' });
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
      // The real kit, so a mod's test exercises the components the app builds
      // rather than a stand-in that always agrees with it.
      // The real menu, not a recorder: it is Slack's own markup positioned by
      // us, and a mod's test asserting on `.c-menu_item__button` should be
      // asserting on what the app really builds.
      menu: (anchor, items, options) => {
        const close = openMenu(anchor, items, options);
        recorded.menus.push({ anchor, items });
        recorded.disposers.push(close);
        return close;
      },
      kit: (target = globalThis.document) => createKit(target),
      kitCss: KIT_CSS,

      // Recorded rather than drawn. What a palette is for is the list it is
      // given, so a test asks for that list -- and since the source may be a
      // function of the query, the recording keeps the function itself.
      palette: (source, labels) => {
        const entry = {
          source,
          labels,
          /** What the palette would show for a query, in that mode. */
          entries: (query = '', mode = null) =>
            (typeof source === 'function' ? source(query, mode) : source),
        };
        recorded.palettes.push(entry);
        const close = () => {};
        close.refresh = () => {};
        return close;
      },
    },

    /*
     * BetterSlack itself, as a mod sees it.
     *
     * Modelled here rather than in each test because it is a real surface with
     * real rules -- `settings` is the count of what a mod declared, and a mod
     * offering to configure one that declared none is the bug this catches.
     */
    app: {
      mods: () => mods.map((mod) => ({ settings: 0, ...mod })),
      commands: () => [...recorded.commands],
      setEnabled: async (id, enabled) => {
        recorded.modChanges.push({ id, enabled });
      },
      setInstalled: async (id, installed) => {
        recorded.modChanges.push({ id, installed });
      },
      openPanel: (tab) => recorded.panels.push(tab ?? 'default'),
      openMod: (id) => recorded.panels.push({ mod: id }),
    },

    // Recorded rather than run: a test asserts a mod offered a command, and
    // can then run it by hand.
    commands: {
      add: (command) => {
        recorded.commands.push(command);
        return () => {
          recorded.commands = recorded.commands.filter((other) => other !== command);
        };
      },
    },

    files: {
      save: async (url, filename) => {
        if (recorded.downloadShouldFail) throw new Error(recorded.downloadShouldFail);
        const entry = { url, filename, bytes: 2048 };
        recorded.saved.push(entry);
        return { path: `/tmp/${filename}`, bytes: entry.bytes };
      },
      screenshot: async (options = {}) => {
        if (recorded.screenshotShouldFail) throw new Error(recorded.screenshotShouldFail);
        /*
         * Recorded with the state of <html> at the moment of the call.
         *
         * The shutter is on the loader's side and photographs whatever is on
         * screen, so a mod that wants its own chrome out of the picture has to
         * hide it *before* asking and put it back after. Inside the call is
         * the only moment a test can see whether it did.
         */
        recorded.screenshots.push({ ...options, htmlClass: document.documentElement.className });
        return { path: `/tmp/${options.filename ?? 'slack.png'}`, bytes: 4096 };
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
      suspend: (on) => recorded.themeSuspensions.push(on),
    },
    settings: {
      all: () => ({ ...store }),
      get: (key, fallback) => (key in store ? store[key] : fallback),
      set: async (key, value) => { store[key] = value; },
      onChange: (handler) => {
        recorded.settingsListeners.push(handler);
        return () => {};
      },
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
