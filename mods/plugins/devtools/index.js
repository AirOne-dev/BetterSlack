/**
 * DevTools — opens Slack's real Chrome DevTools from a button.
 *
 * HOW THIS REACHES THE MAIN PROCESS
 *
 * Slack has a hidden menu item, "Toggle DevTools" (⌘⌥I), that only appears
 * once the developer menu is on. Clicking it dispatches `TOGGLE_DEV_TOOLS` to
 * the main-process store, where an epic calls `openDevTools({mode:'undocked'})`
 * on the focused webContents.
 *
 * Slack's preload exposes that same store: `desktop.redux.dispatchUpdate(action)`
 * forwards an FSA-compliant action over IPC to the main process. So this button
 * dispatches exactly what the menu item dispatches — it is Slack's own DevTools,
 * not a reimplementation.
 *
 * Two conditions, both read straight out of Slack's bundle:
 *
 *   1. The epic is gated on `settings.devToolsEnabled`. Setting the env var
 *      SLACK_DEVELOPER_MENU only reveals the menu; it does not satisfy this.
 *      `desktop.app.setPreference` flips it, and it persists, so this happens
 *      once and then never again.
 *   2. The epic only acts on a *focused* webContents. Clicking a button inside
 *      Slack means Slack is focused, so this is satisfied by construction —
 *      but it is why the same call does nothing when Slack is in the
 *      background, which is worth knowing if you ever script it.
 */

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true">
  <path fill="currentColor" fill-rule="evenodd" d="M3.75 3.5A1.75 1.75 0 0 0 2 5.25v9.5c0 .97.78 1.75 1.75 1.75h12.5A1.75 1.75 0 0 0 18 14.75v-9.5A1.75 1.75 0 0 0 16.25 3.5H3.75Zm-.25 1.75a.25.25 0 0 1 .25-.25h12.5a.25.25 0 0 1 .25.25V7h-13V5.25ZM3.5 8.5v6.25c0 .14.11.25.25.25h12.5a.25.25 0 0 0 .25-.25V8.5h-13Z" clip-rule="evenodd"/>
  <path fill="currentColor" d="M5.7 10.2a.75.75 0 0 1 1.06 0l1.5 1.5a.75.75 0 0 1 0 1.06l-1.5 1.5a.75.75 0 1 1-1.06-1.06l.97-.97-.97-.97a.75.75 0 0 1 0-1.06Zm4.05 2.55a.75.75 0 0 0 0 1.5h3a.75.75 0 0 0 0-1.5h-3Z"/>
</svg>`;

/** Slack's action type, taken from its own bundle. */
export const TOGGLE_ACTION = { type: 'TOGGLE_DEV_TOOLS' };
export const PREFERENCE = 'devToolsEnabled';

/**
 * Enable the setting the toggle epic is gated on, then dispatch the toggle.
 * Split out so it can be tested without a Slack window.
 *
 * @param {any} bridge window.desktop
 */
export function toggleDevTools(bridge) {
  if (!bridge?.redux?.dispatchUpdate) {
    throw new Error('Slack’s desktop bridge is not available in this window');
  }
  if (bridge.app?.getPreference?.(PREFERENCE) !== true) {
    bridge.app?.setPreference?.({ name: PREFERENCE, value: true });
  }
  bridge.redux.dispatchUpdate(TOGGLE_ACTION);
}

export default {
  /**
   * @param {import('../../../src/runtime/api.js').PluginApi} api
   */
  start(api) {
    api.slack.addToolbarButton('controlStrip', {
      id: 'devtools',
      label: 'DevTools',
      description: 'Open or close Slack’s developer tools',
      icon: ICON,
      // Both this and SlackMod's button anchor on the avatar; without an
      // explicit anchor this one would land underneath it.
      before: '#slackmod-control-button',
      onClick: () => {
        try {
          toggleDevTools(window.desktop);
        } catch (err) {
          api.log.error(err);
          api.ui.toast(err.message, { variant: 'error' });
        }
      },
    });
  },

  stop() {},
};
