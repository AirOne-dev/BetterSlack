// What Full Links promises.
//
// The shape of the DOM here is not invented: it is the anchor Slack really
// builds, copied from a measurement of a real shortened link.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPluginShape, createTestApi, installDom, readModFiles } from '../../../tests/harness.mjs';
import plugin, { fullUrl, labelNode } from './index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILES = readModFiles(here);

const LONG = 'http://imgr.prelinker.com/t/?c=31cd2a73-3318-4366-ae2b-512ef0a5eb8d';

/** Slack's own markup for a shortened link, verbatim. */
function addTruncated(url = LONG, label = 'imgr.prelinker.com/t?c=…') {
  const wrapper = document.createElement('span');
  wrapper.className = 'c-mrkdwn__draggable-link';
  wrapper.draggable = true;
  const a = document.createElement('a');
  a.className = 'c-link c-link--underline';
  a.setAttribute('target', '_blank');
  a.setAttribute('rel', 'noopener noreferrer');
  a.setAttribute('data-stringify-link', url);
  a.setAttribute('data-truncated-link', 'true');
  a.setAttribute('href', url);
  a.textContent = label;
  wrapper.append(a);
  document.querySelector('[data-qa="message-text"]').append(wrapper);
  return a;
}

/** A link somebody gave a label to. Slack does not mark these. */
function addLabelled() {
  const a = document.createElement('a');
  a.className = 'c-link';
  a.setAttribute('href', 'https://example.com/a/very/long/path?with=query');
  a.textContent = 'read this';
  document.querySelector('[data-qa="message-text"]').append(a);
  return a;
}

async function mount() {
  const dom = installDom();
  const harness = createTestApi({ files: FILES });
  await plugin.start(harness.api);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const unmount = () => {
    for (const dispose of harness.recorded.disposers) dispose();
    dom.cleanup();
  };
  return { dom, unmount, ...harness };
}

test('has the shape the runtime loads', () => assertPluginShape(assert, plugin));

test('puts the whole address back', async () => {
  const { unmount } = await mount();
  try {
    const anchor = addTruncated();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(anchor.textContent, LONG);
    assert.equal(anchor.getAttribute('href'), LONG, 'and the link still goes where it did');
  } finally {
    unmount();
  }
});

test('leaves a link somebody labelled alone', async () => {
  const { unmount } = await mount();
  try {
    // The reason this mod reads `data-truncated-link` instead of guessing from
    // ellipses: `<https://example.com|read this>` is a deliberate label, and
    // replacing it with a URL would be vandalism.
    const anchor = addLabelled();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(anchor.textContent, 'read this');
  } finally {
    unmount();
  }
});

test('prefers the address Slack itself would copy', () => {
  const dom = installDom();
  try {
    const anchor = addTruncated();
    anchor.setAttribute('href', 'http://redirect.example/shim');
    // `data-stringify-link` is what lands on the clipboard when the message is
    // copied, so it is the one to trust when the two disagree.
    assert.equal(fullUrl(anchor), LONG);
  } finally {
    dom.cleanup();
  }
});

test('finds the label however it is wrapped', () => {
  const dom = installDom();
  try {
    const anchor = addTruncated();
    const span = document.createElement('span');
    span.textContent = 'imgr.prelinker.com/t?c=…';
    anchor.textContent = '';
    anchor.append(span);
    assert.equal(labelNode(anchor)?.nodeValue, 'imgr.prelinker.com/t?c=…');
  } finally {
    dom.cleanup();
  }
});

test('changes no node but the text it was already given', async () => {
  const { unmount } = await mount();
  try {
    const anchor = addTruncated();
    const before = anchor.firstChild;
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Nothing added, nothing removed: the same text node, a different string.
    // Adding or removing children of a node React manages is what earns a
    // "removeChild on a node that is not a child" at its next re-render.
    assert.equal(anchor.firstChild, before, 'the same node');
    assert.equal(anchor.childNodes.length, 1);
    assert.equal(before.nodeValue, LONG);
  } finally {
    unmount();
  }
});

test('pasting a bare URL never becomes a shortened label', async () => {
  const { unmount } = await mount();
  try {
    /*
     * The half that matters to everyone else. Measured from the API: the short
     * label is *stored* in the message -- `{ type: 'link', text: 'host/t?c=…',
     * truncated: true }` -- so the recipient sees it too, and the only place to
     * stop it is where it is made. Slack replaces a pasted URL with a
     * <ts-slug data-label="…"> in the composer; preventing the paste and
     * inserting the address as plain text means no slug is ever built.
     */
    const editor = document.querySelector('.ql-editor');
    let inserted = null;
    document.execCommand = (command, _ui, value) => {
      if (command === 'insertText') inserted = value;
      return true;
    };

    const event = new window.Event('paste', { bubbles: true, cancelable: true });
    event.clipboardData = { getData: () => `  ${LONG}  ` };
    editor.dispatchEvent(event);

    assert.equal(inserted, LONG, 'the address goes in as plain text, trimmed');
    assert.equal(event.defaultPrevented, true, 'and Slack never sees the paste');
  } finally {
    unmount();
  }
});

test('leaves every other paste alone', async () => {
  const { unmount } = await mount();
  try {
    const editor = document.querySelector('.ql-editor');
    let called = 0;
    document.execCommand = () => { called += 1; return true; };

    for (const clipboard of [
      'just some words',
      'look at http://example.com/x for this',   // a URL inside a sentence
      'http://a.com/x http://b.com/y',           // two of them
      '',
    ]) {
      const event = new window.Event('paste', { bubbles: true, cancelable: true });
      event.clipboardData = { getData: () => clipboard };
      editor.dispatchEvent(event);
      assert.equal(event.defaultPrevented, false, JSON.stringify(clipboard));
    }
    assert.equal(called, 0, 'nothing was inserted by us');
  } finally {
    unmount();
  }
});

test('does not touch a paste outside the composer', async () => {
  const { unmount } = await mount();
  try {
    let called = 0;
    document.execCommand = () => { called += 1; return true; };
    const event = new window.Event('paste', { bubbles: true, cancelable: true });
    event.clipboardData = { getData: () => LONG };
    document.querySelector('.p-channel_sidebar').dispatchEvent(event);
    assert.equal(event.defaultPrevented, false, 'the search box is not ours to change');
    assert.equal(called, 0);
  } finally {
    unmount();
  }
});

test('puts it back if Slack shortens it again', async () => {
  const { recorded, unmount } = await mount();
  try {
    const anchor = addTruncated();
    await new Promise((resolve) => setTimeout(resolve, 10));
    // A re-render that restores the short label: the node never left, so an
    // arrival observer cannot see it. The sweep can.
    anchor.textContent = 'imgr.prelinker.com/t?c=…';
    const sweep = recorded.commands.find((command) => command.id === 'restore');
    sweep.run();
    assert.equal(anchor.textContent, LONG);
    assert.ok(recorded.toasts.at(-1).message.includes('1'), 'and says how many it put back');
  } finally {
    unmount();
  }
});
