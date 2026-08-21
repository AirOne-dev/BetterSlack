// The badge that says something is out of date.
//
// Two things can be: BetterSlack itself, and any installed mod. They update by
// different routes -- one pulls the whole project, the other replaces a folder
// -- but to somebody looking at Slack's rail they are one question, so they are
// one number on one button.
//
// The rule this is here to hold: the count is not state the panel owns. It used
// to be, and the consequence was quiet -- mod updates were looked for exactly
// once, the first time the panel was opened, so the badge could never count
// them and nobody who did not open the panel ever learnt a mod had moved on.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { installLauncher } from '../dist/ui/launcher.mjs';
import { StyleManager } from '../dist/themes.mjs';
import { findModUpdates } from '../dist/mod-updates.mjs';
import { SLACK_FIXTURE } from './slack-fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

async function withDom(run) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${SLACK_FIXTURE}</body></html>`);
  const keys = ['document', 'window', 'MutationObserver', 'navigator', 'requestAnimationFrame'];
  const previous = keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]);
  for (const key of keys) {
    Object.defineProperty(globalThis, key, {
      value: dom.window[key] ?? dom.window, configurable: true, writable: true,
    });
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

const badgeOf = () =>
  document.querySelector('#betterslack-control-button .betterslack-launcher__badge')?.textContent
  ?? null;

test('the launcher shows how many things are out of date, and nothing when none are', async () => {
  await withDom(async () => {
    let count = 0;
    let repaint = () => {};
    const stop = installLauncher({
      onActivate: () => {},
      styles: new StyleManager(),
      badge: () => count,
      onBadgeChange: (fn) => { repaint = fn; },
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(badgeOf(), null, 'nothing to say, nothing drawn');

      // The answers arrive after boot, which is why the button is repainted
      // rather than rebuilt: remounting it would take it out from under a
      // pointer that is already on it.
      count = 3;
      repaint();
      assert.equal(badgeOf(), '3', 'one BetterSlack and two mods is three, not "an update"');

      count = 0;
      repaint();
      assert.equal(badgeOf(), null, 'and updating them takes the badge away again');
    } finally {
      stop();
    }
  });
});

test('an update carries the shelf it belongs to, so a tab can be badged', async () => {
  const registry = {
    mods: [
      { id: 'midnight', type: 'theme', version: '2.0.0' },
      { id: 'motion', type: 'plugin', version: '1.0.0' },
    ],
  };
  const previous = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => registry });
  try {
    const updates = await findModUpdates(
      [
        { id: 'midnight', name: 'Midnight', type: 'theme', version: '1.0.0' },
        { id: 'motion', name: 'Motion', type: 'plugin', version: '1.0.0' },
      ],
      { repo: 'x/y', branch: 'master' },
      '9.9.9',
    );
    assert.deepEqual(
      updates.map((u) => [u.id, u.type, u.from, u.to]),
      [['midnight', 'theme', '1.0.0', '2.0.0']],
      'only the one that moved, and it says which shelf it is on',
    );
  } finally {
    globalThis.fetch = previous;
  }
});

test('an unreachable registry is not the same answer as nothing to update', async () => {
  /*
   * They were the same value, and it only started mattering once this fed a
   * badge: one hourly sweep taken while offline would have cleared the dot off
   * a mod that is still out of date, and put it back an hour later. The caller
   * keeps what it knows, which it can only do if it can tell the two apart.
   */
  const previous = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline'); };
  try {
    const answer = await findModUpdates(
      [{ id: 'motion', name: 'Motion', type: 'plugin', version: '1.0.0' }],
      { repo: 'x/y', branch: 'master' },
      '9.9.9',
    );
    assert.equal(answer, null, 'null, not an empty list');
  } finally {
    globalThis.fetch = previous;
  }

  const loader = read('src/loader/index.ts');
  assert.match(loader, /if \(updates === null\) return;/, 'and the sweep leaves the badge alone');
});

test('the count is the manager\'s, not the panel\'s', () => {
  const panel = read('src/runtime/ui/panel.ts');
  assert.doesNotMatch(
    panel,
    /private modUpdates/,
    'the panel must not keep its own list: the badge is painted while it is shut',
  );
  assert.match(panel, /this\.manager\.modUpdates/, 'it reads the manager instead');

  const index = read('src/runtime/index.ts');
  const badge = index.match(/badge: \(\) => [^\n]*/)?.[0] ?? '';
  assert.match(badge, /manager\.update\?\.behind/, 'BetterSlack itself counts');
  assert.match(badge, /manager\.modUpdates\.length/, 'and so does every mod');
});

test('the loader looks again while Slack is left running', () => {
  const loader = read('src/loader/index.ts');
  // A one-shot at boot is a badge that is right for a minute and wrong for the
  // days somebody leaves their messaging app open.
  assert.match(loader, /const UPDATE_SWEEP_MS = 60 \* 60 \* 1000;/, 'an hour, written as one');
  assert.match(
    loader,
    /setInterval\(\(\) => void this\.sweepForUpdates\(\), UPDATE_SWEEP_MS\)\.unref\?\.\(\)/,
    'scheduled, and never what keeps the process alive',
  );
  assert.match(loader, /this\.broadcast\(\{ type: 'mods\.updates', updates \}\)/, 'and pushed');
});
