// Slack's overflow menu, for anything that needs one.
//
// Inside the client this is the one component worth borrowing rather than
// drawing: `c-menu`, `c-menu__items`, `c-menu_item__button` and friends carry
// Slack's size, radius, hover, focus ring and -- most usefully -- follow every
// theme, including one a mod is in the middle of editing.
//
// Two mods and the Mods panel had each rebuilt it, which is two too many. The
// positioning is the part nobody gets right the first time: `.c-popover__content`
// pins `top` in Slack's stylesheet, so the positioned layer has to be ours and
// only the menu inside can wear Slack's classes.

import { h, type Cleanup } from '../dom.js';

const LAYER_ID = 'betterslack-menu-layer';
const MARGIN = 8;

export interface MenuItem {
  label: string;
  onSelect: () => void;
  /** Red, for the one that cannot be undone. */
  danger?: boolean;
  /** Shown but not selectable. */
  disabled?: boolean;
  /** Optional SVG, drawn before the label the way Slack does. */
  icon?: string;
}

export interface MenuOptions {
  /** Which corner to line up with the anchor. Defaults to the left edge. */
  align?: 'left' | 'right';
  onClose?: () => void;
}

/** Take down whatever menu is open, if any. */
export function closeMenu(): void {
  document.getElementById(LAYER_ID)?.remove();
}

/**
 * Open a menu against an anchor.
 *
 * One menu exists at a time -- opening a second closes the first, which is what
 * Slack does and what anyone clicking two overflow buttons in a row expects.
 * Returns a cleanup, so a plugin being switched off takes its menu with it.
 */
export function openMenu(anchor: HTMLElement, items: MenuItem[], options: MenuOptions = {}): Cleanup {
  closeMenu();

  // Captured, not re-read: the listeners are attached on the next tick, and by
  // then the caller may be gone -- a test that has torn its DOM down, a plugin
  // that was switched off between the click and the tick.
  const doc = anchor.ownerDocument;
  let arming: ReturnType<typeof setTimeout> | undefined;

  const close = () => {
    clearTimeout(arming);
    doc.removeEventListener('mousedown', onDown as EventListener, true);
    doc.removeEventListener('keydown', onKey as EventListener, true);
    doc.getElementById(LAYER_ID)?.remove();
    options.onClose?.();
  };

  const onDown = (event: MouseEvent) => {
    const layer = doc.getElementById(LAYER_ID);
    if (layer && !layer.contains(event.target as Node)) close();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close();
  };

  const list = h('div', { class: 'c-menu__items', role: 'menu', tabindex: '-1' });
  for (const item of items) {
    const button = h('button', {
      class: 'c-button-unstyled c-menu_item__button',
      role: 'menuitem',
      type: 'button',
      ...(item.disabled ? { disabled: 'disabled', 'aria-disabled': 'true' } : {}),
    }, [
      item.icon ? h('span', { class: 'c-menu_item__icon' }) : null,
      h('div', { class: `c-menu_item__label${item.danger ? ' betterslack-danger' : ''}` }, [item.label]),
    ].filter(Boolean) as Node[]);
    if (item.icon) {
      const icon = button.querySelector('.c-menu_item__icon');
      if (icon) icon.innerHTML = item.icon;
    }
    if (!item.disabled) {
      button.addEventListener('click', () => {
        close();
        item.onSelect();
      });
    }
    list.append(h('div', { class: 'c-menu_item__li', 'data-qa': 'menu_item_button-wrapper' }, [button]));
  }

  const layer = h('div', { id: LAYER_ID, class: 'betterslack-menu_layer' }, [
    h('div', { class: 'c-menu' }, [h('div', { class: 'c-menu__items_scroller' }, [list])]),
  ]);
  doc.body.append(layer);

  const view = doc.defaultView ?? window;
  const rect = anchor.getBoundingClientRect();
  const { width, height } = layer.getBoundingClientRect();
  const edge = options.align === 'left' ? rect.left : rect.right - width;
  const left = Math.max(MARGIN, Math.min(edge, view.innerWidth - width - MARGIN));
  // Flipped above the anchor when there is no room below, which is where a
  // control strip at the bottom of the rail always puts it.
  const top = rect.bottom + height > view.innerHeight ? rect.top - height - 4 : rect.bottom + 4;
  layer.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;

  // Next tick: the click that opened this one is still travelling.
  arming = setTimeout(() => {
    doc.addEventListener('mousedown', onDown as EventListener, true);
    doc.addEventListener('keydown', onKey as EventListener, true);
  }, 0);

  return close;
}
