// Runtime entry point, injected into the Slack renderer by the loader.
//
// This file runs at document-start on every navigation, so it must be cheap and
// it must never assume the DOM is ready.

import { ModManager, type BootPayload } from './manager.js';
import { Bridge } from './rpc.js';
import { installLauncher } from './ui/launcher.js';
import { openPalette, closePalette, isPaletteOpen, type Command } from './ui/palette.js';
import { PANEL_CSS } from './ui/styles.js';
import { PANEL_STRINGS } from './ui/strings.js';
import { createI18n } from './i18n.js';
import { Panel } from './ui/panel.js';

declare global {
  interface Window {
    __BETTERSLACK_BOOT__?: BootPayload;
    __betterslack?: BetterSlackGlobal;
  }
}

declare global {
  interface Window {
    /** Set synchronously by whichever boot got here first. See boot(). */
    __BETTERSLACK_BOOTING__?: string;
  }
}

/** What `health()` answers: enough to say whether this run is sound. */
export interface Health {
  version: string;
  safeMode: boolean;
  /** Mods the settings say should be on. */
  enabled: string[];
  /** Plugins actually loaded, and stylesheets actually attached. */
  applied: string[];
  /** Mods that would not start, with why. */
  errors: Array<[string, string]>;
  /** Whether the panel's own button made it into Slack's chrome. */
  launcher: boolean;
}

interface BetterSlackGlobal {
  version: string;
  /** Which loader run created this instance. */
  sessionId: string;
  manager: ModManager;
  panel: Panel;
  open(): void;
  close(): void;
  dispose(): Promise<void>;
  /**
   * A summary of this run, for the live test and the watchdog.
   *
   * Deliberately on the global rather than behind the bridge: the point is to
   * be answerable from outside, over CDP, when something has gone wrong enough
   * that the bridge may not be moving.
   */
  health(): Health;
}

async function boot(): Promise<void> {
  const payload = window.__BETTERSLACK_BOOT__;
  if (!payload) return;

  /*
   * Claim the document before anything is awaited.
   *
   * `window.__betterslack` is only assigned at the *end* of this function, so two
   * boots that overlap -- the document-start script and the loader injecting
   * into the same live page, which is exactly what happens when a navigation
   * is caught mid-flight -- both find it empty, both build a Bridge, and both
   * start every plugin. The second Bridge overwrites the receiver on `window`,
   * and the first runtime's plugins are left holding a dead one: every request
   * they make is answered into a Map nobody reads, and times out fifteen
   * seconds later. Their buttons are still on screen, so the app looks fine
   * until something asks the loader a question.
   *
   * Found by way of a theme gallery that came up blank: six answers delivered
   * by the loader, six timeouts in the page.
   */
  if (window.__BETTERSLACK_BOOTING__ === payload.info.sessionId) return;
  window.__BETTERSLACK_BOOTING__ = payload.info.sessionId;

  const existing = window.__betterslack;
  if (existing) {
    // Same loader run injecting twice into one document: nothing to do, and
    // going further would double every observer.
    if (existing.sessionId === payload.info.sessionId) return;
    // A different run: the old instance's bridge is dead and its settings are
    // stale, so it has to go before the new one starts.
    await existing.dispose().catch((err) => {
      console.warn('[betterslack] could not dispose the previous runtime', err);
    });
    delete window.__betterslack;
  }

  const t = createI18n().strings(PANEL_STRINGS);
  const bridge = new Bridge();
  const manager = new ModManager(bridge, payload);

  // Themes are pure CSS and can go in before the DOM exists, which is what
  // keeps Slack from flashing its default palette on the way up.
  await manager.applyInitial();

  // The panel renders into the light DOM with Slack's own classes, so its
  // stylesheet is a normal layer rather than something scoped to a shadow root.
  manager.styles.set('plugin', '__panel', PANEL_CSS);
  const panel = new Panel(manager);

  /**
   * Everything the palette can offer: the panel's own actions, every installed
   * mod as a switch, and whatever the mods registered themselves.
   */
  const commands = (): Command[] => {
    const settings = manager.getSettings();
    const builtin: Command[] = [
      { id: 'panel:open', title: t('paletteOpenPanel'), source: 'BetterSlack', run: () => panel.open() },
    ];
    for (const mod of manager.list()) {
      if (!settings.installed.includes(mod.id)) continue;
      const on = manager.isEnabled(mod.id);
      builtin.push({
        id: `mod:${mod.id}`,
        title: `${on ? t('paletteDisable') : t('paletteEnable')} ${mod.name}`,
        source: mod.type === 'theme' ? t('themes') : t('plugins'),
        run: () => void manager.setEnabled(mod.id, !on),
      });
    }
    return [...manager.commands.values(), ...builtin];
  };

  const togglePalette = () => {
    if (isPaletteOpen()) closePalette();
    else openPalette(commands(), { placeholder: t('paletteSearch'), empty: t('paletteEmpty') });
  };

  let unmountUi: (() => void) | undefined;
  const mountUi = () => {
    unmountUi = installLauncher({
      onActivate: () => panel.toggle(),
      styles: manager.styles,
      // One thing to be told about: a version behind the one on GitHub. The
      // answer arrives after boot, so the button is repainted rather than
      // rebuilt when it does.
      badge: () => (manager.update?.behind ? 1 : 0),
      onBadgeChange: (repaint) => manager.onChange(repaint),
      onPalette: togglePalette,
    });
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountUi, { once: true });
  } else {
    mountUi();
  }

  window.__betterslack = {
    version: payload.version,
    sessionId: payload.info.sessionId,
    manager,
    panel,
    open: () => panel.open(),
    close: () => panel.close(),
    health: () => ({
      version: payload.version,
      safeMode: payload.info.safeMode === true,
      enabled: [...manager.getSettings().enabled],
      applied: [
        ...manager.loadedPluginIds(),
        ...manager.getSettings().enabled.filter((id) => manager.styles.has('theme', id)),
      ],
      errors: [...manager.errors.entries()],
      launcher: Boolean(document.getElementById('betterslack-control-button')),
    }),
    dispose: async () => {
      panel.close();
      unmountUi?.();
      await manager.dispose();
    },
  };

  // The loader clears its crash marker on this. Sent after everything above,
  // so "up" means the panel exists and the mods have had their turn.
  bridge.notify({ type: 'app.ready' });

  console.log(
    `%c BetterSlack ${payload.version} %c ${payload.settings.enabled.length} mod(s) active — ⌘⇧M `,
    'background:#611f69;color:#fff;border-radius:3px 0 0 3px;padding:2px 4px',
    'background:#222;color:#ddd;border-radius:0 3px 3px 0;padding:2px 4px',
  );
}

void boot().catch((err) => {
  // Let the next attempt through: a boot that threw owns nothing.
  delete window.__BETTERSLACK_BOOTING__;
  console.error('[betterslack] boot failed', err);
});
