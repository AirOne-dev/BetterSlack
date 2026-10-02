// Asking for the permission Slack's Dock tile needs.
//
// It is a dialog at startup in somebody's messaging app, so what is tested is
// mostly when it does *not* appear: never twice, never when the icon took,
// never on a platform with no Dock -- and, when it does, that each answer
// leads where it says.

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { offerDockIcon } from '../dist/ui/dock-icon.mjs';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withDom(run) {
  const dom = new JSDOM('<!doctype html><html lang="en"><head></head><body></body></html>', { pretendToBeVisual: true });
  const keys = ['document', 'window', 'MutationObserver', 'navigator', 'HTMLElement', 'Node', 'getComputedStyle', 'requestAnimationFrame'];
  const previous = keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]);
  for (const key of keys) {
    const value = key === 'getComputedStyle' || key === 'requestAnimationFrame'
      ? (dom.window[key]?.bind(dom.window) ?? ((fn) => setTimeout(fn, 0)))
      : (dom.window[key] ?? dom.window);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  try {
    return await run(dom);
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    dom.window.close();
  }
}

/** A manager with only what the offer touches, recording every call. */
function fakeManager({ asked = false, states = ['refused'] } = {}) {
  const calls = [];
  let settings = { dockIconAsked: asked };
  return {
    calls,
    getSettings: () => settings,
    patchSettings: async (patch) => { calls.push(['patch', patch]); settings = { ...settings, ...patch }; },
    dockIcon: async (action = 'status') => {
      calls.push(['dockIcon', action]);
      if (action === 'settings') return 'unsupported';
      return states.length > 1 ? states.shift() : states[0];
    },
    restartSlack: async () => { calls.push(['restart']); },
  };
}

const button = (label) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === label);

test('asked once: a second start says nothing and does not even ask the loader', async () => {
  await withDom(async () => {
    const manager = fakeManager({ asked: true });
    await offerDockIcon(manager);
    assert.deepEqual(manager.calls, []);
    assert.equal(document.querySelector('button'), null);
  });
});

test('an icon that took, or a platform with no Dock, is not a question', async () => {
  for (const state of ['ok', 'unsupported']) {
    await withDom(async () => {
      const manager = fakeManager({ states: [state] });
      await offerDockIcon(manager);
      assert.deepEqual(manager.calls, [['dockIcon', 'status']]);
      assert.equal(document.querySelector('button'), null);
    });
  }
});

test('refused: recorded as asked before the dialog, and Later goes nowhere', async () => {
  await withDom(async () => {
    const manager = fakeManager();
    const offer = offerDockIcon(manager);
    await wait(20);
    assert.deepEqual(manager.calls[1], ['patch', { dockIconAsked: true }]);
    button('Later').click();
    await offer;
    assert.ok(!manager.calls.some(([, action]) => action === 'settings'), 'System Settings stays shut');
  });
});

test('the whole way: the pane, a retry, then the restart that shows the tile', async () => {
  await withDom(async () => {
    const manager = fakeManager({ states: ['refused', 'ok'] });
    const offer = offerDockIcon(manager);
    await wait(20);
    button('Open System Settings').click();
    await wait(20);
    button('Restart Slack').click();
    await offer;
    assert.deepEqual(manager.calls.filter(([kind]) => kind !== 'patch'), [
      ['dockIcon', 'status'], ['dockIcon', 'settings'], ['dockIcon', 'retry'], ['restart'],
    ]);
  });
});

test('still refused after the pane: no restart for nothing', async () => {
  await withDom(async () => {
    const manager = fakeManager({ states: ['refused'] });
    const offer = offerDockIcon(manager);
    await wait(20);
    button('Open System Settings').click();
    await wait(20);
    button('Restart Slack').click();
    await offer;
    assert.ok(!manager.calls.some(([kind]) => kind === 'restart'));
  });
});
