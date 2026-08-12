// Runtime entry point, injected into the Slack renderer by the loader.
//
// This file runs at document-start on every navigation, so it must be cheap and
// it must never assume the DOM is ready.

import { ModManager, type BootPayload } from './manager.js';
import { Bridge } from './rpc.js';
import { installLauncher } from './ui/launcher.js';
import { Panel } from './ui/panel.js';

declare global {
  interface Window {
    __SLACKMOD_BOOT__?: BootPayload;
    __slackmod?: SlackModGlobal;
  }
}

interface SlackModGlobal {
  version: string;
  /** Which loader run created this instance. */
  sessionId: string;
  manager: ModManager;
  panel: Panel;
  open(): void;
  close(): void;
  dispose(): Promise<void>;
}

async function boot(): Promise<void> {
  const payload = window.__SLACKMOD_BOOT__;
  if (!payload) return;

  const existing = window.__slackmod;
  if (existing) {
    // Same loader run injecting twice into one document: nothing to do, and
    // going further would double every observer.
    if (existing.sessionId === payload.info.sessionId) return;
    // A different run: the old instance's bridge is dead and its settings are
    // stale, so it has to go before the new one starts.
    await existing.dispose().catch((err) => {
      console.warn('[slackmod] could not dispose the previous runtime', err);
    });
    delete window.__slackmod;
  }

  const bridge = new Bridge();
  const manager = new ModManager(bridge, payload);

  // Themes are pure CSS and can go in before the DOM exists, which is what
  // keeps Slack from flashing its default palette on the way up.
  await manager.applyInitial();

  const panel = new Panel(manager);

  let unmountUi: (() => void) | undefined;
  const mountUi = () => {
    unmountUi = installLauncher({ onActivate: () => panel.toggle(), styles: manager.styles });
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountUi, { once: true });
  } else {
    mountUi();
  }

  window.__slackmod = {
    version: payload.version,
    sessionId: payload.info.sessionId,
    manager,
    panel,
    open: () => panel.open(),
    close: () => panel.close(),
    dispose: async () => {
      panel.close();
      unmountUi?.();
      await manager.dispose();
    },
  };

  console.log(
    `%c SlackMod ${payload.version} %c ${payload.settings.enabled.length} mod(s) active — ⌘⇧M `,
    'background:#611f69;color:#fff;border-radius:3px 0 0 3px;padding:2px 4px',
    'background:#222;color:#ddd;border-radius:0 3px 3px 0;padding:2px 4px',
  );
}

void boot().catch((err) => {
  console.error('[slackmod] boot failed', err);
});
