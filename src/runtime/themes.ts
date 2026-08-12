// Stylesheet management.
//
// Slack's CSP allows 'unsafe-inline' for style-src, so a plain <style> element
// is all this needs. Order matters: themes first in the order the user enabled
// them, then whatever plugins inject, then the user's own CSS so it always has
// the last word.

const LAYER_ORDER = ['theme', 'plugin', 'user'] as const;
export type Layer = (typeof LAYER_ORDER)[number];

const ATTR = 'data-slackmod-style';

export class StyleManager {
  private nodes = new Map<string, HTMLStyleElement>();

  private key(layer: Layer, id: string): string {
    return `${layer}:${id}`;
  }

  /**
   * Anchors that keep the layers in a stable order even though Slack appends
   * its own <style> tags to <head> at arbitrary times.
   */
  private anchorFor(layer: Layer): HTMLElement {
    const head = document.head;
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

  set(layer: Layer, id: string, css: string): void {
    const key = this.key(layer, id);
    let node = this.nodes.get(key);
    if (!node || !node.isConnected) {
      node = document.createElement('style');
      node.setAttribute(ATTR, key);
      this.nodes.set(key, node);
    }
    node.textContent = css;
    // Insert just before the *next* layer's anchor so ordering holds.
    const anchor = this.anchorFor(layer);
    anchor.before(node);
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
      this.anchorFor(layer).before(node);
    }
  }

  clear(): void {
    for (const node of this.nodes.values()) node.remove();
    this.nodes.clear();
  }
}
