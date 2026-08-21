// Ways to open the panel: a button in Slack's control strip, and a keyboard
// shortcut that works even if Slack rearranges its chrome.

import { h, keepMounted, onShortcut, type Cleanup } from '../dom.js';
import { LAUNCHER_CSS } from './styles.js';
import { MARK_SVG } from './mark.js';
import { attachTooltip } from './tooltip.js';
import type { StyleManager } from '../themes.js';

/**
 * The vertical strip at the bottom of the rail holding "Créer un nouveau" and
 * the profile avatar. `role="toolbar"`, so a button is what belongs here.
 */
const CONTROL_STRIP = '.p-control_strip';

/**
 * The avatar's wrapper inside that strip. Inserting before it puts BetterSlack
 * directly above the profile, where the user expects it.
 */
const AVATAR_WRAPPER = '.c-coachmark-anchor:has([data-qa="user-button"])';

/** Older layouts without a control strip: the tab rail's button list. */
const RAIL_FALLBACK = '[data-qa="tabs_full_width_class"]';

/**
 * Slack's own button class. Reusing it is the whole point: size, radius,
 * colour, hover, active and the 125ms cubic-bezier transition all come from
 * Slack, so the button cannot drift out of step with its neighbours the way a
 * hand-rolled one does.
 */
const BUTTON_CLASS = 'c-button-unstyled p-control_strip__circle_button';
const RAIL_BUTTON_CLASS =
  'c-button-unstyled c-icon_button c-icon_button--size_medium c-icon_button--default';

export interface LauncherOptions {
  onActivate: () => void;
  styles: StyleManager;
  /** Something to be told about, drawn as a dot on the button. */
  badge?: () => number;
  /** Called with a repaint function, so the badge can follow a later answer. */
  onBadgeChange?: (repaint: () => void) => void;
}

export function installLauncher(
  { onActivate, styles, badge, onBadgeChange }: LauncherOptions,
): Cleanup {
  styles.set('plugin', '__launcher', LAUNCHER_CSS);

  const shortcut = navigator.platform.startsWith('Mac') ? '⌘⇧M' : 'Ctrl+Shift+M';

  const buttons = new Set<HTMLElement>();

  /**
   * The count, on the button, in Slack's own badge shape.
   *
   * Repainted rather than rebuilt: the version check answers seconds after
   * boot, and remounting the button then would take it out from under a
   * pointer that is already on it.
   */
  const paintBadge = (button: HTMLElement) => {
    const count = badge?.() ?? 0;
    let dot = button.querySelector<HTMLElement>('.betterslack-launcher__badge');
    if (!count) {
      dot?.remove();
      button.removeAttribute('data-badged');
      return;
    }
    if (!dot) {
      dot = h('span', { class: 'betterslack-launcher__badge', 'aria-hidden': 'true' });
      button.append(dot);
    }
    dot.textContent = String(count);
    button.setAttribute('data-badged', 'true');
  };

  const makeButton = (className: string, placement: 'right' | 'top') => {
    const button = h('button', {
      class: `${className} betterslack-launcher`,
      type: 'button',
      'aria-label': 'BetterSlack',
      'data-qa': 'betterslack_button',
    });
    button.innerHTML = MARK_SVG;
    buttons.add(button);
    paintBadge(button);
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onActivate();
    });
    // Slack's tooltips are React portals we cannot register with, so this
    // rebuilds one from Slack's own tooltip classes. Same look, same 1s delay.
    attachTooltip(button, {
      title: 'BetterSlack',
      subtitle: `Thèmes, plugins et CSS personnalisé. ${shortcut}`,
      placement,
    });
    return button;
  };

  const unmountStrip = keepMounted(
    CONTROL_STRIP,
    'betterslack-control-button',
    () => makeButton(BUTTON_CLASS, 'right'),
    { before: AVATAR_WRAPPER },
  );

  // Only used if Slack has no control strip; keepMounted does nothing while its
  // container is absent, so both can be registered without conflicting.
  const unmountRail = keepMounted(
    RAIL_FALLBACK,
    'betterslack-rail-button',
    () => {
      if (document.querySelector(CONTROL_STRIP)) {
        // Signals "not wanted here": keepMounted still owns the node, and the
        // hidden attribute keeps it out of the layout and the a11y tree.
        const placeholder = h('div', { hidden: 'hidden' });
        return placeholder;
      }
      return h('div', { class: 'p-peek_trigger', role: 'none' }, [makeButton(RAIL_BUTTON_CLASS, 'right')]);
    },
  );

  onBadgeChange?.(() => {
    for (const button of buttons) {
      if (button.isConnected) paintBadge(button);
      else buttons.delete(button);
    }
  });

  // Cmd+Shift+M on macOS, Ctrl+Shift+M elsewhere.
  const unbindShortcut = onShortcut(
    (event) =>
      event.shiftKey && (event.metaKey || event.ctrlKey) && !event.altKey && event.code === 'KeyM',
    onActivate,
  );

  return () => {
    unmountStrip();
    unmountRail();
    unbindShortcut();
    styles.remove('plugin', '__launcher');
  };
}
