// Ways to open the panel: a button in Slack's control strip, and a keyboard
// shortcut that works even if Slack rearranges its chrome.

import { h, keepMounted, onShortcut, type Cleanup } from '../dom.js';
import { LAUNCHER_CSS } from './styles.js';
import { attachTooltip } from './tooltip.js';
import type { StyleManager } from '../themes.js';

/**
 * The vertical strip at the bottom of the rail holding "Créer un nouveau", the
 * focus-mode moon and the profile avatar. `role="toolbar"`, so a button is what
 * belongs here.
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
 * BetterDiscord's idiom: a solid rounded square with the monogram knocked out
 * of it, rather than a line drawing. That is deliberate here too -- it sits in
 * a strip of Slack's own outline icons, and the one button that is not Slack's
 * should not pretend to be.
 *
 * Drawn as a single even-odd path so the counter shapes inside the B are holes
 * rather than a second colour: it takes `currentColor` from whatever strip it
 * lands in, and follows every theme with no work.
 */
const ICON = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true" data-qa="betterslack-mark">
  <path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M5 1.5h10A3.5 3.5 0 0 1 18.5 5v10a3.5 3.5 0 0 1-3.5 3.5H5A3.5 3.5 0 0 1 1.5 15V5A3.5 3.5 0 0 1 5 1.5Zm1.75 3.75a.75.75 0 0 0-.75.75v8a.75.75 0 0 0 .75.75h3.4a3.1 3.1 0 0 0 1.86-5.58 2.85 2.85 0 0 0-1.98-3.92H6.75Zm.75 1.5v2.5h2.4a1.25 1.25 0 0 0 0-2.5H7.5Zm0 4v3h2.65a1.5 1.5 0 0 0 0-3H7.5Z"/>
</svg>`;

export interface LauncherOptions {
  onActivate: () => void;
  styles: StyleManager;
  /** Something to be told about, drawn as a dot on the button. */
  badge?: () => number;
  /** Called with a repaint function, so the badge can follow a later answer. */
  onBadgeChange?: (repaint: () => void) => void;
  /** Opened with the palette shortcut. */
  onPalette?: () => void;
  /** Which shortcut that is; `mod+k` takes the key Slack uses for its own. */
  paletteShortcut?: 'mod+k' | 'mod+shift+k';
}

export function installLauncher(
  { onActivate, styles, badge, onBadgeChange, onPalette, paletteShortcut = 'mod+k' }: LauncherOptions,
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

  /*
   * Cmd+K for the palette, which is also what Slack binds to its own quick
   * switcher.
   *
   * Taking it is a real trade and it is deliberate: ⌘K is the key everyone
   * reaches for, and a palette on a key nobody presses is a palette nobody
   * uses. Slack's switcher stays reachable from its own search field, and the
   * About tab has a switch for anyone who wants ⌘K back.
   *
   * The event has to be stopped in the capture phase, before Slack's own
   * handler sees it, or both open at once.
   */
  const wantsShift = paletteShortcut === 'mod+shift+k';
  const unbindPalette = onPalette
    ? onShortcut(
      (event) =>
        (event.metaKey || event.ctrlKey)
        && !event.altKey
        && event.shiftKey === wantsShift
        && event.code === 'KeyK',
      onPalette,
    )
    : () => {};

  return () => {
    unmountStrip();
    unmountRail();
    unbindShortcut();
    unbindPalette();
    styles.remove('plugin', '__launcher');
  };
}
