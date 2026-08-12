/**
 * DevTools — opens Slack's real Chrome DevTools from a button.
 *
 * HOW THIS REACHES THE MAIN PROCESS
 *
 * Slack's preload exposes `desktop.app.toggleDevTools()`, which posts to the
 * TOGGLE_DEV_TOOLS IPC channel. The main process dispatches the same action its
 * hidden ⌘⌥I menu item does, and `openDevToolsEpic` calls
 * `openDevTools({mode:'undocked'})` on the focused webContents. These are
 * Slack's own DevTools, not a reimplementation.
 *
 * Confirmed in Slack's own log (~/Library/Application Support/Slack/logs):
 *
 *   info: Store: TOGGLE_DEV_TOOLS
 *   info: openDevToolsEpic: Received action { willClose: false, willOpen: true }
 *
 * Do not reach for `desktop.redux.dispatchUpdate` here. It looks like a generic
 * action forwarder and is not: it wraps whatever you pass as the *payload* of a
 * REDUX_UPDATE_FROM_WEBAPP action whose reducer only reads `payload.teams`, so
 * a toggle sent that way is silently dropped.
 *
 * Two conditions, both measured rather than guessed:
 *
 *   1. `settings.devToolsEnabled` must be true, or the toggle never reaches the
 *      main process at all — no IPC, nothing in the log. It does NOT persist
 *      across launches, so it has to be set every session, not once. Dropping
 *      this line is what made the button silently do nothing:
 *
 *          toggleDevTools()                    -> nothing in Slack's log
 *          setPreference(...) + toggleDevTools -> openDevToolsEpic runs
 *
 *   2. The epic only acts on a *focused* webContents, so the call does nothing
 *      while Slack is in the background. Clicking a button inside Slack
 *      satisfies that by construction.
 */

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true">
  <path fill="currentColor" fill-rule="evenodd" d="M3.75 3.5A1.75 1.75 0 0 0 2 5.25v9.5c0 .97.78 1.75 1.75 1.75h12.5A1.75 1.75 0 0 0 18 14.75v-9.5A1.75 1.75 0 0 0 16.25 3.5H3.75Zm-.25 1.75a.25.25 0 0 1 .25-.25h12.5a.25.25 0 0 1 .25.25V7h-13V5.25ZM3.5 8.5v6.25c0 .14.11.25.25.25h12.5a.25.25 0 0 0 .25-.25V8.5h-13Z" clip-rule="evenodd"/>
  <path fill="currentColor" d="M5.7 10.2a.75.75 0 0 1 1.06 0l1.5 1.5a.75.75 0 0 1 0 1.06l-1.5 1.5a.75.75 0 1 1-1.06-1.06l.97-.97-.97-.97a.75.75 0 0 1 0-1.06Zm4.05 2.55a.75.75 0 0 0 0 1.5h3a.75.75 0 0 0 0-1.5h-3Z"/>
</svg>`;

export const PREFERENCE = 'devToolsEnabled';

/**
 * Turn on the setting the toggle is gated behind. Safe to call repeatedly, and
 * done at start-up so the preference has travelled by the time anyone clicks.
 *
 * @param {any} bridge window.desktop
 */
export function enableDevTools(bridge) {
  if (typeof bridge?.app?.setPreference !== 'function') return false;
  if (bridge.app.getPreference?.(PREFERENCE) === true) return true;
  bridge.app.setPreference({ name: PREFERENCE, value: true });
  return true;
}

/**
 * Toggle Slack's DevTools. Split out so it can be tested without a Slack window.
 *
 * @param {any} bridge window.desktop
 */
export async function toggleDevTools(bridge) {
  if (typeof bridge?.app?.toggleDevTools !== 'function') {
    throw new Error('Slack’s desktop bridge is not available in this window');
  }
  if (bridge.app.getPreference?.(PREFERENCE) !== true) {
    // The preference travels to the main process by IPC; toggling in the same
    // tick would race it and be dropped.
    enableDevTools(bridge);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  bridge.app.toggleDevTools();
}

export default {
  /**
   * @param {import('../../../src/runtime/api.js').PluginApi} api
   */
  start(api) {
    // Ask for the preference up front, so the first click is not the one that
    // has to wait for it.
    enableDevTools(window.desktop);

    api.slack.addToolbarButton('controlStrip', {
      id: 'devtools',
      label: 'DevTools',
      description: 'Open or close Slack’s developer tools',
      icon: ICON,
      // Both this and SlackMod's button anchor on the avatar; without an
      // explicit anchor this one would land underneath it.
      before: '#slackmod-control-button',
      onClick: () => {
        toggleDevTools(window.desktop).catch((err) => {
          api.log.error(err);
          api.ui.toast(err.message, { variant: 'error' });
        });
      },
    });
  },

  stop() {},
};
