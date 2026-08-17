// Show, in the real Slack, everything a colour is about to change.
//
// The builder can say which token paints an element (inspect.js walks from the
// element to the rules). This is the same question backwards, and it is the one
// that actually helps while choosing a colour: given a token, what does it
// paint? Hovering a swatch outlines every one of them in the client next door,
// which turns "Surface — dividers, pills" from a description into a fact.
//
// Done by inverting the stylesheet once: every rule whose declarations mention
// var(--x) contributes its selector to x. Slack ships tens of thousands of
// rules, so this is built once and kept -- rebuilding it per hover would be a
// hundred milliseconds of work at exactly the wrong moment.

const MARK_CLASS = 'betterslack-highlight-mark';

/**
 * A selector that querySelectorAll will accept, and that still points at the
 * right nodes.
 *
 * State pseudo-classes are dropped rather than skipped, which matters more than
 * it sounds: the hover colour is only ever written in a `:hover` rule, so
 * refusing those selectors would leave the role called "the row under the
 * pointer" highlighting nothing at all. Stripping them outlines the rows that
 * *would* take the colour, which is the question being asked.
 *
 * Pseudo-elements are stripped the same way, which outlines the element the
 * ::before belongs to -- it has no box of its own, and its host's box is where
 * the colour will appear.
 */
function queryable(part) {
  const selector = part
    .replace(/::[\w-]+(\([^)]*\))?/g, '')
    .replace(/:(hover|focus|focus-visible|focus-within|active|visited|target|checked|disabled|enabled|first-child|last-child)\b/g, '')
    .trim();
  if (!selector || selector.startsWith('@')) return '';
  return selector;
}

/** token name -> the selectors that read it. */
export function buildTokenIndex(sheets) {
  const index = new Map();

  const add = (name, selector) => {
    let set = index.get(name);
    if (!set) index.set(name, (set = new Set()));
    set.add(selector);
  };

  const walk = (rules) => {
    for (const rule of rules) {
      if (rule.cssRules) walk(rule.cssRules);
      if (!rule.selectorText || !rule.style) continue;
      const text = rule.style.cssText;
      if (!text.includes('var(--')) continue;
      const names = [...text.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]);
      if (!names.length) continue;
      for (const part of rule.selectorText.split(',')) {
        const selector = queryable(part);
        if (!selector) continue;
        for (const name of names) add(name, selector);
      }
    }
  };

  for (const sheet of sheets) {
    try {
      walk(sheet.cssRules);
    } catch {
      continue; // another origin, and not ours to read
    }
  }
  return index;
}

/**
 * The elements on screen that any of `names` paints.
 *
 * Capped, and only what is visible: a token like --dt_color-content-pry is on
 * every line of text in the client, and outlining two thousand nodes is both
 * slow and unreadable.
 */
export function elementsUsing({ tokens = [], selectors: direct = [] }, index, doc, limit = 150) {
  const selectors = new Set(direct);
  for (const name of tokens) {
    for (const selector of index.get(name) ?? []) selectors.add(selector);
  }

  const found = new Set();
  for (const selector of selectors) {
    let matches;
    try {
      matches = doc.querySelectorAll(selector);
    } catch {
      continue;
    }
    for (const element of matches) {
      const box = element.getBoundingClientRect();
      if (box.width < 4 || box.height < 4) continue;
      if (box.bottom < 0 || box.top > doc.documentElement.clientHeight) continue;
      if (box.right < 0 || box.left > doc.documentElement.clientWidth) continue;
      found.add(element);
      if (found.size >= limit) return [...found];
    }
  }
  return [...found];
}

/**
 * Draw the outlines.
 *
 * Plain absolutely-positioned nodes rather than a canvas or an outline on the
 * elements themselves: touching Slack's own nodes would make React fight back,
 * and this has to survive being called on every pointer move.
 */
export function createHighlighter(doc) {
  const layer = doc.createElement('div');
  layer.id = 'betterslack-highlight-layer';
  Object.assign(layer.style, {
    position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '99998',
  });

  const clear = () => layer.replaceChildren();

  return {
    show(elements) {
      if (!layer.isConnected) doc.body.append(layer);
      clear();
      for (const element of elements) {
        const box = element.getBoundingClientRect();
        const mark = doc.createElement('div');
        mark.className = MARK_CLASS;
        Object.assign(mark.style, {
          position: 'fixed',
          left: `${box.left}px`,
          top: `${box.top}px`,
          width: `${box.width}px`,
          height: `${box.height}px`,
          outline: '2px solid #1d9bd1',
          background: 'rgba(29, 155, 209, .16)',
          borderRadius: '3px',
        });
        layer.append(mark);
      }
    },
    clear,
    dispose() {
      clear();
      layer.remove();
    },
  };
}
