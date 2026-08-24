// A message, drawn the way it was written.
//
// A search result flattened to plain text is a poor version of the truth: the
// bold went, the link became its address, the emoji became `:tada:` and the
// mention became `<@U04QJV693>`. Slack sends enough to do better, in two
// shapes, and this reads both.
//
//   * **`blocks`** is the good one -- Slack's own rich text, already parsed:
//     a `text` element carries `style: { bold, italic, code, strike }`, a
//     `link` carries its label, a `user` carries an id and an `emoji` carries
//     its name and often its codepoint. Nothing to guess.
//   * **mrkdwn** is the fallback, and it is what an integration's attachment
//     is made of -- measured, every Grafana alert in one workspace posts with
//     an empty `text` and its words in `attachments[].fallback`.
//
// Everything is drawn into spans rather than into anchors: a row is a button,
// an anchor inside one is invalid and swallows the click that should open the
// conversation. A link is styled like a link and does nothing on its own,
// which is right -- the whole row already goes somewhere.

/** Past this many characters a row stops drawing and says so. */
const LIMIT = 160;

/** Slack's four inline styles, as the elements that mean them. */
const STYLE_TAG = { bold: 'b', italic: 'i', strike: 's', code: 'code' };

/**
 * The plain text of a message, for the parts that cannot be drawn.
 *
 * Ranking reads it, a screen reader reads it, and the row's `title` is it. So
 * it follows the same order as the drawing: blocks first, then an attachment,
 * then the raw text.
 */
export function messageText(message, ctx) {
  const fromBlocks = plainOf(message?.blocks, ctx);
  if (fromBlocks) return fromBlocks;
  for (const attachment of message?.attachments ?? []) {
    const said = flatten(attachment.fallback || attachment.text || attachment.title || '');
    if (said) return said;
  }
  return flatten(message?.text ?? '');
}

/**
 * Slack's markup, as the one line a person reads.
 *
 * Everything a channel or a message carries is Slack's own mrkdwn, and a list
 * is the one place it is never rendered: a channel purpose came out as
 * `Point du vendredi : <https://us02web.zoom.us/j/889…>` across three lines,
 * ampersands and all. So links become their label, entities are decoded, and
 * the whole thing is one line -- a row is a glance, not a document.
 *
 * A shortcode is left in. What this feeds is a row's `title` and the ranking
 * behind it, where `plainOf` deliberately writes an emoji out as `:name:` so
 * the two readings of one message agree; the directory strips them on top of
 * this, because there the line is what is actually drawn.
 */
