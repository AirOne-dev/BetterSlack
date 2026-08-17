#!/usr/bin/env node
// Start a mod from something that already passes the gate.
//
//   pnpm new-mod plugin my-plugin "Does a thing"
//   pnpm new-mod theme  my-theme  "Looks a way"
//
// A mod is a folder with a manifest, an entry, dictionaries in at least English
// and French, and tests -- all of it enforced by validate-mods and
// check-structure. Writing that by hand before writing a single line of the
// idea is the discouraging part, and it is the same every time, so it is done
// here instead. What comes out passes every check on the first run.

import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [kind, id, ...rest] = process.argv.slice(2);
const description = rest.join(' ');

const usage = `
Usage: pnpm new-mod <plugin|theme> <id> "<description>"

  id           lowercase, dashes, matches the folder name
  description  one sentence about what a user gets, not how it works
`;

if (!['plugin', 'theme'].includes(kind ?? '') || !id) {
  console.error(usage);
  process.exit(1);
}
if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(id)) {
  console.error(`"${id}" is not a usable id: lowercase letters, digits and dashes.`);
  process.exit(1);
}
if (description.length < 20) {
  console.error('The description should be a sentence saying what a user gets (20 characters or more).');
  process.exit(1);
}

const folder = path.join(root, 'mods', kind === 'theme' ? 'themes' : 'plugins', id);
if (existsSync(folder)) {
  console.error(`${path.relative(root, folder)} already exists.`);
  process.exit(1);
}

/** Title Case from a dashed id, which is what people would have typed anyway. */
const name = id.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join(' ');
const entry = kind === 'theme' ? 'theme.css' : 'index.js';

const manifest = {
  id,
  name,
  type: kind,
  version: '1.0.0',
  author: process.env.USER ?? 'your-github-handle',
  description,
  entry,
  betterslackApi: 1,
  slackVersion: '4.51',
  tags: [kind === 'theme' ? 'themes' : 'tools'],
};

const pluginEntry = `// ${name}. ${description}
//
// Everything registered through \`api\` is undone when this is switched off, so
// stop() stays empty until there is state the API cannot know about.

import { STRINGS } from './strings.js';

export default {
  start(api) {
    const t = api.i18n.strings(STRINGS);

    api.slack.addToolbarButton('channelHeader', {
      id: '${id}',
      label: t('action'),
      icon: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" fill="currentColor"/></svg>',
      onClick: () => api.ui.toast(t('done'), { variant: 'success' }),
    });
  },
};
`;

const strings = `// What ${name} says, in every language it says it in.
//
// English is required and is what a missing language or key falls back to.

export const STRINGS = {
  en: {
    action: '${name}',
    done: 'It worked.',
  },
  fr: {
    action: '${name}',
    done: 'Ça a marché.',
  },
};
`;

const themeEntry = `/* ${name}. ${description}
 *
 * Slack paints from four families of custom properties, and a theme that only
 * sets the first leaves the app chrome untouched. See docs/themes.md.
 */

:root,
.sk-client-theme--light,
.sk-client-theme--dark {
  --dt_color-base-pry: #101418;      /* the conversation */
  --dt_color-content-pry: #e6e9ef;   /* body text */
  --dt_color-content-hgl-1: #6cb6ff; /* links and mentions */

  /* Chrome needs !important: Slack sets it on more specific selectors. */
  --dt_color-theme-base-inv-pry: #0b0e12 !important;
  --dt_color-theme-content-inv-pry: #f2f4f8 !important;

  /* The legacy family takes bare "r, g, b" triplets, not colours. */
  --sk_primary_background: 16, 20, 24 !important;
  --sk_primary_foreground: 230, 233, 239 !important;
}

/* A full-viewport opaque layer sits above <body>; without this nothing shows. */
.p-theme_background { background: #101418 !important; }
`;

const pluginTest = `import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPluginShape, createTestApi, installDom } from '../../../tests/harness.mjs';
import plugin from './index.js';

test('has the shape the runtime loads', () => assertPluginShape(assert, plugin));

test('puts its button in the channel header', async () => {
  const dom = installDom();
  try {
    const { api, recorded } = createTestApi();
    await plugin.start(api);

    const button = recorded.toolbarButtons.find((entry) => entry.button.id === '${id}');
    assert.ok(button, 'the button is registered');
    assert.equal(button.toolbar, 'channelHeader');

    button.button.onClick();
    assert.ok(recorded.toasts.some((toast) => toast.variant === 'success'), 'and it does something');
  } finally {
    dom.cleanup();
  }
});
`;

const themeTest = `import test from 'node:test';
import assert from 'node:assert/strict';
import { themeChecks } from '../../../tests/theme.mjs';

themeChecks(test, assert, import.meta.url);
`;

await fs.mkdir(folder, { recursive: true });
await fs.writeFile(path.join(folder, 'mod.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await fs.writeFile(path.join(folder, entry), kind === 'theme' ? themeEntry : pluginEntry);
await fs.writeFile(path.join(folder, 'test.mjs'), kind === 'theme' ? themeTest : pluginTest);
if (kind === 'plugin') await fs.writeFile(path.join(folder, 'strings.js'), strings);

const rel = path.relative(root, folder);
console.log(`
Created ${rel}

  ${rel}/mod.json${kind === 'plugin' ? `
  ${rel}/index.js      the entry: it exports default { start }
  ${rel}/strings.js    en and fr, both required` : `
  ${rel}/theme.css     the entry`}
  ${rel}/test.mjs      every mod ships tests; there is no opt-out

Next:
  pnpm registry                 # add it to the catalogue, and commit that
  pnpm test:mod ${id}
  pnpm check-structure ${id}
  pnpm start                    # then install it from the Browse shelf
`);
