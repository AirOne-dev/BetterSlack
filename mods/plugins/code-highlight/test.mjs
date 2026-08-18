// What Code Highlight promises.
//
// Three things, and the third is the one that matters: it must not remove a
// node it did not create. A message belongs to React, and taking its children
// away earns a "removeChild on a node that is not a child" the next time that
// message updates -- in a virtualised list, soon.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPluginShape, createTestApi, installDom, readModFiles } from '../../../tests/harness.mjs';
import plugin from './index.js';
import { detect } from './detect.js';
import { highlight, escapeHtml, LANGUAGES } from './tokenise.js';
import { readFileSync } from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILES = readModFiles(here);

/** A code block as Slack builds one: a <pre> wrapping a div of its own. */
function addBlock(code) {
  const pre = document.createElement('pre');
  pre.className = 'c-mrkdwn__pre';
  const inner = document.createElement('div');
  inner.className = 'p-rich_text_block--no-overflow';
  inner.textContent = code;
  pre.append(inner);
  document.querySelector('.p-message_pane').append(pre);
  return { pre, inner };
}

async function mount(settings = {}) {
  const dom = installDom();
  const harness = createTestApi({ settings, files: FILES });
  await plugin.start(harness.api);
  const unmount = () => {
    for (const dispose of harness.recorded.disposers) dispose();
    dom.cleanup();
  };
  return { dom, unmount, ...harness };
}

test('has the shape the runtime loads', () => assertPluginShape(assert, plugin));

test('recognises the languages people paste, and refuses prose', () => {
  const cases = [
    ['const a = 1;\nconsole.log(a)', 'javascript'],
    ['interface A { x: string }\nconst b: number = 2', 'typescript'],
    ['def go(x):\n    return None', 'python'],
    ['{"a": 1, "b": [2, 3]}', 'json'],
    ['SELECT id, name FROM users WHERE id = 3', 'sql'],
    ['#!/bin/bash\nsudo apt-get update', 'bash'],
    ['package main\nfunc main() { }', 'go'],
    ['fn main() { println!("hi"); }', 'rust'],
    ['.a { color: red; }', 'css'],
    ['<div class="x">hi</div>', 'html'],
    ['name: build\non:\n  push:\n    branches: [main]', 'yaml'],
    ['@@ -1,4 +1,6 @@\n-old\n+new', 'diff'],
    ['public class A { public static void main(String[] a) { System.out.println(1); } }', 'java'],
    // Added after the first report: GraphQL was going grey, and it was not the
    // only one missing.
    ['query GetUser($id: ID!) {\n  user(id: $id) { name email }\n}', 'graphql'],
    ['type User {\n  id: ID!\n  name: String\n}', 'graphql'],
    ['FROM node:20\nRUN npm ci\nCOPY . .', 'dockerfile'],
    ['[package]\nname = "x"\nversion = "1.0"', 'toml'],
    ['def hello\n  puts "hi"\nend', 'ruby'],
    ['fun main() {\n  val x = 1\n}', 'kotlin'],
    ['func greet() {\n  print("hi")\n}', 'swift'],
    ['#include <stdio.h>\nint main() { printf("hi"); }', 'c'],
  ];
  for (const [code, language] of cases) {
    assert.equal(detect(code), language, JSON.stringify(code.slice(0, 30)));
  }

  /*
   * Null is a real answer and the mod honours it. A stack trace, a table of
   * numbers or a paragraph is not code, and painting keywords through it reads
   * as a bug rather than as a limitation.
   */
  for (const notCode of [
    'Bonjour, ceci est une phrase parfaitement ordinaire.',
    'Nobody here is writing code, this is just a sentence.',
    'ok',
  ]) {
    assert.equal(detect(notCode), null, JSON.stringify(notCode.slice(0, 30)));
  }
});

