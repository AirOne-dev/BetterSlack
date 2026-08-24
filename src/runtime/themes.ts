// Stylesheet management.
//
// Slack's CSP allows 'unsafe-inline' for style-src, so a plain <style> element
// is all this needs. Order matters: themes first in the order the user enabled
// them, then whatever plugins inject, then the user's own CSS so it always has
// the last word.

const LAYER_ORDER = ['theme', 'plugin', 'user'] as const;
export type Layer = (typeof LAYER_ORDER)[number];

const ATTR = 'data-betterslack-style';

/**
 * Follow a theme's own `@import './...'` statements and paste the files in.
 *
 * A theme is a folder now, and CSS in an injected <style> has no base URL for a
 * relative @import to resolve against -- the browser would simply drop it. So
 * they are resolved here, before the stylesheet ever reaches the page. Only
 * relative paths are touched: an @import of a remote URL is left alone so that
 * the review still sees it for what it is.
 */
/**
 * Replace `pattern` everywhere except inside comments.
 *
 * Mods are full of text that looks like an import and is not: a JSDoc
 * `@param {import('../../src/runtime/api.js').PluginApi}` is a type annotation
 * no loader ever resolves, and a commented-out `@import` is a decision the
 * author already made. Rewriting either one breaks a mod that is correct.
 *
 * The scanner is deliberately small -- it does not tokenise strings -- so a
 * `//` inside a string literal would blind it to the rest of that line. The
 * one common case, a URL, is excluded by requiring the slashes not to follow a
 * colon; anything else is a mod that can move its import to its own line.
 */
export function replaceOutsideComments(
  source: string,
  pattern: RegExp,
  replacer: (match: RegExpExecArray) => string,
): string {
  const comments: Array<[number, number]> = [];
  const scanner = /\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g;
  for (let hit = scanner.exec(source); hit; hit = scanner.exec(source)) {
    // The line-comment form captures one character before the slashes; that
    // character is code, not comment, so it stays outside the range.
    const start = hit.index + (hit[1] ? hit[1].length : 0);
    comments.push([start, hit.index + hit[0].length]);
  }
  const inComment = (at: number) => comments.some(([from, to]) => at >= from && at < to);

  const all = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  let out = '';
  let last = 0;
  for (let hit = all.exec(source); hit; hit = all.exec(source)) {
    if (!inComment(hit.index)) {
      out += source.slice(last, hit.index) + replacer(hit);
      last = hit.index + hit[0].length;
    }
    if (hit[0] === '') all.lastIndex++;
  }
  return out + source.slice(last);
}

export function inlineCssImports(
  files: Record<string, string>,
  entry: string,
  seen: string[] = [],
): string {
  const source = files[entry];
  if (source === undefined) return '';
  if (seen.includes(entry)) {
    console.warn(`[betterslack] circular @import: ${[...seen, entry].join(' -> ')}`);
    return '';
  }
  return replaceOutsideComments(
    source,
    /@import\s+(?:url\()?['"](\.[^'"]+)['"]\)?\s*;/g,
    ([whole, spec]) => {
      const target = resolvePath(entry, spec!);
      if (files[target] === undefined) {
        console.warn(`[betterslack] @import "${spec}" from "${entry}" matches no file`);
        return whole;
      }
      return `\n/* ${target} */\n${inlineCssImports(files, target, [...seen, entry])}\n`;
    },
  );
}

/** `./x.css` relative to `a/b.css` is `a/x.css`; `../` climbs one folder. */
export function resolvePath(from: string, spec: string): string {
  const base = from.split('/').slice(0, -1);
  for (const part of spec.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') base.pop();
    else base.push(part);
  }
  return base.join('/');
}

export class StyleManager {
  private nodes = new Map<string, HTMLStyleElement>();
  /** Layers held back: their stylesheets exist but are not in the document. */
  private suppressed = new Set<Layer>();

  private key(layer: Layer, id: string): string {
    return `${layer}:${id}`;
  }

