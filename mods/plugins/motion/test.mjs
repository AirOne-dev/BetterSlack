// What Motion promises, checked against the real stylesheet it ships.
//
// The interesting failures here are not "does it animate" -- jsdom has no
// compositor and never will. They are the ones that make the mod lie: a speed
// control that scales the wrong way, a group whose checkbox does nothing, a
// reduced-motion setting that is read once and never again, and classes left
// on <html> after the plugin is switched off.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assertPluginShape, createTestApi, installDom, readModFiles } from '../../../tests/harness.mjs';
import plugin from './index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
/** The mod's own folder, so the test runs against the stylesheet that ships. */
const FILES = readModFiles(here);

const ROOT = 'betterslack-motion';
const GROUPS = ['views', 'panels', 'hover', 'press', 'arrivals'];

/** A stand-in for the media query, so the test can say what the system prefers. */
function fakeReducedMotion(matches) {
  const listeners = new Set();
  const query = {
    matches,
    addEventListener: (_type, fn) => listeners.add(fn),
    removeEventListener: (_type, fn) => listeners.delete(fn),
  };
  window.matchMedia = () => query;
  return {
    query,
    /** The user changing it in their system settings, after the mod started. */
    change(next) {
      query.matches = next;
      for (const fn of listeners) fn(query);
    },
  };
}

async function mount(settings = {}, prefersReducedMotion = false) {
  const dom = installDom();
  const media = fakeReducedMotion(prefersReducedMotion);
  const harness = createTestApi({ settings, files: FILES });
  await plugin.start(harness.api);

  /*
   * Disposed, then the DOM torn down -- in that order, and never only the
   * second. The mod watches the URL through `api.helpers.poll`, which is a
   * Node interval and not a jsdom one, so closing the window does not clear
   * it: a test that skipped this passed and then hung the runner for ever
   * with no output at all. Every test here unmounts, including the ones whose
   * subject is something else.
   */
  const unmount = () => {
    for (const dispose of harness.recorded.disposers) dispose();
    dom.cleanup();
  };
  return { dom, media, unmount, ...harness };
}

const html = () => document.documentElement;
const sheet = (recorded) => recorded.css[recorded.css.length - 1] ?? '';

test('has the shape the runtime loads', () => assertPluginShape(assert, plugin));

test('switches every family on, and ships one stylesheet holding all of them', async () => {
  const { recorded, unmount } = await mount();
  try {
    assert.ok(html().classList.contains(ROOT), 'the master class');
    for (const group of GROUPS) {
      assert.ok(html().classList.contains(`${ROOT}-${group}`), `${group} is on by default`);
    }

    // One call, not several: a plugin gets a single <style> node and each call
    // replaces its contents, so a second call would silently drop the first.
    assert.equal(recorded.css.length, 1, 'exactly one stylesheet');
    const css = sheet(recorded);
    for (const group of GROUPS) {
      assert.ok(css.includes(`html.${ROOT}-${group}`), `${group} rules are in it`);
    }
    assert.ok(css.includes('@keyframes betterslack-motion-view'), 'the view animation ships');
    // Switching section in Slack's Preferences remounts the panel's content,
    // measured, so the same family covers it with no trigger.
    assert.ok(
      css.includes('.ReactModal__Content .c-tabs__tab_panel--active > *'),
      'and a dialog changing section is a view change too',
    );
  } finally {
    unmount();
  }
});

test('never animates a menu twice', async () => {
  const { recorded, unmount } = await mount();
  try {
    const css = sheet(recorded);
    /*
     * Slack 4.51 renders a menu as a ReactModal with a popover inside it, so
     * `.ReactModal__Content` and `.c-menu` both match the same open menu --
     * measured by opening one and reading the tree. Without these exclusions
     * the two animations compose and a menu arrives scaled and offset twice.
     */
    assert.ok(
      css.includes('.ReactModal__Content:not(.c-popover__content)'),
      'dialogs exclude popovers',
    );
    assert.ok(
      css.includes('.c-menu:not(.c-popover__content *)'),
      'and a menu inside a popover is left to the popover rule',
    );
    assert.ok(
      css.includes('.ReactModal__Overlay:not(.c-popover)'),
      'a popover backdrop is not a dialog backdrop',
    );
  } finally {
    unmount();
  }
});

test('speed divides the durations and amplitude multiplies the distances', async () => {
  const { recorded, unmount } = await mount({ speed: 200, amplitude: 50 });
  try {
    const css = sheet(recorded);
    // 200% speed is half the duration. The other way round is the mistake that
    // makes a speed control feel broken.
    assert.match(css, /--bsm-scale:\s*0\.5;/, 'twice as quick');
    assert.match(css, /--bsm-amp:\s*0\.5;/, 'half as far');
  } finally {
    unmount();
  }
});

