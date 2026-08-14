// Point at something in Slack and find out what paints it.
//
// This is the part that makes the tool more than twelve pickers. Slack's
// stylesheet is forty thousand rules of hashed class names; knowing that a
// channel row's hover state comes from --dt_color-base-pry-hover is not
// something anyone can hold in their head, and it is not written down.
//
// So it is read out of the page. The element the pointer lands on is matched
// against every rule in every same-origin sheet -- there is no API that answers
// "which rules apply to this element", only this walk -- and the var() names in
// those rules are the tokens a theme has to change to change what is on screen.

/** Every rule whose selector matches `element`, in sheet order. */
export function matchedRules(element, sheets) {
  const out = [];

  const walk = (rules) => {
    for (const rule of rules) {
      if (rule.cssRules) walk(rule.cssRules); // @media, @supports, @layer
      if (!rule.selectorText) continue;
      for (const part of rule.selectorText.split(',')) {
        const selector = part.trim();
        if (!selector) continue;
        let hit = false;
        try {
          hit = element.matches(selector);
        } catch {
          continue; // :hover, ::part, whatever Slack ships that we cannot test
        }
        if (hit) {
          out.push({ selector, text: rule.style.cssText });
          break;
        }
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
  return out;
}

/** The custom properties those rules read, resolved to what they hold now. */
export function variablesIn(rules, resolve) {
  const names = new Set();
  for (const rule of rules) {
    for (const match of String(rule.text).matchAll(/var\((--[\w-]+)/g)) names.add(match[1]);
  }
  return [...names].sort().map((name) => ({ name, value: resolve(name) }));
}

/**
 * A short, readable name for an element.
 *
 * data-qa first: it is Slack's own test hook and it survives releases, while
 * `circleButton__cMiUK` is CSS-module output that changes with every build.
 */
export function describe(element) {
  const qa = element.getAttribute('data-qa');
  if (qa) return `${element.tagName.toLowerCase()}[data-qa="${qa}"]`;
  const classes = [...element.classList].slice(0, 3).map((c) => `.${c}`).join('');
  return element.tagName.toLowerCase() + classes;
}

/**
 * The chain from the picked element up to the client, so a colour that comes
 * from a parent can be reached. Slack nests a dozen deep and the background you
 * are looking at is rarely on the node under the pointer.
 */
export function ancestry(element, depth = 6) {
  const chain = [];
  let node = element;
  while (node && node.nodeType === 1 && chain.length < depth) {
    chain.push(node);
    if (node.classList.contains('p-client_container')) break;
    node = node.parentElement;
  }
  return chain;
}

/**
 * Attach the picker to a document: highlight what is under the pointer, resolve
 * on click, cancel on Escape.
 *
 * Everything is bound in the capture phase, so choosing a channel row does not
 * also open that channel -- Slack's own handlers never see the click.
 */
export function pickElement(doc, overlay) {
  return new Promise((resolve) => {
    const move = (event) => {
      const rect = event.target?.getBoundingClientRect?.();
      if (!rect) return;
      Object.assign(overlay.style, {
        display: 'block',
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
    };
    const finish = (element) => {
      doc.removeEventListener('mousemove', move, true);
      doc.removeEventListener('click', click, true);
      doc.removeEventListener('keydown', key, true);
      overlay.style.display = 'none';
      resolve(element);
    };
    const click = (event) => {
      event.preventDefault();
      event.stopPropagation();
      finish(event.target);
    };
    const key = (event) => {
      if (event.key === 'Escape') finish(null);
    };

    doc.addEventListener('mousemove', move, true);
    doc.addEventListener('click', click, true);
    doc.addEventListener('keydown', key, true);
  });
}
