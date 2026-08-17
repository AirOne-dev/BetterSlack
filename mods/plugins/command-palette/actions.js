// Everything BetterSlack can do, as rows.
//
// This is the half Slack has no idea about: the commands other mods registered,
// the panel's own doors, and every mod in the catalogue -- switched on, switched
// off, configured, or installed for the first time.
//
// Two rules it follows, both learned from using it:
//
//   * **Configure only when there is something to configure.** A mod declares
//     its settings in its manifest, and `api.app.mods()` says how many; a
//     "Configure" row on a mod that declared none is a row that opens a panel
//     with nothing in it, and after the second time nobody trusts the list.
//   * **The whole catalogue, but only when asked.** Searching a theme by name
//     and being told nothing matches, because it is not installed yet, is what
//     makes people stop opening a palette -- so it is all there when you type,
//     and out of the way when you have not.

/** How many of each kind to offer before a query narrows things down. */
const IDLE_LIMIT = 6;

export function createActions(api, t) {
  /** The panel's own doors. Always available, with or without a workspace. */
  const doors = () => [
    { id: 'panel', title: t('openPanel'), icon: '⚙️', run: () => api.app.openPanel() },
    { id: 'themes', title: t('browseThemes'), icon: '🎨', run: () => api.app.openPanel('themes') },
    { id: 'plugins', title: t('browsePlugins'), icon: '🧩', run: () => api.app.openPanel('plugins') },
    { id: 'css', title: t('customCss'), icon: '{}', run: () => api.app.openPanel('css') },
  ].map((entry) => ({ ...entry, section: t('sectionActions'), source: 'BetterSlack' }));

  /** What other mods offered. Attributed to them by the runtime, not by us. */
  const commands = () => api.app.commands().map((command) => ({
    ...command,
    section: t('sectionActions'),
    icon: command.icon ?? '⌘',
  }));

  /**
   * One mod, as up to three rows: the switch, its settings, and its removal is
   * deliberately not here -- destructive actions belong somewhere you cannot
   * reach by typing three letters and pressing Enter.
   */
  const forMod = (mod) => {
    const kind = mod.type === 'theme' ? t('theme') : t('plugin');
    const icon = mod.type === 'theme' ? '🎨' : '🧩';
    const rows = [];

    if (!mod.installed) {
      rows.push({
        id: `install:${mod.id}`,
        title: t('installMod', { name: mod.name }),
        section: t('sectionCatalogue'),
        icon,
        source: kind,
        subtitle: mod.description,
        run: () => void api.app.setInstalled(mod.id, true).then(() => api.app.setEnabled(mod.id, true)),
      });
      return rows;
    }

    rows.push({
      id: `mod:${mod.id}`,
      title: mod.enabled ? t('disableMod', { name: mod.name }) : t('enableMod', { name: mod.name }),
      section: t('sectionMods'),
      icon,
      source: kind,
      subtitle: mod.description,
      run: () => void api.app.setEnabled(mod.id, !mod.enabled),
    });

    // Settings are drawn by the panel from the manifest; this points at them.
    // Only for a mod that is on, because that is the only time its controls do
    // anything -- the panel hides them otherwise, and offering a row that leads
    // to a hidden control is worse than offering nothing.
    if (mod.settings > 0 && mod.enabled) {
      rows.push({
        id: `configure:${mod.id}`,
        title: t('configureMod', { name: mod.name }),
        section: t('sectionMods'),
        icon: '⚙️',
        source: kind,
        subtitle: t('settingsCount', { count: mod.settings }),
        run: () => api.app.openMod(mod.id),
      });
    }
    return rows;
  };

  return {
    /**
     * @param query what has been typed, so the long lists can stay out of the
     *   way until they are asked for.
     */
    list: (query) => {
      const asked = query.trim().length > 0;
      const mods = api.app.mods();
      const rows = [...commands(), ...doors()];

      const installed = mods.filter((mod) => mod.installed).flatMap(forMod);
      const catalogue = mods.filter((mod) => !mod.installed).flatMap(forMod);

      // Idle, this is a menu; with a query, it is a search. A menu that opens
      // on forty rows is not a menu.
      rows.push(...(asked ? installed : installed.slice(0, IDLE_LIMIT)));
      if (asked) rows.push(...catalogue);
      return rows;
    },
  };
}
