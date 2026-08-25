/**
 * Slack's own markup, drawn.
 *
 * What Slack's API answers with is not what Slack draws. A mention arrives as
 * `<@U04ED8UPV>`, a link as `<https://…|https://…>`, an ampersand as `&amp;`,
 * and emphasis as the asterisks somebody typed -- so anything that shows a
 * message as it came off the wire shows the wire. Two mods do that already:
 * the command palette lists search results, and History keeps what a message
 * said before it changed.
 *
 * Nodes, never a string of HTML. Everything here is somebody's message, and
 * building markup out of it to get a mention on screen would put their words
 * through an HTML parser -- which is the one thing a renderer for untrusted
 * text may not do.
 *
 * Two rules that look like details and are not:
 *
 * - **`_italic_` is not emphasis.** It is Slack's marker, and half the handles
 *   and branch names in a workspace are snake_case: `deploy_from_main` comes
 *   out as one italic run with the underscores eaten, which is worse than an
 *   underscore left on screen.
 * - **A bare address is shown by its host.** `<https://github.com/…#issue…>`
 *   is sixty characters of nothing anybody reads, and Slack sends the URL as
 *   its own label when whoever wrote it did not give one -- so a label equal
 *   to the target is not a label.
 */

/** How a caller turns the ids Slack sends into something a person recognises. */
export interface MrkdwnOptions {
  /** The document to build in. Defaults to the page's. */
  doc?: Document;
  /** A user id to a display name. The id is a poor name and not a lie. */
  userName?(id: string): string | null | undefined;
  /** A channel id to its name, where the markup did not carry one. */
  channelName?(id: string): string | null | undefined;
  /** A shortcode to a picture. Nothing drawable leaves the shortcode alone. */
  emojiUrl?(name: string): string | null | undefined;
  /** Makes a channel mention a button. Without it, it is a plain span. */
  onChannel?(id: string): void;
  /** Makes a link a button, with the URL. Without it, it is a plain span. */
  onLink?(url: string): void;
  /**
   * Collapse it to a single line: whitespace runs become one space and
   * blockquote markers go. For a row in a list, where a newline is a wrap and
   * a run of `>` is six characters of punctuation.
   */
  oneLine?: boolean;
  /** Stop after this many characters of text. The rest is dropped. */
  maxLength?: number;
  /**
   * Show a bare address by its host rather than in full.
   *
   * For a row in a list, where sixty characters of URL is the whole line. A
   * message shown as a message keeps it: Slack sends the address as its own
   * label when nobody wrote one, and draws the whole thing, because a link
   * pasted on its own is usually the point of the message.
   */
  shortLinks?: boolean;
}

/** The classes everything here wears, so one stylesheet covers every mod. */
export const MRKDWN_CLASS = {
  mention: 'betterslack-mention',
  link: 'betterslack-link',
  code: 'betterslack-code',
  emoji: 'betterslack-emoji',
  quote: 'betterslack-quote',
};

/** The four bracketed forms and an emoji shortcode, in one pass. */
const TOKEN = /<([^>]+)>|:([a-z0-9_+'-]+(?:::skin-tone-\d)?):/gi;
/** Bold, code and strike. Not italic -- see the header. */
const EMPHASIS = /\*(\S(?:[^*]*\S)?)\*|`([^`]+)`|~(\S(?:[^~]*\S)?)~/g;

export function renderMrkdwn(text: string, options: MrkdwnOptions = {}): DocumentFragment {
  const doc = options.doc ?? document;
  const out = doc.createDocumentFragment();
  const budget = { left: options.maxLength ?? Infinity };
  const source = String(text ?? '');

  let at = 0;
  TOKEN.lastIndex = 0;
  let match = TOKEN.exec(source);
  while (match && budget.left > 0) {
    emphasis(source.slice(at, match.index), out, doc, options, budget);
    if (match[2]) emoji(match[2], out, doc, options, budget);
    else bracketed(match[1] ?? '', out, doc, options, budget);
    at = match.index + match[0].length;
    match = TOKEN.exec(source);
  }
  if (budget.left > 0) emphasis(source.slice(at), out, doc, options, budget);
  return out;
}

/** `<@U…>`, `<#C…|name>`, `<!here>` and `<url|label>`, which share a shape. */
function bracketed(
  inner: string,
  into: ParentNode,
  doc: Document,
  options: MrkdwnOptions,
  budget: { left: number },
): void {
  const cut = inner.indexOf('|');
  const target = cut === -1 ? inner : inner.slice(0, cut);
  const label = cut === -1 ? null : inner.slice(cut + 1);

  if (target.startsWith('@')) {
    const id = target.slice(1);
    write(into, span(doc, MRKDWN_CLASS.mention, `@${label || options.userName?.(id) || id}`), budget);
    return;
  }
  if (target.startsWith('#')) {
    const id = target.slice(1);
    const name = `#${label || options.channelName?.(id) || id}`;
    if (!options.onChannel) { write(into, span(doc, MRKDWN_CLASS.mention, name), budget); return; }
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = `c-button-unstyled ${MRKDWN_CLASS.mention}`;
    button.textContent = name;
    button.addEventListener('click', () => options.onChannel?.(id));
    write(into, button, budget);
    return;
  }
  // `<!here>`, `<!channel>`, `<!everyone>` and `<!subteam^S…|@group>`.
  if (target.startsWith('!')) {
    const name = label || target.slice(1).split('^')[0] || 'here';
    write(into, span(doc, MRKDWN_CLASS.mention, name.startsWith('@') ? name : `@${name}`), budget);
    return;
  }

  // A label equal to the target is Slack repeating the URL, not a label.
  const named = label && label.trim() && label.trim() !== target ? label.trim() : null;
  const shown = named ?? (options.shortLinks ? hostOf(target) : target);
  if (!options.onLink) { write(into, span(doc, MRKDWN_CLASS.link, shown), budget); return; }
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = `c-button-unstyled ${MRKDWN_CLASS.link}`;
  button.title = target;
  button.textContent = shown;
  button.addEventListener('click', () => options.onLink?.(target));
  write(into, button, budget);
}