test('a speed of zero cannot divide by zero', async () => {
  const { recorded, unmount } = await mount({ speed: 0, amplitude: -40 });
  try {
    const css = sheet(recorded);
    assert.match(css, /--bsm-scale:\s*4;/, 'clamped to the slowest offered, not Infinity');
    assert.match(css, /--bsm-amp:\s*0;/, 'and never negative, which would move things backwards');
  } finally {
    unmount();
  }
});

test('amplitude 0 keeps the fades and removes the travel', async () => {
  const { recorded, unmount } = await mount({ amplitude: 0 });
  try {
    assert.match(sheet(recorded), /--bsm-amp:\s*0;/);
    assert.ok(html().classList.contains(ROOT), 'still on -- opacity is not travel');
  } finally {
    unmount();
  }
});

test('a family switched off loses its class and nothing else', async () => {
  const { unmount } = await mount({ hover: false });
  try {
    assert.equal(html().classList.contains(`${ROOT}-hover`), false, 'hover is off');
    assert.ok(html().classList.contains(`${ROOT}-panels`), 'the others are untouched');
    assert.ok(html().classList.contains(ROOT), 'and the mod is still running');
  } finally {
    unmount();
  }
});

test('a setting is honoured without a reload', async () => {
  const { recorded, store, unmount } = await mount();
  try {
    store.press = false;
    store.speed = 50;
    for (const listener of recorded.settingsListeners) listener({ ...store });

    assert.equal(html().classList.contains(`${ROOT}-press`), false, 'the class followed');
    assert.match(sheet(recorded), /--bsm-scale:\s*2;/, 'and so did the tempo');
  } finally {
    unmount();
  }
});

test('ignores the system’s reduced-motion setting, on purpose', async () => {
  // Switching this mod on is the statement of intent. Consulting the system
  // setting as well is what made it install, report healthy and visibly do
  // nothing on a machine where Reduce Motion had been on for years -- which is
  // indistinguishable from broken, and was reported as such.
  const { recorded, media, unmount } = await mount({ amplitude: 150 }, true);
  try {
    assert.ok(html().classList.contains(ROOT), 'running');
    assert.match(sheet(recorded), /--bsm-amp:\s*1\.5;/, 'at the amplitude that was asked for');

    media.change(false);
    assert.match(sheet(recorded), /--bsm-amp:\s*1\.5;/, 'and it does not follow the system either way');
  } finally {
    unmount();
  }
});

test('offers no setting for it, because there is nothing to decide', async () => {
  const manifest = JSON.parse(readFileSync(path.join(here, 'mod.json'), 'utf8'));
  const keys = manifest.settings.map((field) => field.key);
  assert.equal(keys.includes('reducedMotion'), false, 'no second switch beside the mod itself');
  assert.deepEqual(keys, ['speed', 'amplitude', 'views', 'panels', 'hover', 'press', 'arrivals']);
});

test('prefers the Navigation API, which fires before Slack repaints', async () => {
  const dom = installDom();
  fakeReducedMotion(false);
  // Measured against 4.51: currententrychange lands 9ms after the click and
  // the column starts repainting at 50ms, where the poll only noticed at
  // 286ms -- after the repaint had finished, which is what made the entrance
  // look like a blink. jsdom has no Navigation API, so it is supplied here.
  const listeners = new Set();
  window.navigation = {
    addEventListener: (_type, fn) => listeners.add(fn),
    removeEventListener: (_type, fn) => listeners.delete(fn),
  };
  const harness = createTestApi({ files: FILES });
  try {
    await plugin.start(harness.api);
    const pane = document.querySelector('.p-view_contents--primary');

    window.history.pushState({}, '', '/client/T0EXAMPLE1/C0OTHERONE');
    for (const fn of listeners) fn();
    assert.ok(
      pane.classList.contains('betterslack-motion-enter'),
      'stamped in the same tick, with no interval to wait for',
    );

    // A thread opening beside the conversation is not the conversation being
    // replaced, and must not dip the whole column.
    pane.classList.remove('betterslack-motion-enter');
    window.history.pushState({}, '', '/client/T0EXAMPLE1/C0OTHERONE/thread/C0OTHERONE-1786386808.130969');
    for (const fn of listeners) fn();
    assert.equal(pane.classList.contains('betterslack-motion-enter'), false, 'threads are left alone');
  } finally {
    for (const dispose of harness.recorded.disposers) dispose();
    assert.equal(listeners.size, 0, 'and the listener goes with the plugin');
    dom.cleanup();
  }
});

