// Asking for the permission Slack's Dock tile needs.
//
// The loader puts BetterSlack's icon -- or the theme's -- on Slack.app just
// before launching it, and the Dock keeps that tile for the session. Writing
// into another app's bundle is App Management on macOS, which nothing can ask
// for with a prompt of its own: the user switches it on in System Settings. So
// this explains why, opens the right pane, and once they are back, tries again
// and offers the restart that shows the result -- the tile is read when Slack
// starts and not again.
//
// Asked once, at startup, and only when the loader says the icon was refused.
// The About tab offers it again for anyone who said later.

import { createI18n } from '../i18n.js';
import type { ModManager } from '../manager.js';
import { PANEL_STRINGS } from './strings.js';
import { confirm, toast } from './widgets.js';

let translator: ReturnType<ReturnType<typeof createI18n>['strings']> | null = null;
const t = (key: string, vars?: Record<string, string>): string => {
  translator ??= createI18n().strings(PANEL_STRINGS);
  return translator(key, vars);
};

/**
 * The whole conversation: why, the pane, then a retry and the restart.
 * Answers whether the icon is now allowed.
 */
export async function requestDockIcon(manager: ModManager): Promise<boolean> {
  const open = await confirm({
    title: t('dockIconTitle'),
    message: t('dockIconBody'),
    confirmLabel: t('dockIconOpen'),
    cancelLabel: t('dockIconLater'),
  });
  if (!open) return false;
  await manager.dockIcon('settings');

  const back = await confirm({
    title: t('dockIconTitle'),
    message: t('dockIconAfter'),
    confirmLabel: t('dockIconRestart'),
    cancelLabel: t('dockIconLater'),
  });
  if (!back) return false;
  if ((await manager.dockIcon('retry')) !== 'ok') {
    toast(t('dockIconStill'), { variant: 'error', duration: 8000 });
    return false;
  }
  await manager.restartSlack();
  return true;
}

/** At startup: ask once, and only when the icon was refused. */
export async function offerDockIcon(manager: ModManager): Promise<void> {
  try {
    if (manager.getSettings().dockIconAsked) return;
    if ((await manager.dockIcon()) !== 'refused') return;
    // Recorded before asking, so a dialog closed any way at all is not asked again.
    await manager.patchSettings({ dockIconAsked: true });
    await requestDockIcon(manager);
  } catch {
    // An offer that fails says nothing: Slack is running either way.
  }
}
