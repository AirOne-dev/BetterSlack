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
