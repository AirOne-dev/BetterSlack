// What Demo Mode promises.
//
// The two that matter most are the last two: switching it off has to put the
// real thing back, and it must not put a stale message back over a newer one.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPluginShape, createTestApi, installDom, readModFiles } from '../../../tests/harness.mjs';
import plugin from './index.js';
import { createRedaction } from './redaction.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILES = readModFiles(here);

async function mount() {
  const dom = installDom();
  const harness = createTestApi({ files: FILES });
  await plugin.start(harness.api);
  /** The switch in the top bar, which is the only way in. */
  const press = () => harness.recorded.toolbarButtons.find((b) => b.toolbar === 'topNav').button.onClick();
  const unmount = () => {
    for (const dispose of harness.recorded.disposers) dispose();
    dom.cleanup();
  };
  return { dom, press, unmount, ...harness };
}

const text = () => document.querySelector('[data-qa="message-text"]').textContent;

test('has the shape the runtime loads', () => assertPluginShape(assert, plugin));

test('does nothing at all until the switch is pressed', async () => {
  const { unmount } = await mount();
  try {
    // Installing the mod is not the request; pressing the switch is.
    assert.equal(text(), 'hello world');
    assert.equal(document.getElementById('betterslack-demo-indicator'), null);
    assert.ok(
      document.querySelector('.c-message_kit__avatar img').getAttribute('src').startsWith('https://'),
      'and the real faces are still there',
    );
  } finally {
    unmount();
  }
});

test('puts a switch in the top bar', async () => {
  const { recorded, unmount } = await mount();
  try {
    const button = recorded.toolbarButtons.find((b) => b.toolbar === 'topNav');
    assert.ok(button, 'nothing was added to the top bar');
    // Both states live in one icon, swapped by a class on <html>, so the
    // stylesheet never has to name the id the runtime gives the button.
    assert.match(button.button.icon, /bs-demo-off/);
    assert.match(button.button.icon, /bs-demo-on/);
  } finally {
    unmount();
  }
});

test('replaces what somebody wrote', async () => {
  const { press, unmount } = await mount();
  try {
    press();
    assert.notEqual(text(), 'hello world');
    assert.ok(text().trim().length > 0, 'and puts something there rather than emptying it');
  } finally {
    unmount();
  }
});

test('replaces every face that came off the network', async () => {
  const { press, unmount } = await mount();
  try {
    press();
    for (const img of document.querySelectorAll('img')) {
      assert.ok(
        img.getAttribute('src').startsWith('data:image/svg+xml'),
        `still remote: ${img.getAttribute('src')}`,
      );
    }
  } finally {
    unmount();
  }
});

test('says it is on', async () => {
  const { press, unmount } = await mount();
  try {
    press();
    // The one thing that stops a demo becoming a leak is knowing you are in
    // one, so this is a promise like any other.
    assert.ok(document.getElementById('betterslack-demo-indicator'));
  } finally {
    unmount();
  }
});

test('switching it off puts the real thing back', async () => {
  const dom = installDom();
  const harness = createTestApi({ files: FILES });
  try {
    await plugin.start(harness.api);
    harness.recorded.toolbarButtons.find((b) => b.toolbar === 'topNav').button.onClick();
    assert.notEqual(text(), 'hello world');
    const avatar = document.querySelector('.c-message_kit__avatar img');
    assert.ok(avatar.getAttribute('src').startsWith('data:'));

    // Disposing is what switching a mod off does.
    for (const dispose of harness.recorded.disposers) dispose();

    assert.equal(text(), 'hello world');
    assert.ok(
      avatar.getAttribute('src').startsWith('https://ca.slack-edge.com/'),
      'the real face came back too',
    );
    assert.equal(document.getElementById('betterslack-demo-indicator'), null);
  } finally {
    dom.cleanup();
  }
});

test('the same person is the same invented person twice over', () => {
  const dom = installDom();
  try {
    const redaction = createRedaction({ document });
    redaction.sweep({ first: true });
    const sender = document.querySelector('[data-qa="message-text"]').textContent;
    redaction.restore();
    redaction.sweep({ first: true });
    assert.equal(document.querySelector('[data-qa="message-text"]').textContent, sender);
  } finally {
    dom.cleanup();
  }
});