  /**
   * Anchors that keep the layers in a stable order even though Slack appends
   * its own <style> tags to <head> at arbitrary times.
   *
   * Null before the document has a head. The runtime is injected at
   * document-start, so that is a real state and not a defensive gesture:
   * reading `querySelector` off it threw, the whole bundle failed at boot, and
   * the mods arrived through the loader's re-injection instead -- against a DOM
   * Slack had already half built, which is where both renderer freezes came
   * from. It was silent because that fallback works.
   */
  private anchorFor(layer: Layer): HTMLElement | null {
    const head = document.head;
    if (!head) return null;
    let anchor = head.querySelector<HTMLElement>(`meta[${ATTR}-anchor="${layer}"]`);
    if (anchor) return anchor;
    anchor = document.createElement('meta');
    anchor.setAttribute(`${ATTR}-anchor`, layer);
    head.append(anchor);
    // Re-order all anchors so a late-created layer still lands in the right spot.
    for (const name of LAYER_ORDER) {
      const node = head.querySelector<HTMLElement>(`meta[${ATTR}-anchor="${name}"]`);
      if (node) head.append(node);
    }
    return anchor;
  }

  /** Layers whose stylesheets were written before there was a head to hold them. */
  private waiting = new Map<string, Layer>();
  private watcher: MutationObserver | null = null;

  /**
   * Hold a stylesheet until there is a document to put it in, then place it
   * through the ordinary anchor path so the layer order still holds.
   *
   * `document.documentElement` is itself null this early, and the Document node
   * is observable -- it sees <html> arrive -- which is the same fallback
   * `waitForClient` and `dom.waitFor` take.
   */
  private attachWhenReady(layer: Layer, key: string): void {
    this.waiting.set(key, layer);
    if (this.watcher) return;
    const flush = (): boolean => {
      if (!document.head) return false;
      for (const [pending, pendingLayer] of this.waiting) {
        const node = this.nodes.get(pending);
        if (!node || this.suppressed.has(pendingLayer)) continue;
        this.anchorFor(pendingLayer)?.before(node);
      }
      this.waiting.clear();
      this.watcher?.disconnect();
      this.watcher = null;
      return true;
    };
    if (flush()) return;
    this.watcher = new MutationObserver(() => { flush(); });
    this.watcher.observe(document.documentElement ?? document, { childList: true, subtree: true });
  }

  set(layer: Layer, id: string, css: string): void {
    const key = this.key(layer, id);
    let node = this.nodes.get(key);
    if (!node || !node.isConnected) {
      node = document.createElement('style');
      node.setAttribute(ATTR, key);
      this.nodes.set(key, node);
    }
    node.textContent = css;
    if (this.suppressed.has(layer)) {
      node.remove();
      return;
    }
    // Insert just before the *next* layer's anchor so ordering holds.
    const anchor = this.anchorFor(layer);
    if (anchor) anchor.before(node);
    else this.attachWhenReady(layer, key);
  }

  /**
   * Take a whole layer out of the document, or put it back.
   *
   * For a tool that needs the app *without* the user's themes for a while --
   * the theme builder, editing one theme on top of another, has to be able to
   * show what its own stylesheet does rather than what it does plus whatever is
   * switched on. The nodes are kept, so nothing is recomputed on the way back
   * and the settings are never touched: this is about what is on screen now.
   */
  suppress(layer: Layer, on: boolean): void {
    if (on === this.suppressed.has(layer)) return;
    if (on) {
      this.suppressed.add(layer);
      for (const [key, node] of this.nodes) {
        if (key.startsWith(`${layer}:`)) node.remove();
      }
      return;
    }
    this.suppressed.delete(layer);
    for (const [key, node] of this.nodes) {
      if (key.startsWith(`${layer}:`)) this.anchorFor(layer)?.before(node);
    }
  }

  remove(layer: Layer, id: string): void {
    const key = this.key(layer, id);
    this.nodes.get(key)?.remove();
    this.nodes.delete(key);
  }

  has(layer: Layer, id: string): boolean {
    return this.nodes.has(this.key(layer, id));
  }

  /**
   * Slack replaces <head> content on some navigations; re-attach anything that
   * fell out rather than losing the user's theme silently.
   */
  reattachOrphans(): void {
    for (const [key, node] of this.nodes) {
      if (node.isConnected) continue;
      const layer = key.split(':')[0] as Layer;
      // A suppressed layer is detached on purpose; putting it back here would
      // undo the suppression on the next thing Slack does to <head>.
      if (this.suppressed.has(layer)) continue;
      this.anchorFor(layer)?.before(node);
    }
  }

  clear(): void {
    for (const node of this.nodes.values()) node.remove();
    this.nodes.clear();
  }
}