function emphasis(
  text: string,
  into: ParentNode,
  doc: Document,
  options: MrkdwnOptions,
  budget: { left: number },
): void {
  const source = tidy(unescape(text), options);
  let at = 0;
  EMPHASIS.lastIndex = 0;
  let match = EMPHASIS.exec(source);
  while (match && budget.left > 0) {
    plain(source.slice(at, match.index), into, doc, budget);
    const [tag, inner] = match[1] !== undefined
      ? ['b', match[1]]
      : (match[2] !== undefined ? ['code', match[2]] : ['s', match[3] ?? '']);
    const node = doc.createElement(tag ?? 'span');
    if (tag === 'code') node.className = MRKDWN_CLASS.code;
    node.append(clip(inner ?? '', budget));
    into.append(node);
    at = match.index + match[0].length;
    match = EMPHASIS.exec(source);
  }
  if (budget.left > 0) plain(source.slice(at), into, doc, budget);
}

function emoji(
  name: string,
  into: ParentNode,
  doc: Document,
  options: MrkdwnOptions,
  budget: { left: number },
): void {
  const url = options.emojiUrl?.(name) ?? null;
  // A shortcode nothing can draw stays as it was written: a word the reader
  // skips is worse than a picture and better than a hole where a word was.
  if (!url) { plain(`:${name}:`, into, doc, budget); return; }
  const image = doc.createElement('img');
  image.className = MRKDWN_CLASS.emoji;
  image.src = url;
  image.alt = `:${name}:`;
  image.title = `:${name}:`;
  into.append(image);
  budget.left -= 2;
}

function span(doc: Document, className: string, text: string): HTMLSpanElement {
  const node = doc.createElement('span');
  node.className = className;
  node.textContent = text;
  return node;
}

function write(into: ParentNode, node: Element, budget: { left: number }): void {
  into.append(node);
  budget.left -= node.textContent?.length ?? 0;
}

function plain(text: string, into: ParentNode, doc: Document, budget: { left: number }): void {
  if (!text) return;
  into.append(doc.createTextNode(clip(text, budget)));
}

function clip(text: string, budget: { left: number }): string {
  if (budget.left === Infinity) return text;
  const kept = text.slice(0, Math.max(0, budget.left));
  budget.left -= text.length;
  return kept;
}

/**
 * A run of `>` is a quote in Slack's markup, and on one line it is punctuation.
 *
 * Kept as the marker anywhere else: this renders inline runs, and a quote is a
 * block. Dropping it there would lose the only sign the line was quoted.
 */
function tidy(text: string, options: MrkdwnOptions): string {
  if (!options.oneLine) return text;
  return text.replace(/(^|\s)>+(\s|$)/g, ' ').replace(/\s+/g, ' ');
}

/** Slack sends these escaped, and only these three. */
function unescape(text: string): string {
  return String(text ?? '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function hostOf(url: string): string {
  const match = /^https?:\/\/([^/]+)/i.exec(String(url ?? ''));
  return match?.[1] ? match[1].replace(/^www\./, '') : String(url ?? '');
}
