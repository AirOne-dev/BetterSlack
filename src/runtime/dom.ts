// DOM helpers for mods.
//
// Slack's class names (`c-menu_item__li`, `p-ia__sidebar_header__info`) are
// build artefacts and churn between releases; `data-qa` attributes are used by
// Slack's own test suite and survive far longer. Every helper here is built to
// be idempotent, because Slack re-renders aggressively and a naive
// MutationObserver will happily insert the same node a dozen times.

export type Cleanup = () => void;

/** Resolve once an element matching `selector` exists, or null on timeout. */
export function waitFor<T extends Element = Element>(
  selector: string,
  timeoutMs = 30_000,
  root: ParentNode = document,
): Promise<T | null> {
  const existing = root.querySelector<T>(selector);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: T | null) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timer);
      resolve(value);
    };
    const observer = new MutationObserver(() => {
      const found = root.querySelector<T>(selector);
      if (found) finish(found);
    });
    observer.observe(root === document ? document.documentElement : (root as Node), {
      childList: true,
      subtree: true,
    });
    const timer = setTimeout(() => finish(null), timeoutMs);
  });
}

/**
 * Keep a node present inside a container that Slack may re-render at any time.
 *
 * `factory` is only called when the node is actually missing, so repeated
 * mutations cannot produce duplicates -- the bug that made the 2023 prototype
 * insert its menu item several times per open.
 */
export interface MountOptions {
  position?: 'append' | 'prepend';
  /**
   * Selector, matched inside the container, to insert before. Falls back to
   * `position` when it matches nothing, so a Slack change that removes the
   * anchor moves the node rather than losing it.
   */
  before?: string;
}

export function keepMounted(
  containerSelector: string,
  nodeId: string,
  factory: () => HTMLElement,
  options: MountOptions | 'append' | 'prepend' = {},
): Cleanup {
  const { position = 'append', before } =
    typeof options === 'string' ? { position: options, before: undefined } : options;
  let disposed = false;

  const mount = () => {
    if (disposed) return;
    const container = document.querySelector(containerSelector);
    if (!container) return;
    const current = document.getElementById(nodeId);
    if (current && container.contains(current)) return;
    current?.remove();
    const node = factory();
    node.id = nodeId;
    const anchor = before ? container.querySelector(before) : null;
    if (anchor) anchor.before(node);
    else if (position === 'prepend') container.prepend(node);
    else container.append(node);
  };

  mount();
  // One observer on documentElement rather than one per mod: Slack's tree is
  // large and observers are not free.
  const observer = new MutationObserver(() => mount());
  observer.observe(document.documentElement, { childList: true, subtree: true });

  return () => {
    disposed = true;
    observer.disconnect();
    document.getElementById(nodeId)?.remove();
  };
}

/** Run `handler` for every element matching `selector`, now and in the future. */
export function onEach<T extends Element = Element>(
  selector: string,
  handler: (element: T) => void,
): Cleanup {
  const seen = new WeakSet<Element>();
  const scan = () => {
    for (const element of document.querySelectorAll<T>(selector)) {
      if (seen.has(element)) continue;
      seen.add(element);
      try {
        handler(element);
      } catch (err) {
        console.error('[slackmod] onEach handler threw', err);
      }
    }
  };
  scan();
  const observer = new MutationObserver(scan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  return () => observer.disconnect();
}

/** Register a keyboard shortcut. Returns a cleanup that removes it. */
export function onShortcut(
  match: (event: KeyboardEvent) => boolean,
  handler: (event: KeyboardEvent) => void,
): Cleanup {
  const listener = (event: KeyboardEvent) => {
    if (!match(event)) return;
    event.preventDefault();
    event.stopPropagation();
    handler(event);
  };
  // Capture phase: Slack binds a lot of its own shortcuts on document.
  window.addEventListener('keydown', listener, true);
  return () => window.removeEventListener('keydown', listener, true);
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') element.className = value;
    else element.setAttribute(key, value);
  }
  for (const child of children) {
    element.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return element;
}