test('every language it claims can also be coloured', () => {
  // A language in the detector with no entry in the lexer is a block that
  // announces itself and then stays grey -- which is exactly how the GraphQL
  // gap was reported.
  const detected = readFileSync(path.join(here, 'detect.js'), 'utf8')
    .match(/^  \['([\w]+)', \[/gm)
    .map((line) => line.match(/'([\w]+)'/)[1]);
  for (const language of detected) {
    assert.ok(LANGUAGES[language], `${language} is detected but has no lexer`);
  }
  assert.ok(detected.length >= 20, `${detected.length} languages`);
});

test('a JSON key is a key, not a string', () => {
  // The quotes make both look the same to a lexer, so the key pattern has to
  // run before the string one -- which is why `spec` has an `early` list at
  // all. Reported the moment the first screenshot came back.
  const out = highlight('{"name": "betterslack"}', 'json');
  assert.ok(out.includes('bshl-property'), 'the key is a key');
  assert.ok(out.includes('bshl-string'), 'and the value is a string');
});

test('escapes what it colours', () => {
  // The output goes in through innerHTML, so this is the whole security story.
  const nasty = '<img src=x onerror="alert(1)"> & \'quotes\'';
  const out = highlight(nasty, 'javascript');
  assert.equal(out.includes('<img'), false, 'no tag survives');
  assert.equal(out.includes('onerror='), false);
  // Escaped rather than dropped -- and the `<` lands in its own span, because
  // to a JavaScript lexer it is an operator.
  assert.ok(out.includes('&lt;'), 'it is escaped, not dropped');
  assert.ok(out.includes('img'), 'and the text itself survives');
  assert.equal(escapeHtml('<&>"'), '&lt;&amp;&gt;&quot;');
});

test('colours a block and says which language it decided on', async () => {
  const { unmount } = await mount();
  try {
    const { pre } = addBlock('def hello(name):\n    return None');
    // `each` scans what is already there when it is registered, and this block
    // was added before the plugin started in a real client too.
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(pre.getAttribute('data-betterslack-lang'), 'python');
    const painted = pre.querySelector('.betterslack-hl');
    assert.ok(painted, 'a highlighted copy was added');
    assert.ok(painted.innerHTML.includes('bshl-keyword'), 'with keywords marked');
    assert.equal(painted.textContent, 'def hello(name):\n    return None', 'and the code intact');
  } finally {
    unmount();
  }
});

test('never removes a node it did not create', async () => {
  const { unmount } = await mount();
  try {
    const { pre, inner } = addBlock('SELECT id FROM users WHERE id = 3');
    await new Promise((resolve) => setTimeout(resolve, 10));

    /*
     * The original child is still there, and still React's. It is hidden by the
     * stylesheet instead -- `pre[data-betterslack-lang] > *:not(.betterslack-hl)`
     * -- which costs a line and cannot throw.
     */
    assert.equal(inner.isConnected, true, 'Slack’s own node is untouched');
    assert.equal(inner.parentElement, pre);
    assert.equal(pre.children.length, 2, 'one appended, none taken away');
  } finally {
    unmount();
  }
});

test('leaves a block it cannot place entirely alone', async () => {
  const { unmount } = await mount();
  try {
    const { pre } = addBlock('Une phrase française tout à fait ordinaire, sans code.');
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(pre.hasAttribute('data-betterslack-lang'), false);
    assert.equal(pre.querySelector('.betterslack-hl'), null, 'nothing added');
  } finally {
    unmount();
  }
});

test('switching it off puts every block back', async () => {
  const { recorded, unmount } = await mount();
  try {
    const { pre, inner } = addBlock('const a = 1;\nconsole.log(a)');
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(pre.querySelector('.betterslack-hl'));

    for (const dispose of recorded.disposers) dispose();

    assert.equal(pre.querySelector('.betterslack-hl'), null, 'ours is gone');
    assert.equal(pre.hasAttribute('data-betterslack-lang'), false, 'and so is the mark');
    assert.equal(inner.isConnected, true, 'Slack’s is still there, as it always was');
  } finally {
    unmount();
  }
});

test('one bad block does not stop the rest', async () => {
  const { recorded, unmount } = await mount();
  try {
    const { pre } = addBlock('{"a": 1, "b": [2, 3]}');
    // A block whose text cannot be read at all, which is what a torn-down node
    // looks like from inside an observer.
    Object.defineProperty(pre, 'textContent', { get() { throw new Error('gone'); } });
    const second = addBlock('def f():\n    return None');
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.ok(second.pre.querySelector('.betterslack-hl'), 'the next one was still coloured');
    assert.ok(recorded.logs.some(([level]) => level === 'warn'), 'and the failure was reported');
  } finally {
    unmount();
  }
});
