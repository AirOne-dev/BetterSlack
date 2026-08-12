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
 * The avatar's wrapper inside that strip. Inserting before it puts SlackMod
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

/** Sliders, drawn in Slack's icon idiom: 20x20 box, currentColor. */
const ICON = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true" data-qa="slackmod-sliders">
  <path fill="currentColor" d="M2.75 6.25h3.1a.75.75 0 0 1 0 1.5h-3.1a.75.75 0 0 1 0-1.5Zm8.9 0h5.6a.75.75 0 0 1 0 1.5h-5.6a.75.75 0 0 1 0-1.5Z"/>
  <path fill="currentColor" d="M2.75 12.25h5.6a.75.75 0 0 1 0 1.5h-5.6a.75.75 0 0 1 0-1.5Zm11.4 0h3.1a.75.75 0 0 1 0 1.5h-3.1a.75.75 0 0 1 0-1.5Z"/>
  <path fill="currentColor" fill-rule="evenodd" d="M8.75 4.75a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5Zm-.75 2.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0Z" clip-rule="evenodd"/>
  <path fill="currentColor" fill-rule="evenodd" d="M11.25 10.75a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5Zm-.75 2.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0Z" clip-rule="evenodd"/>
</svg>`;

export interface LauncherOptions {
  onActivate: () => void;
  styles: StyleManager;
}

export function installLauncher({ onActivate, styles }: LauncherOptions): Cleanup {
  styles.set('plugin', '__launcher', LAUNCHER_CSS);

  const shortcut = navigator.platform.startsWith('Mac') ? '⌘⇧M' : 'Ctrl+Shift+M';

  const makeButton = (className: string, placement: 'right' | 'top') => {
    const button = h('button', {
      class: `${className} slackmod-launcher`,
      type: 'button',
      'aria-label': 'SlackMod',
      'data-qa': 'slackmod_button',
    });
    button.innerHTML = ICON;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onActivate();
    });
    // Slack's tooltips are React portals we cannot register with, so this
    // rebuilds one from Slack's own tooltip classes. Same look, same 1s delay.
    attachTooltip(button, {
      title: 'SlackMod',
      subtitle: `Thèmes, plugins et CSS personnalisé. ${shortcut}`,
      placement,
    });
    return button;
  };

  const unmountStrip = keepMounted(
    CONTROL_STRIP,
    'slackmod-control-button',
    () => makeButton(BUTTON_CLASS, 'right'),
    { before: AVATAR_WRAPPER },
  );

  // Only used if Slack has no control strip; keepMounted does nothing while its
  // container is absent, so both can be registered without conflicting.
  const unmountRail = keepMounted(
    RAIL_FALLBACK,
    'slackmod-rail-button',
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