export function flatten(value) {
  return String(value ?? '')
    // <url|label> is the label; <url> and <#C…|name> are what is left of them.
    .replace(/<([^>|]+)\|([^>]+)>/g, '$2')
    .replace(/<([^>]+)>/g, '$1')
    // Slack sends these escaped, and only these three.
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    /*
     * Emphasis, as emphasis rather than as punctuation. A row is plain text and
     * cannot show bold, so the markers are noise -- `queue is *backing up*`.
     *
     * Only `*` and a backtick. Slack's italic marker is `_`, and half the
     * handles in a workspace are snake_case: stripping it turns
     * `deploy_from_main` into `deploy from main`, which is worse than leaving
     * one asterisk in.
     */
    .replace(/\*(\S(?:[^*]*\S)?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    // Blockquote markers, which mean nothing on one line and come in runs.
    .replace(/(^|\s)>+(\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every word in a block tree, in order, with no styling. */
function plainOf(blocks, ctx) {
  const parts = [];
  const walk = (node) => {
    if (!node || parts.length > 400) return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node !== 'object') return;
    if (node.type === 'emoji') { parts.push(`:${node.name}:`); return; }
    if (node.type === 'user') { parts.push(`@${nameFor(node.user_id, ctx ?? {})}`); return; }
    if (typeof node.text === 'string') parts.push(node.text);
    else if (node.text) walk(node.text);
    walk(node.elements);
    walk(node.fields);
  };
  walk(blocks);
  return flatten(parts.join(' '));
}

/**
 * Draw one message.
 *
 * `ctx` is `{ doc, emoji, users, emojiUrl }` -- the workspace's custom emoji
 * map, whatever profiles have been resolved so far, and the runtime's
 * name-to-image lookup. All three may be empty: a mention nobody has resolved
 * yet draws as the handle Slack sent, and an emoji nothing can draw is left
 * out rather than printed as its shortcode.
 */
export function renderMessage(message, ctx) {
  const out = ctx.doc.createDocumentFragment();
  const budget = { left: LIMIT };

  const blocks = Array.isArray(message?.blocks) ? message.blocks : [];
  if (blocks.length) {
    for (const block of blocks) drawBlock(block, out, ctx, budget);
    if (out.textContent.trim()) return trimEnd(out);
    // A block tree with nothing in it -- a file share, an unfurl-only post.
    out.replaceChildren();
    budget.left = LIMIT;
  }

  for (const attachment of message?.attachments ?? []) {
    const said = attachment.fallback || attachment.text || attachment.title || '';
    if (said.trim()) {
      drawMrkdwn(said, out, ctx, budget);
      return trimEnd(out);
    }
  }
  drawMrkdwn(message?.text ?? '', out, ctx, budget);
  return trimEnd(out);
}

/*
 * A row ends where the words do.
 *
 * Every block appends a space after itself, since a paragraph break has to read
 * as one on a single line -- which leaves a trailing one on the last block, and
 * a title that ends in a space sits a pixel off from the row under it.
 */
function trimEnd(fragment) {
  let last = fragment.lastChild;
  while (last && last.nodeType === 3 && !last.nodeValue.trim()) {
    fragment.removeChild(last);
    last = fragment.lastChild;
  }
  if (last && last.nodeType === 3) last.nodeValue = last.nodeValue.replace(/\s+$/, '');
  return fragment;
}

function drawBlock(block, into, ctx, budget) {
  if (!block || budget.left <= 0) return;
  if (block.type === 'rich_text') {
    for (const element of block.elements ?? []) drawBlock(element, into, ctx, budget);
    return;
  }
  if (block.type === 'rich_text_section' || block.type === 'rich_text_quote'
    || block.type === 'rich_text_preformatted' || block.type === 'rich_text_list') {
    for (const element of block.elements ?? []) drawElement(element, into, ctx, budget);
    // One line, so a paragraph break is a space rather than a new one.
    append(into, ' ', budget);
    return;
  }
  // A `section` block, whose text is mrkdwn again.
  if (typeof block.text?.text === 'string') drawMrkdwn(block.text.text, into, ctx, budget);
  for (const field of block.fields ?? []) {
    if (typeof field?.text === 'string') drawMrkdwn(field.text, into, ctx, budget);
  }
  for (const element of block.elements ?? []) drawElement(element, into, ctx, budget);
}

function drawElement(element, into, ctx, budget) {
  if (!element || budget.left <= 0) return;
  const doc = ctx.doc;

  if (element.type === 'emoji') {
    drawEmoji(element.name, element.unicode, into, ctx, budget);
    return;
  }
  if (element.type === 'user') {
    const name = nameFor(element.user_id, ctx);
    into.append(styled(doc, 'bsp-mention', `@${name}`));
    budget.left -= name.length + 1;
    return;
  }
  if (element.type === 'channel') {
    const name = ctx.channels?.get(element.channel_id) ?? element.channel_id;
    into.append(styled(doc, 'bsp-mention', `#${name}`));
    budget.left -= name.length + 1;
    return;
  }
  if (element.type === 'usergroup') {
    into.append(styled(doc, 'bsp-mention', '@group'));
    budget.left -= 6;
    return;
  }
  if (element.type === 'broadcast') {
    into.append(styled(doc, 'bsp-mention', `@${element.range ?? 'here'}`));
    budget.left -= 6;
    return;
  }
  if (element.type === 'link') {
    // The label if it has one, and the host if it does not -- a bare address on
    // one line is thirty characters of nothing anybody reads.
    const label = element.text?.trim() || hostOf(element.url);
    into.append(wrap(doc, element.style, styled(doc, 'bsp-link', label)));
    budget.left -= label.length;
    return;
  }
  if (element.type === 'date') {
    append(into, element.fallback ?? '', budget);
    return;
  }
  if (typeof element.text === 'string') {
    const node = doc.createTextNode(clip(tidy(element.text), budget));
    into.append(wrap(doc, element.style, node));
    return;
  }
  for (const child of element.elements ?? []) drawElement(child, into, ctx, budget);
}

/** Slack's markup, drawn rather than stripped. */
function drawMrkdwn(text, into, ctx, budget) {
  const source = String(text ?? '');
  // The four bracketed forms and an emoji shortcode, in one pass: anything
  // between them is ordinary text and gets the emphasis pass below.
  const pattern = /<([^>]+)>|:([a-z0-9_+'-]+):/gi;
  let at = 0;
  let match = pattern.exec(source);
  while (match && budget.left > 0) {
    drawEmphasis(source.slice(at, match.index), into, ctx, budget);
    if (match[2]) drawEmoji(match[2], null, into, ctx, budget);
    else drawBracketed(match[1], into, ctx, budget);
    at = match.index + match[0].length;
    match = pattern.exec(source);
  }
  if (budget.left > 0) drawEmphasis(source.slice(at), into, ctx, budget);
}

/** `<@U…>`, `<#C…|name>`, `<!here>` and `<url|label>`, which share a shape. */
function drawBracketed(inner, into, ctx, budget) {
  const doc = ctx.doc;
  const [target, label] = inner.split('|');
  if (target.startsWith('@')) {
    const name = label || nameFor(target.slice(1), ctx);
    into.append(styled(doc, 'bsp-mention', `@${name}`));
    budget.left -= name.length + 1;
    return;
  }
  if (target.startsWith('#')) {
    const name = label || ctx.channels?.get(target.slice(1)) || target.slice(1);
    into.append(styled(doc, 'bsp-mention', `#${name}`));
    budget.left -= name.length + 1;
    return;
  }
  if (target.startsWith('!')) {
    const name = label || target.slice(1);
    into.append(styled(doc, 'bsp-mention', `@${name}`));
    budget.left -= name.length + 1;
    return;
  }
  const shown = label?.trim() || hostOf(target);
  into.append(styled(doc, 'bsp-link', shown));
  budget.left -= shown.length;
}

/*
 * Bold, code and strike -- and deliberately not italic.
 *
 * Slack's italic marker is `_`, and half the handles and branch names in a
 * workspace are snake_case: `deploy_from_main` would come out as one italic
 * run with the underscores eaten, which is worse than an underscore on screen.
 */
const EMPHASIS = /\*(\S(?:[^*]*\S)?)\*|`([^`]+)`|~(\S(?:[^~]*\S)?)~/g;

function drawEmphasis(text, into, ctx, budget) {
  const source = tidy(unescape_(text));
  const doc = ctx.doc;
  let at = 0;
  EMPHASIS.lastIndex = 0;
  let match = EMPHASIS.exec(source);
  while (match && budget.left > 0) {
    append(into, source.slice(at, match.index), budget);
    const [tag, inner] = match[1] !== undefined
      ? ['b', match[1]]
      : (match[2] !== undefined ? ['code', match[2]] : ['s', match[3]]);
    const node = doc.createElement(tag);
    if (tag === 'code') node.className = 'bsp-code';
    node.append(clip(inner, budget));
    into.append(node);
    at = match.index + match[0].length;
    match = EMPHASIS.exec(source);
  }
  if (budget.left > 0) append(into, source.slice(at), budget);
}

function drawEmoji(name, unicode, into, ctx, budget) {
  const doc = ctx.doc;
  if (unicode) {
    // Slack sends the codepoints, so a standard emoji costs no request at all.
    const glyph = String.fromCodePoint(...String(unicode).split('-').map((part) => parseInt(part, 16)));
    append(into, glyph, budget);
    return;
  }
  const url = ctx.emojiUrl?.(name, ctx.emoji) ?? null;
  if (!url) return;
  const img = doc.createElement('img');
  img.className = 'bsp-emoji';
  img.src = url;
  img.alt = `:${name}:`;
  into.append(img);
  budget.left -= 2;
}

/** Whoever has been resolved; the id is a poor name but it is not a lie. */
function nameFor(userId, ctx) {
  const user = ctx.users?.get(userId);
  const profile = user?.profile ?? {};
  return profile.display_name || profile.real_name || user?.name || userId;
}

function hostOf(url) {
  const match = /^https?:\/\/([^/]+)/i.exec(String(url ?? ''));
  return match ? match[1].replace(/^www\./, '') : String(url ?? '');
}

/*
 * One line, and no blockquote markers.
 *
 * A run of `>` means a quote in Slack's markup and means nothing on a single
 * line -- and an integration that posts its body as one long mrkdwn string puts
 * six of them in the middle of it. Applied on both paths: a `rich_text` block
 * carries the same characters literally when whatever posted it never had its
 * markup parsed.
 */
function tidy(text) {
  return String(text ?? '')
    .replace(/(^|\s)>+(\s|$)/g, ' ')
    .replace(/\s+/g, ' ');
}

function unescape_(text) {
  return String(text ?? '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function styled(doc, className, text) {
  const node = doc.createElement('span');
  node.className = className;
  if (text !== null && text !== undefined) node.textContent = text;
  return node;
}

/** Apply whatever styles a rich-text element declared, innermost last. */
function wrap(doc, style, node) {
  let out = node;
  for (const [key, tag] of Object.entries(STYLE_TAG)) {
    if (!style?.[key]) continue;
    const element = doc.createElement(tag);
    if (tag === 'code') element.className = 'bsp-code';
    element.append(out);
    out = element;
  }
  return out;
}

/** Everything that draws goes through the budget, so nothing overruns it. */
function clip(text, budget) {
  const flat = String(text ?? '');
  if (flat.length <= budget.left) {
    budget.left -= flat.length;
    return flat;
  }
  const kept = flat.slice(0, Math.max(0, budget.left)).trimEnd();
  budget.left = 0;
  return `${kept}…`;
}

function append(into, text, budget) {
  if (!text || budget.left <= 0) return;
  into.append(clip(text, budget));
}
