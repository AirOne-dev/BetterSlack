// Ways to open the panel: a button in Slack's control strip, and a keyboard
// shortcut that works even if Slack rearranges its chrome.

import { h, keepMounted, onShortcut, type Cleanup } from '../dom.js';
import { LAUNCHER_CSS } from './styles.js';
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

/*
 * The mark.
 *
 * The mark, in its own colours. It sits among Slack's own outline icons and the
 * one button that is not Slack's should not pretend to be -- and the four
 * colours are saturated enough to read on a light theme and a dark one, which a
 * single tint would not be.
 *
 * The trade-off is deliberate: with no single colour it cannot take
 * `currentColor` from the strip, so it cannot dim and brighten with the icons
 * beside it on hover. The opacity in LAUNCHER_CSS does that instead.
 */
const ICON = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 848 848" aria-hidden="true" data-qa="betterslack-mark">
  <rect x="139" y="289" width="121" height="421" rx="60.5" fill="#E01858"/>
  <path d="M288 499C288 465.587 315.087 438 348.5 438H410V499.5C410 532.913 382.413 560 349 560V560C315.587 560 288 532.413 288 499V499Z" fill="#E01858"/>
  <rect x="560" y="139" width="121" height="421" rx="60.5" transform="rotate(90 560 139)" fill="#30C0F0"/>
  <path d="M349 288C382.413 288 410 315.087 410 348.5L410 410L348.5 410C315.087 410 288 382.413 288 349V349C288 315.587 315.587 288 349 288V288Z" fill="#30C0F0"/>
  <rect x="709" y="560" width="121" height="421" rx="60.5" transform="rotate(-180 709 560)" fill="#28B078"/>
  <path d="M560 349C560 382.413 532.913 410 499.5 410L438 410L438 348.5C438 315.087 465.587 288 499 288V288C532.413 288 560 315.587 560 349V349Z" fill="#28B078"/>
  <rect x="288" y="710" width="121" height="421" rx="60.5" transform="rotate(-90 288 710)" fill="#E8B028"/>
  <path d="M499 560C465.587 560 438 532.913 438 499.5L438 438L499.5 438C532.913 438 560 465.587 560 499V499C560 532.413 532.413 560 499 560V560Z" fill="#E8B028"/>
</svg>`;

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
    button.innerHTML = ICON;
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