test('leaves BetterSlack\'s own interface alone', () => {
  const dom = installDom();
  try {
    const panel = document.createElement('div');
    panel.id = 'betterslack-panel';
    panel.textContent = 'Installed mods';
    document.body.append(panel);

    const redaction = createRedaction({ document });
    redaction.sweep({ first: true });
    // Its own words are neither something to replace nor something that
    // "survived": a run once failed on the word "machine", out of the sentence
    // "kept on this machine only".
    assert.equal(panel.textContent, 'Installed mods');
  } finally {
    dom.cleanup();
  }
});

/*
 * The palette shows Slack and BetterSlack in one list, through one class.
 *
 * The badge on the right is what tells them apart, and getting it wrong fails
 * in both directions: a conversation left alone is somebody's name in a public
 * screenshot, and an action swept is a row of nonsense in the catalogue.
 */
test('sweeps what the palette got from Slack and spares what it wrote itself', () => {
  const dom = installDom();
  try {
    const row = (source, title, sub) => {
      const node = document.createElement('div');
      node.className = 'betterslack-palette__row';
      node.innerHTML = '<span class="betterslack-palette__text">'
        + `<span class="betterslack-palette__title">${title}</span>`
        + (sub ? `<span class="betterslack-palette__sub">${sub}</span>` : '')
        + `</span><span class="betterslack-palette__source">${source}</span>`;
      document.body.append(node);
      return node;
    };
    const channel = row('Channel', 'alertes-payments');
    // A group DM's title is a list of real people, and its badge says neither
    // "channel" nor "direct message".
    const group = row('Group', 'Robin Vasquez, Sam Okonkwo');
    const message = row('Message', 'shipping this afternoon', 'robin · #releases');
    // The palette's own doing-something rows: its words, over a real name.
    const action = row('Slack', 'Copy a link to this conversation', 'alertes-payments');

    const redaction = createRedaction({ document });
    redaction.sweep({ first: true });

    for (const [what, node] of [['channel', channel], ['group', group], ['message', message]]) {
      assert.notEqual(node.querySelector('.betterslack-palette__title').textContent,
        what === 'channel' ? 'alertes-payments'
          : (what === 'group' ? 'Robin Vasquez, Sam Okonkwo' : 'shipping this afternoon'),
        `the ${what} row still says what Slack said`);
    }
    assert.equal(action.querySelector('.betterslack-palette__title').textContent,
      'Copy a link to this conversation', 'the mod\'s own words survive');
    assert.notEqual(action.querySelector('.betterslack-palette__sub').textContent,
      'alertes-payments', 'but the conversation named under them does not');
  } finally {
    dom.cleanup();
  }
});

/*
 * "It is only digits" is not the same as "it is nobody's".
 *
 * Found by the audit on a real workspace: two six-digit order references sat
 * alone in message bubbles and survived every sweep. A badge count and a year
 * genuinely belong to nobody; an order number is a customer's.
 */
test('keeps counts and years, and replaces a number long enough to identify something', () => {
  const dom = installDom();
  try {
    const say = (text) => {
      const node = document.createElement('div');
      node.className = 'p-rich_text_block';
      node.textContent = text;
      document.body.append(node);
      return node;
    };
    const count = say('12');
    const year = say('2026');
    const order = say('786934');

    createRedaction({ document }).sweep({ first: true });

    assert.equal(count.textContent, '12');
    assert.equal(year.textContent, '2026');
    assert.notEqual(order.textContent, '786934');
    // Digit for digit, so the bubble keeps the width it had.
    assert.match(order.textContent, /^\d{6}$/);
  } finally {
    dom.cleanup();
  }
});

test('will not put a stale message back over a newer one', () => {
  const dom = installDom();
  try {
    const redaction = createRedaction({ document });
    redaction.sweep({ first: true });

    // Slack re-renders that message with something newer while the demo runs.
    const body = document.querySelector('[data-qa="message-text"]');
    body.firstChild.nodeValue = 'a message that arrived since';

    redaction.restore();
    assert.equal(
      body.textContent,
      'a message that arrived since',
      'restoring wrote an older value over a newer one',
    );
  } finally {
    dom.cleanup();
  }
});

test('sweeps the draft once, then leaves you typing', () => {
  const dom = installDom();
  try {
    const editor = document.querySelector('.ql-editor');
    editor.textContent = 'the thing I had half written to Marie';

    const redaction = createRedaction({ document });
    redaction.sweep({ first: true });
    assert.notEqual(editor.textContent, 'the thing I had half written to Marie');

    // What you type during a demo is your own words on your own screen, and
    // rewriting them keystroke by keystroke makes the client unusable.
    editor.textContent = 'typing this now';
    redaction.sweep();
    assert.equal(editor.textContent, 'typing this now');
  } finally {
    dom.cleanup();
  }
});

