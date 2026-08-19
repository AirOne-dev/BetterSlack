/**
 * The documentation format, and the one thing that reads it.
 *
 * Every entry in the plugin API is one file in `docs/api/`, and that file is
 * the source: the page is built from it rather than from a second list kept
 * somewhere else. A block of keys at the top, then prose, then a fenced
 * example.
 *
 *     ---
 *     name: button
 *     group: kit
 *     title: Component kit
 *     signature: (label: string, options?: ButtonOptions): HTMLButtonElement
 *     preview: kit-button
 *     control: label | text | Save
 *     control: variant | select | primary | | default, primary, ghost, danger
 *     ---
 *
 *     Slack's button, in its four weights.
 *
 *     ```js
 *     kit.button('Save', { variant: 'primary' });
 *     ```
 *
 * `preview` names a renderer in `scripts/api-previews.js` -- a preview is code
 * and cannot be anything else -- and each `control` line becomes a knob beside
 * it, as `key | type | value | label | options`. `label` and `options` are
 * optional; `options` is a comma-separated list and only means anything for a
 * select.
 *
 * Deliberately not YAML: five keys and a repeated line do not need a parser
 * with a specification, and a dependency that can only be wrong about
 * indentation is a poor trade for a file a person writes by hand.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const CONTROL_FIELDS = ['key', 'type', 'value', 'label', 'options'];

/** One file. Throws rather than guessing: a malformed entry is a build error. */
export function parseEntry(file, source) {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(source);
  if (!match) throw new Error(`${file}: no --- block at the top`);

  const meta = {};
  const controls = [];
  for (const line of match[1].split('\n')) {
    if (!line.trim()) continue;
    const at = line.indexOf(':');
    if (at < 0) throw new Error(`${file}: "${line}" is not "key: value"`);
    const key = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim();
    if (key !== 'control') { meta[key] = value; continue; }

    const parts = value.split('|').map((part) => part.trim());
    const control = Object.fromEntries(CONTROL_FIELDS.map((name, i) => [name, parts[i] ?? '']));
    if (!control.key || !control.type) throw new Error(`${file}: control "${value}" needs at least a key and a type`);
    if (control.type === 'select') control.options = control.options.split(',').map((o) => o.trim()).filter(Boolean);
    if (control.type === 'number') control.value = Number(control.value);
    if (control.type === 'boolean') control.value = control.value === 'true';
    /*
     * A `control:` line is one line, so `\n` in a default is the only way to
     * write a newline. It used to arrive as the two characters it looks like,
     * which is how the renderMarkdown preview came to be handed a single line
     * of markdown with backslash-n in it: no headings, no list, and the escapes
     * printed in the output for everyone to see.
     */
    if (typeof control.value === 'string') control.value = control.value.replace(/\\n/g, '\n');
    controls.push(control);
  }

  for (const required of ['name', 'group', 'title', 'signature']) {
    if (!meta[required]) throw new Error(`${file}: missing "${required}"`);
  }
  /*
   * A signature is one line, and a multi-line TypeScript one pasted in leaves
   * only its first line: `(options: {` or `(): Array<{`, which tells a reader
   * nothing and looks like the page failed to load. Summarise the shape on one
   * line instead -- `(options: { icon, label, onClick }): HTMLElement`.
   */
  if (/[{(<[,]$/.test(meta.signature.trim())) {
    throw new Error(`${file}: signature "${meta.signature}" is cut off. `
      + 'A signature is one line; summarise a multi-line one rather than pasting its first line.');
  }

  const body = match[2];
  const fence = /```(?:js|ts|css|bash)?\n([\s\S]*?)```/.exec(body);
  const prose = body.replace(/```[\s\S]*?```/g, '').trim();
  if (!fence || !fence[1].trim()) throw new Error(`${file}: no example. Every entry has one.`);
  if (!prose) throw new Error(`${file}: no description above the example.`);

  return {
    slug: path.basename(file, '.md'),
    name: meta.name,
    group: meta.group,
    title: meta.title,
    signature: meta.signature,
    preview: meta.preview || null,
    controls,
    prose,
    example: fence[1].trimEnd(),
  };
}

/** Every entry, in the order the groups are declared. */
export function readEntries(dir, order) {
  const entries = readdirSync(dir)
    .filter((file) => file.endsWith('.md'))
    .map((file) => parseEntry(file, readFileSync(path.join(dir, file), 'utf8')));

  const rank = new Map(order.map((key, i) => [key, i]));
  const groups = new Map();
  for (const entry of entries) {
    if (!groups.has(entry.group)) groups.set(entry.group, { key: entry.group, title: entry.title, entries: [] });
    groups.get(entry.group).entries.push(entry);
  }
  return [...groups.values()].sort((a, b) => (rank.get(a.key) ?? 99) - (rank.get(b.key) ?? 99));
}
