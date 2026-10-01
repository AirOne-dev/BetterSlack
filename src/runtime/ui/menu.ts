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
    (doc.defaultView ?? window).removeEventListener('resize', place);
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
  /*
   * Placed against the anchor, and placed again when the window changes size.
   * A menu is fixed to the viewport while the anchor lives in a layout that
   * reflows -- a dialog recentres, a column narrows -- so without this a
   * resize left the menu where the anchor used to be. Found photographing
   * one: the screenshot recipe resizes the page, and the menu stayed behind.
   */
  const scroller = layer.querySelector<HTMLElement>('.c-menu__items_scroller');
  function place() {
    // Measured at full height: a cap from the last placing would understate it.
    if (scroller) scroller.style.maxHeight = '';
    const rect = anchor.getBoundingClientRect();
    const { width, height } = layer.getBoundingClientRect();
    const edge = options.align === 'left' ? rect.left : rect.right - width;
    const left = Math.max(MARGIN, Math.min(edge, view.innerWidth - width - MARGIN));
    /*
     * Below the anchor if it fits, above if that fits -- which is where a
     * control strip at the bottom of the rail always puts it -- and otherwise
     * on whichever side has more room, scrolling. A long list (a select of
     * fifteen sounds, say) fits on neither side of an anchor in the middle of a
     * dialog, and placed by the first two rules alone it opened off the bottom
     * of the window with its last items unreachable.
     */
    const below = view.innerHeight - rect.bottom - 4 - MARGIN;
    const above = rect.top - 4 - MARGIN;
    let top: number;
    if (height <= below) top = rect.bottom + 4;
    else if (height <= above) top = rect.top - height - 4;
    else {
      const room = Math.max(below, above);
      if (scroller) {
        scroller.style.maxHeight = `${Math.max(120, room)}px`;
        scroller.style.overflowY = 'auto';
      }
      const fitted = Math.min(height, Math.max(120, room));
      top = below >= above ? rect.bottom + 4 : rect.top - fitted - 4;
    }
    layer.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
  }
  place();
  view.addEventListener('resize', place);

  // Next tick: the click that opened this one is still travelling.
  arming = setTimeout(() => {
    doc.addEventListener('mousedown', onDown as EventListener, true);
    doc.addEventListener('keydown', onKey as EventListener, true);
  }, 0);

  return close;
}