test('reports what is still real rather than claiming success', () => {
  const dom = installDom();
  try {
    const redaction = createRedaction({ document });
    redaction.sweep({ first: true });
    assert.deepEqual(redaction.remaining(), []);

    // Something Slack drew after the sweep, which is the case the strip in the
    // corner cannot help with.
    const late = document.createElement('img');
    late.src = 'https://ca.slack-edge.com/T0EXAMPLE1-U9-real-48';
    document.querySelector('[data-qa="message_container"]').append(late);

    const left = redaction.remaining();
    assert.equal(left.length, 1);
    assert.equal(left[0].what, 'image');
    assert.ok(left[0].where.includes('div'), 'and says where it is');
  } finally {
    dom.cleanup();
  }
});

test('registers the commands it offers', async () => {
  const { recorded, unmount } = await mount();
  try {
    const ids = recorded.commands.map((command) => command.id);
    for (const id of ['toggle', 'check', 'sweep']) assert.ok(ids.includes(id), id);
  } finally {
    unmount();
  }
});

test('pressing it twice puts the real thing back', async () => {
  const { press, unmount } = await mount();
  try {
    press();
    assert.notEqual(text(), 'hello world');
    press();
    assert.equal(text(), 'hello world');
    assert.equal(document.getElementById('betterslack-demo-indicator'), null);
  } finally {
    unmount();
  }
});

test('does not check a screen it has not redacted', async () => {
  const { recorded, unmount } = await mount();
  try {
    // Off, every face on screen is real and "nothing real is left" would be a
    // lie told with a green tick.
    recorded.commands.find((command) => command.id === 'check').run();
    assert.match(recorded.toasts.at(-1).message, /real/i);
    assert.equal(recorded.toasts.at(-1).variant, 'warning');
  } finally {
    unmount();
  }
});

test('offers a camera only while the demo is running', async () => {
  const { recorded, unmount } = await mount();
  try {
    const camera = recorded.toolbarButtons.find((b) => b.button.id === 'shot');
    assert.ok(camera, 'no camera was added');
    assert.equal(camera.toolbar, 'topNav', 'and it sits beside the switch');
    // Which of the two is on screen is CSS, keyed on a class on <html> — the
    // button is registered once and never re-registered.
    assert.match(recorded.css.join('\n'), /betterslack-demo-on.*bs-demo-shot|bs-demo-shot/s);
  } finally {
    unmount();
  }
});

test('photographs at the published size, into the downloads folder', async () => {
  const { press, recorded, unmount } = await mount();
  try {
    press();
    await recorded.toolbarButtons.find((b) => b.button.id === 'shot').button.onClick();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const [shot] = recorded.screenshots;
    assert.ok(shot, 'nothing was photographed');
    assert.equal(shot.size, '1600x1000', 'the size every mod picture in the catalogue uses');
    assert.match(shot.filename, /^slack-[\d-]+\.webp$/);
  } finally {
    unmount();
  }
});

test('takes its own buttons out of the picture, and puts them back', async () => {
  const { press, recorded, unmount } = await mount();
  try {
    press();
    await recorded.toolbarButtons.find((b) => b.button.id === 'shot').button.onClick();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // The shutter is on the loader's side and photographs whatever is on
    // screen, so this is the only moment the hiding can be checked.
    assert.match(recorded.screenshots[0].htmlClass, /betterslack-demo-shooting/);
    assert.doesNotMatch(document.documentElement.className, /betterslack-demo-shooting/);
  } finally {
    unmount();
  }
});

test('a failed capture still gives the buttons back', async () => {
  const { press, recorded, unmount } = await mount();
  try {
    press();
    recorded.screenshotShouldFail = 'the renderer said no';
    await recorded.toolbarButtons.find((b) => b.button.id === 'shot').button.onClick();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Otherwise the client is left with no toolbar buttons and no way to press
    // anything, which is worse than the failure.
    assert.doesNotMatch(document.documentElement.className, /betterslack-demo-shooting/);
    assert.match(recorded.toasts.at(-1).message, /the renderer said no/);
  } finally {
    unmount();
  }
});

test('will not photograph a screen it has not redacted', async () => {
  const { recorded, unmount } = await mount();
  try {
    recorded.commands.find((command) => command.id === 'shoot').run();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(recorded.screenshots.length, 0);
    assert.match(recorded.toasts.at(-1).message, /real/i);
  } finally {
    unmount();
  }
});
