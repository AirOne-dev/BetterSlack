// Slack's design system, rebuilt for a window Slack's stylesheet cannot reach.
//
// The builder runs in its own document, so none of `.c-button`, `.c-dialog` or
// any of the rest is available -- unlike the Mods panel, which lives in the
// client and borrows them directly. Everything here is therefore a deliberate
// copy of a control Slack already has, measured off the app: the 36px button
// with its 4px radius, the input that grows a blue ring on focus, the
// preferences rail, the card with its 8px radius and hairline border.
//
// Copies drift, which is the cost. It is paid once, here, rather than in every
// view: nothing below this line writes a colour or a padding by hand.

/** Build the primitives against one document. */
export function createUi(doc) {
  const el = (tag, props = {}, children = []) => {
    const node = doc.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null) continue;
      if (key === 'class') node.className = value;
      else if (key === 'html') node.innerHTML = value;
      else if (key.includes('-')) node.setAttribute(key, value);
      else node[key] = value;
    }
    for (const child of children) {
      if (child === null || child === undefined || child === false) continue;
      node.append(typeof child === 'string' ? doc.createTextNode(child) : child);
    }
    return node;
  };

  /**
   * Slack's button, in its three weights.
   *
   * `primary` is Slack's confirm green rather than its brand aubergine: in the
   * app, aubergine is chrome and green is what you press.
   */
  const button = (label, { variant = 'default', icon, onClick, title, wide, onHover } = {}) => {
    const node = el('button', { class: `btn btn--${variant}`, title, type: 'button' }, [
      icon ? el('span', { class: 'btn__icon', html: icon }) : null,
      el('span', { textContent: label }),
    ]);
    if (wide) node.classList.add('btn--wide');
    if (onClick) node.addEventListener('click', onClick);
    if (onHover) hoverable(node, onHover);
    return node;
  };

  /** A quiet square button holding nothing but a glyph. */
  const iconButton = (glyph, { onClick, title, danger } = {}) => {
    const node = el('button', {
      class: `icon-btn${danger ? ' icon-btn--danger' : ''}`,
      title,
      type: 'button',
      'aria-label': title ?? '',
      html: glyph,
    });
    if (onClick) node.addEventListener('click', onClick);
    return node;
  };

  /**
   * Run something while the pointer is over a node, and undo it when it leaves.
   *
   * Bound on focus as well: the highlight is information, and information that
   * only exists for a mouse is information a keyboard cannot have.
   */
  const hoverable = (node, { enter, leave }) => {
    node.addEventListener('mouseenter', enter);
    node.addEventListener('focus', enter);
    node.addEventListener('mouseleave', leave);
    node.addEventListener('blur', leave);
    return node;
  };

  /** Label, control, and the sentence under it that explains the control. */
  const field = (label, control, hint) =>
    el('div', { class: 'field' }, [
      el('label', { class: 'field__label', textContent: label }),
      control,
      hint ? el('p', { class: 'field__hint', textContent: hint }) : null,
    ]);

  const input = (props = {}) => el('input', { class: 'input', type: 'text', spellcheck: false, ...props });

  const select = (options, { onChange, title } = {}) => {
    const node = el('select', { class: 'input select', title });
    for (const option of options) {
      node.append(el('option', { value: option.value, textContent: option.label }));
    }
    if (onChange) node.addEventListener('change', () => onChange(node.value));
    return node;
  };

  /**
   * Slack's segmented control: a row of tabs that behaves like a select and
   * reads like a filter. Returns { node, value, set }.
   */
  const segmented = (options, { onChange } = {}) => {
    const node = el('div', { class: 'segmented', role: 'tablist' });
    let value = options[0]?.value ?? '';
    const buttons = new Map();
    const set = (next) => {
      value = next;
      for (const [key, item] of buttons) item.setAttribute('aria-selected', String(key === next));
    };
    for (const option of options) {
      const item = el('button', {
        class: 'segmented__item',
        type: 'button',
        role: 'tab',
        title: option.title,
      }, [
        el('span', { textContent: option.label }),
        option.count === undefined ? null : el('em', { textContent: String(option.count) }),
      ]);
      item.addEventListener('click', () => { set(option.value); onChange?.(option.value); });
      buttons.set(option.value, item);
      node.append(item);
    }
    set(value);
    return { node, set, value: () => value };
  };

  /** A titled block. Everything in a view lives in one of these. */
  const card = (title, children, { actions, subtitle } = {}) =>
    el('section', { class: 'card' }, [
      title
        ? el('header', { class: 'card__head' }, [
          el('div', {}, [
            el('h2', { textContent: title }),
            subtitle ? el('p', { textContent: subtitle }) : null,
          ]),
          actions ? el('div', { class: 'card__actions' }, actions) : null,
        ])
        : null,
      el('div', { class: 'card__body' }, children),
    ]);

  /** What a view shows before it has anything to show. */
  const emptyState = (title, body, action) =>
    el('div', { class: 'empty' }, [
      el('h3', { textContent: title }),
      el('p', { textContent: body }),
      action ?? null,
    ]);

  /** The checkerboard, so a translucent colour reads as translucent. */
  const CHECKER =
    'linear-gradient(45deg,rgba(0,0,0,.28) 25%,transparent 25%),' +
    'linear-gradient(-45deg,rgba(0,0,0,.28) 25%,transparent 25%),' +
    'linear-gradient(45deg,transparent 75%,rgba(0,0,0,.28) 75%),' +
    'linear-gradient(-45deg,transparent 75%,rgba(0,0,0,.28) 75%)';

  const swatch = (css, { size = 'md' } = {}) => {
    const node = el('span', { class: `swatch swatch--${size}` });
    node.style.backgroundImage = `linear-gradient(${css}, ${css}), ${CHECKER}`;
    return node;
  };

  /**
   * A popover anchored to whatever was clicked.
   *
   * Anchoring rather than docking is the difference between a tool and a form:
   * the editor appears next to the colour it edits, and the colour stays in
   * view while it changes. Kept inside the window by flipping when it would
   * hang off the bottom.
   */
  const popover = (content, anchor, { onClose } = {}) => {
    const node = el('div', { class: 'popover' }, [content]);
    doc.body.append(node);

    const place = () => {
      const box = anchor.getBoundingClientRect();
      const own = node.getBoundingClientRect();
      const margin = 8;
      let top = box.bottom + 6;
      if (top + own.height > doc.documentElement.clientHeight - margin) {
        top = Math.max(margin, box.top - own.height - 6);
      }
      let left = box.left;
      if (left + own.width > doc.documentElement.clientWidth - margin) {
        left = Math.max(margin, doc.documentElement.clientWidth - own.width - margin);
      }
      node.style.top = `${top}px`;
      node.style.left = `${left}px`;
    };
    place();

    const close = () => {
      doc.removeEventListener('mousedown', outside, true);
      doc.removeEventListener('keydown', escape, true);
      doc.defaultView.removeEventListener('resize', place);
      node.remove();
      onClose?.();
    };
    const outside = (event) => {
      if (!node.contains(event.target) && !anchor.contains(event.target)) close();
    };
    const escape = (event) => { if (event.key === 'Escape') close(); };

    doc.addEventListener('mousedown', outside, true);
    doc.addEventListener('keydown', escape, true);
    doc.defaultView.addEventListener('resize', place);

    return { node, close, place };
  };

  /**
   * Slack's confirm dialog: a scrim, a card, cancel on the left of the action.
   *
   * Resolves false when dismissed, so a caller can await it and do nothing --
   * dismissing has to mean no, not "ask again".
   */
  const confirm = ({ title, body, action, cancel: cancelLabel, danger }) => new Promise((resolve) => {
    const scrim = el('div', { class: 'scrim' });
    const cancel = button(cancelLabel, { variant: 'ghost' });
    const go = button(action, { variant: danger ? 'danger' : 'primary' });
    const dialog = el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true' }, [
      el('h2', { textContent: title }),
      el('p', { textContent: body }),
      el('div', { class: 'dialog__actions' }, [cancel, go]),
    ]);
    scrim.append(dialog);
    doc.body.append(scrim);

    const close = (answer) => {
      doc.removeEventListener('keydown', key, true);
      scrim.remove();
      resolve(answer);
    };
    const key = (event) => { if (event.key === 'Escape') close(false); };
    cancel.addEventListener('click', () => close(false));
    go.addEventListener('click', () => close(true));
    scrim.addEventListener('mousedown', (event) => { if (event.target === scrim) close(false); });
    doc.addEventListener('keydown', key, true);
    go.focus();
  });

  /**
   * Copy, with the fallback that makes it work everywhere.
   *
   * The clipboard API needs the document to be focused, and this window loses
   * focus the moment anything is clicked in Slack. execCommand is deprecated
   * and still the only thing that always works here.
   */
  const copyText = async (text) => {
    try {
      await doc.defaultView.navigator.clipboard.writeText(text);
      return true;
    } catch {
      const scratch = el('textarea', { value: text });
      scratch.style.position = 'fixed';
      scratch.style.opacity = '0';
      doc.body.append(scratch);
      scratch.select();
      const done = doc.execCommand('copy');
      scratch.remove();
      return done;
    }
  };

  return {
    el, button, iconButton, field, input, select, segmented, card, emptyState,
    swatch, popover, confirm, copyText, hoverable, CHECKER,
  };
}
