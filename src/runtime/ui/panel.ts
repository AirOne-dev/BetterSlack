// The Mods panel: themes, plugins, the remote catalogue, custom CSS.

import type { ModRecord } from '../../shared/protocol.js';
import { h } from '../dom.js';
import type { ModManager } from '../manager.js';
import { contributeUrl, repoUrl } from '../registry.js';
import { PANEL_CSS } from './styles.js';

type TabId = 'themes' | 'plugins' | 'css' | 'about';
type ShelfId = 'installed' | 'enabled' | 'browse';

const HOST_ID = 'slackmod-panel-host';

export class Panel {
  private host: HTMLDivElement | null = null;
  private root: ShadowRoot | null = null;
  private tab: TabId = 'themes';
  /** Which shelf of the Themes/Plugins tabs is showing. */
  private shelf: ShelfId = 'installed';
  /** Kept across re-renders: toggling a mod used to jump the list to the top. */
  private scrollTop = 0;
  private search = '';
  private busy = new Set<string>();
  private entering = false;

  constructor(private readonly manager: ModManager) {
    manager.onChange(() => this.renderIfOpen());
  }

  get isOpen(): boolean {
    return this.host !== null;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    if (this.isOpen) return;
    const host = document.createElement('div');
    host.id = HOST_ID;
    this.root = host.attachShadow({ mode: 'open' });
    document.body.append(host);
    this.host = host;
    this.entering = true;
    this.render();
    this.entering = false;
    // Focus something inside so Escape and Tab behave.
    queueMicrotask(() => this.root?.querySelector<HTMLElement>('nav button')?.focus());
  }

  close(): void {
    this.host?.remove();
    this.host = null;
    this.root = null;
  }

  private renderIfOpen(): void {
    if (this.isOpen) this.render();
  }

  /** Put the list back where the user left it after a re-render. */
  private restoreScroll(): void {
    const main = this.root?.querySelector<HTMLElement>('main');
    if (main && this.scrollTop > 0 && main.scrollTop !== this.scrollTop) {
      main.scrollTop = this.scrollTop;
    }
  }

