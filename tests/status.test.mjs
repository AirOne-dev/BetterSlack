// Hovering a status emoji, which is how a row that has room for a picture and
// not for a sentence still says what the picture means.
//
// Slack's own sidebar does this: the emoji alone in the row, and a tooltip with
// the emoji, the sentence and when it runs out. Both mods that show a status
// were drawing the picture and nothing else -- they blanked the text by handing
// `statusNode` an edited copy of the status, which also took the sentence away
// from the tooltip, so the row had a little picture on it and no way at all of
// finding out what it meant.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describeStatus, statusNode } from '../dist/slack-api.mjs';

async function withDom(run) {
  const dom = new JSDOM('<!doctype html><html lang="en"><head></head><body></body></html>');
  const keys = ['document', 'window', 'MutationObserver', 'navigator', 'Node', 'HTMLElement'];
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

/** Slack's tooltip has a ~150ms delay, measured with a real pointer. */
const hover = async (node) => {
  node.dispatchEvent(new window.MouseEvent('mouseenter'));
  await new Promise((resolve) => setTimeout(resolve, 220));
  return document.querySelector('.betterslack-tooltip');
};

const profileWith = (over = {}) => ({
  status_text: 'On holiday',
  status_emoji: ':palm_tree:',
  status_expiration: 0,
  status_emoji_display_info: [{ emoji_name: 'palm_tree', display_url: 'https://example.test/palm.png' }],
  ...over,
});

test('the sentence is in the tooltip even when the row does not draw it', async () => {
  await withDom(async () => {
    const status = describeStatus(profileWith());
    const node = statusNode(status, profileWith(), { showText: false });
    document.body.append(node);

    assert.equal(node.querySelector('.betterslack-status__text'), null, 'no sentence in the row');
    assert.ok(node.querySelector('.betterslack-status__emoji'), 'the picture is there');

    const tip = await hover(node);
    assert.ok(tip, 'hovering opens one');
    assert.match(tip.textContent, /On holiday/, 'and it says what the picture means');
  });
});

test('the emoji is in the tooltip too, which is what Slack shows', async () => {
  await withDom(async () => {
    const node = statusNode(describeStatus(profileWith()), profileWith(), { showText: false });
    document.body.append(node);
    const tip = await hover(node);
    const icon = tip.querySelector('.betterslack-tooltip__icon .betterslack-status__emoji');
    assert.ok(icon, 'the picture is repeated inside');
    // Cloned, not moved: the row keeps its own, and one trigger opens its
    // tooltip many times.
    assert.ok(node.querySelector('.betterslack-status__emoji'), 'and the row still has one');
  });
});

test('a status that runs out says when, in the reader\'s language', async () => {
  await withDom(async () => {
    const at = Date.UTC(2026, 7, 30, 15, 0) / 1000;
    const profile = profileWith({ status_expiration: at });
    const node = statusNode(describeStatus(profile), profile, { showText: false });
    document.body.append(node);

    const tip = await hover(node);
    const subtitle = tip.querySelector('.c-tooltip__subtitle');
    assert.ok(subtitle, 'the expiry is the second line, as Slack writes it');
    assert.match(subtitle.textContent, /Until/);
    // The date itself is Intl's, in whatever zone the reader is in, so the day
    // is what is checked rather than the exact string.
    assert.match(subtitle.textContent, /30 August|August 30/);
  });
});

test('a status with no end has no second line', async () => {
  await withDom(async () => {
    const node = statusNode(describeStatus(profileWith()), profileWith());
    document.body.append(node);
    const tip = await hover(node);
    assert.equal(tip.querySelector('.c-tooltip__subtitle'), null);
  });
});

test('no native title is left behind to show as well', async () => {
  /*
   * This used to be the whole thing: `node.title = ...`. The browser's own
   * tooltip is a second late, one line, unstyled and does not follow the theme
   * -- and shown *alongside* ours it would be two tooltips for one emoji.
   */
  await withDom(async () => {
    const node = statusNode(describeStatus(profileWith()), profileWith());
    assert.equal(node.getAttribute('title'), null);
    assert.match(node.getAttribute('aria-label') ?? '', /On holiday/, 'still readable aloud');
  });
});

test('an emoji nobody could draw still says its name', async () => {
  // Never the raw shortcode in the row -- that reads as a rendering that failed
  // -- but the name has to survive somewhere, and the tooltip is that somewhere.
  await withDom(async () => {
    const profile = { status_text: '', status_emoji: ':no_such_emoji:', status_expiration: 0 };
    const node = statusNode(describeStatus(profile), profile);
    document.body.append(node);
    const tip = await hover(node);
    assert.match(tip.textContent, /no_such_emoji/);
  });
});

test('one tooltip over one emoji, not two', async () => {
  /*
   * The strip in Slack's rail makes the status into a button, so it had two:
   * its own saying what clicking does, and this one saying what the status is.
   * Two popovers over a 15px target. `tooltipOn` puts this one on the button
   * the pointer is actually aiming at, and the action becomes its last line.
   */
  await withDom(async () => {
    const button = document.createElement('button');
    document.body.append(button);
    const node = statusNode(describeStatus(profileWith()), profileWith(), {
      showText: false,
      tooltipOn: button,
      hint: 'Set a status',
    });
    button.append(node);

    assert.equal(await hover(node), null, 'the picture itself no longer opens one');

    const tip = await hover(button);
    assert.ok(tip, 'the button does');
    assert.equal(document.querySelectorAll('.betterslack-tooltip').length, 1);
    assert.match(tip.textContent, /On holiday/, 'what the status is');
    assert.match(tip.textContent, /Set a status/, 'and what clicking it does');
  });
});

test('an emoji with no sentence leads with the action, not with its own name', async () => {
  // `:mc-fire:` above "Set a status" is the wrong way round: the name exists so
  // a picture nobody could draw is still findable, and it says nothing at all
  // to a reader who can see the picture. Measured on a live client.
  await withDom(async () => {
    const profile = profileWith({ status_text: '' });
    const button = document.createElement('button');
    document.body.append(button);
    statusNode(describeStatus(profile), profile, {
      showText: false,
      tooltipOn: button,
      hint: 'Set a status',
    });
    const tip = await hover(button);
    const title = tip.querySelector('.betterslack-tooltip__heading span:last-child');
    assert.equal(title.textContent, 'Set a status');
    assert.equal(tip.querySelectorAll('.c-tooltip__subtitle').length, 0, 'and not repeated below');
  });
});

test('it wraps where Slack wraps', () => {
  /*
   * Read out of the live stylesheet: `--large { max-width: 400px }` is the only
   * rule either modifier has, and `--small` -- which this used to ask for -- is
   * a class Slack does not style at all. A long status ran off the edge of the
   * window in one line where Slack's own tooltip wrapped.
   */
  const source = readFileSync(new URL('../src/runtime/ui/tooltip.ts', import.meta.url), 'utf8');
  assert.match(source, /c-tooltip__tip--large/);
  assert.doesNotMatch(source, /c-tooltip__tip--small/);
});

test('a tooltip that is not showing holds no listeners on window or document', async () => {
  /*
   * The one that got out. `statusNode` attaches a tooltip per row, and a member
   * column redraws on every channel change -- so with the global listeners
   * registered for the life of the trigger, every redraw left twenty more
   * capture-phase `scroll` handlers on `window` that nothing removed. Measured
   * on a live client: four channel changes put 38 of them there, on a page that
   * scrolls constantly -- every one of them running on every scroll, for the
   * life of a row that had long since been replaced.
   *
   * One tooltip is visible at a time, so there is at most one set of these, and
   * none at all while nothing is hovered.
   */
  await withDom(async () => {
    const counts = { scroll: 0, resize: 0, keydown: 0 };
    for (const [target, type] of [[window, 'scroll'], [window, 'resize'], [document, 'keydown']]) {
      const add = target.addEventListener.bind(target);
      const remove = target.removeEventListener.bind(target);
      target.addEventListener = (kind, fn, opts) => {
        if (kind === type) counts[type] += 1;
        return add(kind, fn, opts);
      };
      target.removeEventListener = (kind, fn, opts) => {
        if (kind === type) counts[type] -= 1;
        return remove(kind, fn, opts);
      };
    }

    // Twenty rows' worth, as one redraw of a member column would build.
    const nodes = [];
    for (let i = 0; i < 20; i += 1) {
      const node = statusNode(describeStatus(profileWith()), profileWith(), { showText: false });
      document.body.append(node);
      nodes.push(node);
    }
    assert.deepEqual(counts, { scroll: 0, resize: 0, keydown: 0 }, 'nothing global until one shows');

    const tip = await hover(nodes[0]);
    assert.ok(tip);
    assert.deepEqual(counts, { scroll: 1, resize: 1, keydown: 1 }, 'one set while one is up');

    nodes[0].dispatchEvent(new window.MouseEvent('mouseleave'));
    assert.deepEqual(counts, { scroll: 0, resize: 0, keydown: 0 }, 'and none once it is gone');
  });
});