test('changing conversation stamps the pane, and the stamp clears itself', async () => {
  const { dom, unmount } = await mount();
  try {
    const pane = document.querySelector('.p-view_contents--primary');
    assert.ok(pane, 'the fixture has the column this animates');
    assert.equal(pane.classList.contains('betterslack-motion-enter'), false);

    window.history.pushState({}, '', '/client/T0EXAMPLE1/C0OTHERONE');
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.ok(pane.classList.contains('betterslack-motion-enter'), 'stamped on the way in');

    pane.dispatchEvent(new dom.dom.window.Event('animationend'));
    assert.equal(
      pane.classList.contains('betterslack-motion-enter'),
      false,
      'and taken off at the end, so nothing wears a class it is not using',
    );
  } finally {
    unmount();
  }
});

test("covers the components mods are given, not only Slack's", async () => {
  const { recorded, unmount } = await mount();
  try {
    const css = sheet(recorded);
    // Every surface `api.ui` and `api.helpers` hand a plugin, so a mod's own
    // interface moves like the app it sits in without its author writing a
    // transition. `.c-dialog` and `.c-menu` are the same rules Slack's own
    // dialogs and menus use, which is the point of borrowing those classes.
    for (const surface of [
      '.c-dialog',                      // api.ui.modal, api.ui.confirm, the panel
      '.c-menu',                        // api.ui.menu
      '.betterslack-palette',           // api.ui.palette
      '.betterslack-tooltip',           // api.ui.tooltip
      '.betterslack-icon-button',       // api.helpers.iconButton
      '[id^="betterslack-badge-"]',     // api.helpers.badge, which has no class
    ]) {
      assert.ok(css.includes(surface), `${surface} is animated`);
    }

    /*
     * The kit is tuned, not restyled. It carries its own motion tokens so a
     * window a mod opens moves even though this stylesheet never reaches that
     * document; all this mod does from inside Slack is hand them its own
     * numbers. Asserting on a copy of the kit's rules here would be asserting
     * on the duplicate that replaced.
     */
    for (const token of ['--sm-motion-quick', '--sm-motion-base', '--sm-motion-shift', '--sm-motion-pop']) {
      assert.match(css, new RegExp(`${token}:\\s*var\\(--bsm-`), `${token} follows the mod's dials`);
    }
    assert.equal(css.includes('.sm-btn'), false, 'and none of the kit is restated here');
  } finally {
    unmount();
  }
});

test('reaches the toasts, which are behind a shadow boundary', async () => {
  const dom = installDom();
  fakeReducedMotion(false);
  // The runtime's own host, as `api.ui.toast` builds it: an open shadow root
  // that a stylesheet in the document cannot style from outside.
  const host = document.createElement('div');
  host.id = 'betterslack-toast-host';
  const shadow = host.attachShadow({ mode: 'open' });
  document.body.append(host);

  const harness = createTestApi({ files: FILES });
  try {
    await plugin.start(harness.api);
    const injected = shadow.querySelector('#betterslack-motion-toasts');
    assert.ok(injected, 'a stylesheet went in');
    /*
     * No `:host-context()`. It reads as the obvious way to let a rule in a
     * shadow root follow a class on <html>, it is what the first version used,
     * and measured in the client it never matches -- Chromium has dropped it,
     * and the whole sheet was silently inert. The group switch rides on a
     * custom property instead, because those do inherit through the boundary.
     */
    assert.doesNotMatch(injected.textContent, /:host-context/, 'not with a selector Chromium dropped');
    assert.match(injected.textContent, /var\(--bsm-toast-duration, 150ms\)/,
      'with a property that only exists while the group is on, falling back to the runtime value');
    assert.match(sheet(harness.recorded), /html\.betterslack-motion-arrivals \{[^}]*--bsm-toast-duration/,
      'and the group class is what defines it');
  } finally {
    for (const dispose of harness.recorded.disposers) dispose();
    assert.equal(shadow.querySelector('#betterslack-motion-toasts'), null, 'and it leaves with the plugin');
    dom.cleanup();
  }
});

test('offers its settings to the palette', async () => {
  const { recorded, unmount } = await mount();
  try {
    const command = recorded.commands.find((entry) => entry.id === 'settings');
    assert.ok(command, 'a command to reach the controls');
    command.run();
    assert.deepEqual(recorded.panels.at(-1), { mod: 'test-mod' }, 'opens its own row');
  } finally {
    unmount();
  }
});

test('switching it off leaves the document exactly as it was found', async () => {
  const { recorded, unmount } = await mount();
  try {
    window.history.pushState({}, '', '/client/T0EXAMPLE1/C0OTHERONE');
    await new Promise((resolve) => setTimeout(resolve, 400));

    for (const dispose of recorded.disposers) dispose();

    assert.equal(html().classList.contains(ROOT), false, 'the master class is gone');
    for (const group of GROUPS) {
      assert.equal(html().classList.contains(`${ROOT}-${group}`), false, `${group} too`);
    }
    assert.equal(
      document.querySelector('.betterslack-motion-enter'),
      null,
      'and no element is left mid-animation',
    );
  } finally {
    unmount();
  }
});