  private render(): void {
    const root = this.root;
    if (!root) return;
    root.replaceChildren();

    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    root.append(style);

    const backdrop = h('div', { class: this.entering ? 'backdrop entering' : 'backdrop' });
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) this.close();
    });
    backdrop.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Escape') {
        event.stopPropagation();
        this.close();
      }
    });

    const dialog = h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'SlackMod' });
    dialog.append(this.renderHeader(), this.renderBody());
    backdrop.append(dialog);
    root.append(backdrop);
  }

  private renderHeader(): HTMLElement {
    const close = h('button', { class: 'icon', 'aria-label': 'Close' }, ['×']);
    close.addEventListener('click', () => this.close());
    return h('header', {}, [
      h('h1', {}, ['SlackMod']),
      h('span', { class: 'version' }, [`v${this.manager.version}`]),
      h('span', { class: 'spacer' }),
      close,
    ]);
  }

  private renderBody(): HTMLElement {
    const mods = this.manager.list();
    const themes = mods.filter((m) => m.type === 'theme');
    const plugins = mods.filter((m) => m.type === 'plugin');

    const installedThemes = themes.filter((m) => this.manager.isInstalled(m.id));
    const installedPlugins = plugins.filter((m) => this.manager.isInstalled(m.id));
    const tabs: { id: TabId; label: string; count?: number }[] = [
      { id: 'themes', label: 'Themes', count: installedThemes.length },
      { id: 'plugins', label: 'Plugins', count: installedPlugins.length },
      { id: 'css', label: 'Custom CSS' },
      { id: 'about', label: 'About' },
    ];

    const nav = h('nav', { role: 'tablist' });
    for (const tab of tabs) {
      const button = h('button', { role: 'tab', 'aria-selected': String(this.tab === tab.id) }, [
        tab.label,
      ]);
      if (tab.count !== undefined) {
        button.append(h('span', { class: 'count' }, [String(tab.count)]));
      }
      button.addEventListener('click', () => {
        if (this.tab === tab.id) return;
        this.tab = tab.id;
        this.scrollTop = 0;
        this.render();
      });
      nav.append(button);
    }

    const main = h('main', { role: 'tabpanel' });
    // The panel re-renders wholesale on every change, and a toggle triggers
    // several renders in one frame (busy on, state change, busy off). Reading
    // the scroll position at render time therefore captured a 0 left by an
    // earlier render in the same frame. The user's own scrolling is the only
    // reliable source, so record that and replay it after each render.
    main.addEventListener('scroll', () => {
      this.scrollTop = main.scrollTop;
    }, { passive: true });
    requestAnimationFrame(() => this.restoreScroll());
    switch (this.tab) {
      case 'themes':
        main.append(...this.renderShelves(themes, 'theme'));
        break;
      case 'plugins':
        main.append(...this.renderShelves(plugins, 'plugin'));
        break;
      case 'css':
        main.append(...this.renderCustomCss());
        break;
      case 'about':
        main.append(...this.renderAbout());
        break;
    }

    return h('div', { class: 'body' }, [nav, main]);
  }

  /**
   * Installed / Enabled / Browse, in the shape a plugin browser usually takes.
   * The repository is a catalogue: nothing is installed until you say so, so a
   * fresh install opens on an empty Installed shelf and a full Browse shelf.
   */
  private renderShelves(mods: ModRecord[], kind: 'theme' | 'plugin'): Node[] {
    const installed = mods.filter((m) => this.manager.isInstalled(m.id));
    const enabled = installed.filter((m) => this.manager.isEnabled(m.id));
    const available = mods.filter((m) => !this.manager.isInstalled(m.id));

    const shelves: { id: ShelfId; label: string; list: ModRecord[] }[] = [
      { id: 'installed', label: 'Installed', list: installed },
      { id: 'enabled', label: 'Enabled', list: enabled },
      { id: 'browse', label: 'Browse', list: available },
    ];

    const bar = h('div', { class: 'shelves', role: 'tablist' });
    for (const shelf of shelves) {
      const button = h('button', {
        class: 'shelf',
        role: 'tab',
        'aria-selected': String(this.shelf === shelf.id),
      }, [shelf.label, h('span', { class: 'count' }, [String(shelf.list.length)])]);
      button.addEventListener('click', () => {
        if (this.shelf === shelf.id) return;
        this.shelf = shelf.id;
        this.scrollTop = 0;
        this.render();
      });
      bar.append(button);
    }

    const current = shelves.find((shelf) => shelf.id === this.shelf) ?? shelves[0]!;

    const search = h('input', {
      class: 'search',
      type: 'search',
      placeholder: 'Search…',
      spellcheck: 'false',
    }) as HTMLInputElement;
    search.value = this.search;
    // Rendered into its own container, so typing does not rebuild the panel
    // and steal focus back from the input.
    search.addEventListener('input', () => {
      this.search = search.value;
      this.renderList(current.list, kind);
    });

    queueMicrotask(() => this.renderList(current.list, kind));

    return [
      h('div', { class: 'shelf_bar' }, [bar, search]),
      h('div', { class: 'shelf_list' }),
    ];
  }

  private renderList(mods: ModRecord[], kind: 'theme' | 'plugin'): void {
    const host = this.root?.querySelector('.shelf_list');
    if (!host) return;

    const query = this.search.trim().toLowerCase();
    const list = query
      ? mods.filter((m) =>
          `${m.name} ${m.description} ${(m.tags ?? []).join(' ')}`.toLowerCase().includes(query))
      : mods;

    host.replaceChildren();

    if (list.length === 0) {
      const messages: Record<ShelfId, string> = {
        installed: `No ${kind} installed yet. Open Browse to add one.`,
        enabled: `Nothing switched on. Installed ${kind}s can be enabled here.`,
        browse: 'Everything in the catalogue is already installed.',
      };
      host.append(h('div', { class: 'empty' }, [
        query ? 'Nothing matches that search.' : messages[this.shelf],
      ]));
      return;
    }

    for (const mod of list) host.append(this.renderCard(mod));
    // The cards only exist now, so this is the first moment the container is
    // tall enough for a scroll position to survive being set.
    this.restoreScroll();
  }

  private renderCard(mod: ModRecord): HTMLElement {
    const installed = this.manager.isInstalled(mod.id);
    const enabled = this.manager.isEnabled(mod.id);
    const busy = this.busy.has(mod.id);

    const actions = h('div', { class: 'actions' });

    if (installed) {
      const input = h('input', { type: 'checkbox', 'aria-label': `Enable ${mod.name}` }) as HTMLInputElement;
      input.checked = enabled;
      input.disabled = busy;
      input.addEventListener('change', () => {
        void this.withBusy(mod.id, () => this.manager.setEnabled(mod.id, input.checked));
      });

      const remove = h('button', { class: 'btn danger' }, ['Remove']);
      remove.addEventListener('click', () => {
        void this.withBusy(mod.id, () => this.manager.setInstalled(mod.id, false));
      });

      actions.append(remove, h('label', { class: 'switch' }, [
        input,
        h('span', { class: 'track' }, [h('span', { class: 'thumb' })]),
      ]));
    } else {
      const install = h('button', { class: 'btn primary' }, ['Install']) as HTMLButtonElement;
      install.disabled = busy;
      install.addEventListener('click', () => {
        void this.withBusy(mod.id, () => this.manager.setInstalled(mod.id, true));
      });
      actions.append(install);
    }

    const name = h('div', { class: 'name' }, [mod.name]);
    for (const tag of (mod.tags ?? []).slice(0, 3)) {
      name.append(h('span', { class: 'badge' }, [tag]));
    }

    return h('div', { class: 'card' }, [
      h('div', { class: 'meta' }, [
        name,
        h('div', { class: 'desc' }, [mod.description]),
        h('div', { class: 'sub' }, [`v${mod.version} · by ${mod.author}`]),
      ]),
      actions,
    ]);
  }

  private renderCustomCss(): Node[] {
    const textarea = h('textarea', { spellcheck: 'false' }) as HTMLTextAreaElement;
    textarea.value = this.manager.getSettings().customCss;

    const status = h('span', { class: 'status' }, []);
    const save = h('button', { class: 'btn primary' }, ['Save and apply']);
    save.addEventListener('click', () => {
      void this.manager
        .setCustomCss(textarea.value)
        .then(() => {
          status.className = 'status';
          status.textContent = 'Applied.';
        })
        .catch((err: Error) => {
          status.className = 'status error';
          status.textContent = err.message;
        });
    });

    return [
      h('h2', {}, ['Custom CSS']),
      h('p', { class: 'hint' }, [
        'Applied after every theme, so it always wins. Slack exposes its palette as CSS custom properties ' +
          '(--dt_color-*), which is usually a steadier target than its class names.',
      ]),
      textarea,
      h('div', { class: 'row' }, [save, h('span', { class: 'spacer' }), status]),
    ];
  }

  private renderAbout(): Node[] {
    const info = this.manager.info;
    const settings = this.manager.getSettings();

    const hotReload = h('input', { type: 'checkbox', 'aria-label': 'Hot reload' }) as HTMLInputElement;
    hotReload.checked = settings.hotReload;
    hotReload.addEventListener('change', () => {
      void this.manager.patchSettings({ hotReload: hotReload.checked });
    });

    return [
      h('h2', {}, ['About']),
      h('p', { class: 'hint' }, [
        'SlackMod injects into the Slack renderer over the Chrome DevTools Protocol, carried on a private pipe ' +
          'rather than a debugging port — nothing listens on the network, so no other program on this machine can ' +
          'reach the connection. It does not modify ',
        h('code', {}, ['Slack.app']),
        ', so Slack updates cannot break your install — but the mods only stay loaded while the loader runs.',
      ]),
      h('div', { class: 'card' }, [
        h('div', { class: 'meta' }, [
          h('div', { class: 'name' }, ['Hot reload']),
          h('div', { class: 'desc' }, ['Reapply a mod as soon as its file changes on disk.']),
        ]),
        h('div', { class: 'actions' }, [
          h('label', { class: 'switch' }, [
            hotReload,
            h('span', { class: 'track' }, [h('span', { class: 'thumb' })]),
          ]),
        ]),
      ]),
      h('dl', { class: 'info' }, [
        h('dt', {}, ['Repo mods']),
        h('dd', {}, [info.modsRoot]),
        h('dt', {}, ['Your mods']),
        h('dd', {}, [info.userModsRoot]),
        h('dt', {}, ['Slack']),
        h('dd', {}, [info.slackPath]),
        h('dt', {}, ['Transport']),
        h('dd', {}, [info.transport]),
      ]),
      h('p', { class: 'hint', style: 'margin-top:16px' }, [
        h('a', { href: repoUrl, target: '_blank', rel: 'noreferrer' }, ['Repository']),
        ' · ',
        h('a', { href: contributeUrl, target: '_blank', rel: 'noreferrer' }, ['Submit a mod']),
      ]),
    ];
  }

  private async withBusy(id: string, work: () => Promise<unknown>): Promise<void> {
    this.busy.add(id);
    this.renderIfOpen();
    try {
      await work();
    } catch (err) {
      console.error('[slackmod]', err);
      alert(`SlackMod: ${(err as Error).message}`);
    } finally {
      this.busy.delete(id);
      this.renderIfOpen();
    }
  }
}
