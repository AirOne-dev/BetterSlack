/**
 * Turning `:slightly_smiling_face:` back into a picture.
 *
 * A shortcode cannot be drawn from its name. Slack serves a standard emoji by
 * **codepoint** -- `…/apple-small/1f642@2x.png` -- so `slightly_smiling_face`
 * builds no URL, and `emoji.list` answers with the workspace's custom emoji
 * only. Which leaves a log full of `:name:` where an emoji should be, and that
 * reads as a rendering that failed rather than as a message.
 *
 * Slack's own DOM is the table nobody publishes. Every emoji it draws is an
 * `<img>` carrying `data-stringify-emoji` -- the name -- and a `src`, standard
 * ones included. So the pairs are collected from whatever the client has drawn
 * and kept: an emoji you have seen once in Slack is an emoji this can draw for
 * ever after, and the table fills itself as you use the app.
 *
 * It is capped and persisted, because it lives in the loader's settings file
 * and is read at every launch.
 */

/** Enough for a workspace's habits. Beyond it, the least recently added goes. */
export const EMOJI_LIMIT = 600;

/** `:name:` and nothing else -- Slack's own shortcodes have no spaces in them. */
const SHORTCODE = /:([a-z0-9_+'-]+(?:::skin-tone-\d)?):/gi;

/**
 * Every emoji drawn inside an element, as name to image.
 *
 * @param {ParentNode} root anything Slack has rendered
 */
export function harvest(root) {
  const found = {};
  for (const node of root?.querySelectorAll?.('[data-stringify-emoji]') ?? []) {
    const name = node.getAttribute('data-stringify-emoji');
    const src = node.tagName === 'IMG' ? node.src : node.querySelector?.('img')?.src;
    if (!name || !src) continue;
    found[name.replace(/^:|:$/g, '')] = src;
  }
  return found;
}

/** The table, with what was just seen folded in and the oldest dropped. */
export function merge(table, found, limit = EMOJI_LIMIT) {
  const next = { ...table };
  for (const [name, url] of Object.entries(found)) {
    // Deleted first so a name seen again moves to the end: insertion order is
    // what the cap reads, so the ones you use stay and the ones you met once go.
    delete next[name];
    next[name] = url;
  }
  const names = Object.keys(next);
  if (names.length <= limit) return next;
  for (const name of names.slice(0, names.length - limit)) delete next[name];
  return next;
}

/**
 * A line of Slack's text, with its emoji drawn.
 *
 * Returns nodes rather than a string: the pictures are `<img>`, and building
 * HTML out of somebody's message to get them there would be putting their words
 * through an HTML parser, which is the one thing this must never do.
 *
 * A shortcode nothing can draw is left exactly as it was written. It is a word
 * the reader has to skip, which is worse than an emoji and better than a hole
 * where a word used to be -- unlike the reaction rows, where the shortcode *is*
 * the whole content and a picture that cannot be drawn is better left out.
 *
 * @param {Document} doc
 * @param {string} text
 * @param {(name: string) => string|null} lookup
 */
export function renderText(doc, text, lookup) {
  const out = doc.createDocumentFragment();
  const source = String(text ?? '');
  let at = 0;

  for (const match of source.matchAll(SHORTCODE)) {
    const url = lookup(match[1]);
    if (!url) continue;
    if (match.index > at) out.append(doc.createTextNode(source.slice(at, match.index)));
    const image = doc.createElement('img');
    image.className = 'bsh-emoji bsh-emoji--inline';
    image.src = url;
    image.alt = match[0];
    image.title = match[0];
    out.append(image);
    at = match.index + match[0].length;
  }

  if (at < source.length) out.append(doc.createTextNode(source.slice(at)));
  return out;
}

/**
 * The name to look a picture up by.
 *
 * `:raised_hands::skin-tone-2:` is one emoji written as two shortcodes, and the
 * tone is a variant Slack draws as its own image -- so the whole thing is tried
 * first, and the base name is the fallback. Losing the tone is a better row
 * than losing the emoji.
 */
export function namesFor(shortcode) {
  const clean = String(shortcode ?? '').replace(/^:|:$/g, '');
  if (!clean) return [];
  const base = clean.split('::')[0];
  return base === clean ? [clean] : [clean, base];
}
