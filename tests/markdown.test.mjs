// The readme renderer.
//
// A mod's readme comes from a mod folder, and a mod can come from somebody
// else's repository. The output goes through innerHTML, so the escaping is not
// a detail of this file -- it is the point of it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../dist/ui/markdown.mjs';

test('renders the shapes a readme is made of', () => {
  const html = renderMarkdown([
    '# Title',
    '',
    'A **bold** word, some `code` and a [link](https://example.com).',
    '',
    '- one',
    '- two',
    '',
    '> a quote',
    '',
    '```js',
    'const a = 1;',
    '```',
  ].join('\n'));

  assert.match(html, /<h1 class="sm-md__h1">Title<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<code class="sm-md__code">code<\/code>/);
  assert.match(html, /<a class="sm-md__link" href="https:\/\/example.com"/);
  assert.match(html, /<ul class="sm-md__list">\n<li>one<\/li>/);
  assert.match(html, /<blockquote class="sm-md__quote">a quote<\/blockquote>/);
  assert.match(html, /<pre class="sm-md__pre"><code>const a = 1;<\/code><\/pre>/);
});

test('escapes everything before it wraps anything', () => {
  const html = renderMarkdown('<img src=x onerror="alert(1)"> & <b>no</b>');
  assert.equal(html.includes('<img src=x'), false);
  assert.equal(html.includes('<b>'), false);
  assert.match(html, /&lt;img/);
  assert.match(html, /&amp;/);
});

test('refuses a link that would run something', () => {
  // A readme is prose from a folder somebody else wrote. javascript: in a link
  // is the oldest trick there is, and this renderer is one innerHTML away from
  // the client.
  for (const bad of ['javascript:alert(1)', 'vbscript:x', ' javascript:alert(1)']) {
    const html = renderMarkdown(`[click](${bad})`);
    assert.equal(html.includes('<a '), false, bad);
  }
  for (const good of ['https://example.com', 'mailto:a@b.c', 'slack://channel?team=T1']) {
    assert.match(renderMarkdown(`[go](${good})`), /<a class="sm-md__link"/, good);
  }
});

test('hands relative paths to the caller, which knows where a mod folder is', () => {
  const html = renderMarkdown('![shot](shots/panel.png)', {
    resolve: (href) => (href.startsWith('shots/') ? `data:image/png;base64,AAA#${href}` : null),
  });
  assert.match(html, /src="data:image\/png;base64,AAA#shots\/panel.png"/);

  // And what it refuses stays as text rather than becoming a broken picture.
  const refused = renderMarkdown('![shot](../../etc/passwd)', { resolve: () => null });
  assert.equal(refused.includes('<img'), false);
});
