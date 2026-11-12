// The few things every screen of this plugin does to the DOM.
//
// None of them rebuilds anything that has not changed. A pipeline moving from
// one job to the next is one icon changing in one row; writing the same text to
// a node it already holds is not free (it is a mutation Slack's own observers
// see), so every write here checks first.

/** Set a node's text, only if it differs. */
export function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

/** Set or remove an attribute, only if it differs. `null`/`false` removes. */
export function setAttr(node, name, value) {
  if (value === null || value === undefined || value === false) {
    if (node.hasAttribute(name)) node.removeAttribute(name);
  } else if (node.getAttribute(name) !== String(value)) {
    node.setAttribute(name, String(value));
  }
}

/** Show or hide a node with `hidden`, only if it differs. */
export function show(node, visible) {
  if (node.hidden === visible) node.hidden = !visible;
}

/**
 * Make `container`'s children `items`, in order, keeping the element of every
 * item that was already there.
 *
 * `key` names an item, `create(item)` builds its element once (and may set
 * `element.__dispose`), and `update(element, item)` brings it up to date. An
 * element whose item went is removed and disposed. The container may hold only
 * what this puts there.
 */
export function patchList(container, items, { key, create, update }) {
  const existing = new Map();
  for (const child of container.children) existing.set(child.dataset.key, child);
  const wanted = new Set();
  items.forEach((item, index) => {
    const id = String(key(item));
    wanted.add(id);
    let element = existing.get(id);
    if (!element) {
      element = create(item);
      element.dataset.key = id;
    }
    update(element, item);
    if (container.children[index] !== element) container.insertBefore(element, container.children[index] ?? null);
  });
  for (const [id, element] of existing) {
    if (wanted.has(id)) continue;
    element.__dispose?.();
    element.remove();
  }
}

/**
 * A link out to GitLab, or plain text when there is no address to link to.
 *
 * The address has already been checked to be one of the instance's own https
 * pages (`ownUrl`), so it is never a `javascript:` or another site; `noopener`
 * and `noreferrer` keep GitLab from reaching back into Slack's window.
 */
export function link(h, { href, className, label, children = [] }) {
  if (!href) return h('span', { class: className }, children);
  return h('a', {
    class: className,
    href,
    target: '_blank',
    rel: 'noopener noreferrer',
    ...(label ? { 'aria-label': label } : {}),
  }, children);
}

/** Put an inline SVG (ours, never from GitLab) into a span. */
export function icon(h, svg, className = 'betterslack-gitlab-glyph') {
  const node = h('span', { class: className, 'aria-hidden': 'true' });
  node.innerHTML = svg;
  return node;
}
