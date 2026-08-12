// The Mods panel: themes, plugins, the remote catalogue, custom CSS.

import type { ModRecord } from '../../shared/protocol.js';
import { h } from '../dom.js';
import type { ModManager } from '../manager.js';
import { contributeUrl, fetchModSource, fetchRegistry, repoUrl, toRecord, type RegistryEntry } from '../registry.js';
import { PANEL_CSS } from './styles.js';

type TabId = 'themes' | 'plugins' | 'browse' | 'css' | 'about';

const HOST_ID = 'slackmod-panel-host';

export class Panel {
  private host: HTMLDivElement | null = null;
  private root: ShadowRoot | null = null;
  private tab: TabId = 'themes';
  private remote: RegistryEntry[] | null = null;
  private remoteError: string | null = null;
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

    const tabs: { id: TabId; label: string; count?: number }[] = [
      { id: 'themes', label: 'Themes', count: themes.length },
      { id: 'plugins', label: 'Plugins', count: plugins.length },
      { id: 'browse', label: 'Browse' },
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
        this.tab = tab.id;
        if (tab.id === 'browse' && this.remote === null) void this.loadRegistry();
        this.render();
      });
      nav.append(button);
    }

    const main = h('main', { role: 'tabpanel' });
    switch (this.tab) {
      case 'themes':
        main.append(...this.renderModList(themes, 'theme'));
        break;
      case 'plugins':
        main.append(...this.renderModList(plugins, 'plugin'));
        break;
      case 'browse':
        main.append(...this.renderBrowse());
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

  private renderModList(mods: ModRecord[], kind: 'theme' | 'plugin'): Node[] {
    const title = kind === 'theme' ? 'Themes' : 'Plugins';
    const hint =
      kind === 'theme'
        ? 'Stylesheets layered over Slack. Several can run at once; the last one enabled wins on conflicts.'
        : 'ES modules loaded into the Slack renderer. Disabling one runs its cleanup and undoes its DOM changes.';

    const nodes: Node[] = [h('h2', {}, [title]), h('p', { class: 'hint' }, [hint])];

    if (mods.length === 0) {
      nodes.push(
        h('div', { class: 'empty' }, [
          `No ${kind} installed yet. Check the Browse tab, or drop one in `,
          h('code', {}, [`${this.manager.info.userModsRoot}/${kind}s/`]),
        ]),
      );
      return nodes;
    }

    for (const mod of mods) nodes.push(this.renderCard(mod));
    return nodes;
  }

  private renderCard(mod: ModRecord): HTMLElement {
    const enabled = this.manager.isEnabled(mod.id);
    const busy = this.busy.has(mod.id);

    const input = h('input', { type: 'checkbox', 'aria-label': `Enable ${mod.name}` }) as HTMLInputElement;
    input.checked = enabled;
    input.disabled = busy;
    input.addEventListener('change', () => {
      void this.withBusy(mod.id, () => this.manager.setEnabled(mod.id, input.checked));
    });

    const toggle = h('label', { class: 'switch' }, [
      input,
      h('span', { class: 'track' }, [h('span', { class: 'thumb' })]),
    ]);

    const actions = h('div', { class: 'actions' }, [toggle]);
    if (mod.origin === 'installed') {
      const remove = h('button', { class: 'btn danger' }, ['Remove']);
      remove.addEventListener('click', () => {
        void this.withBusy(mod.id, () => this.manager.uninstall(mod.id));
      });
      actions.prepend(remove);
    }

    const name = h('div', { class: 'name' }, [mod.name]);
    if (mod.origin === 'builtin') name.append(h('span', { class: 'badge builtin' }, ['repo']));

    return h('div', { class: 'card' }, [
      h('div', { class: 'meta' }, [
        name,
        h('div', { class: 'desc' }, [mod.description]),
        h('div', { class: 'sub' }, [`v${mod.version} · by ${mod.author}`]),
      ]),
      actions,
    ]);
  }

  private renderBrowse(): Node[] {
    const nodes: Node[] = [
      h('h2', {}, ['Browse the repository']),
      h('p', { class: 'hint' }, [
        'Everything here was merged into the SlackMod repository through a pull request. ' +
          'A plugin runs with full access to your Slack session, so that review is the only thing standing between you and a bad one — install what you would be willing to read.',
      ]),
    ];

    if (this.remoteError) {
      nodes.push(h('div', { class: 'empty' }, [`Could not reach the registry: ${this.remoteError}`]));
      const retry = h('button', { class: 'btn' }, ['Retry']);
      retry.addEventListener('click', () => void this.loadRegistry());
      nodes.push(h('div', { class: 'row' }, [retry]));
      return nodes;
    }

    if (this.remote === null) {
      nodes.push(h('div', { class: 'empty' }, ['Loading…']));
      return nodes;
    }

    const installedIds = new Set(this.manager.list().map((m) => m.id));
    const available = this.remote.filter((entry) => !installedIds.has(entry.id));

    if (available.length === 0) {
      nodes.push(h('div', { class: 'empty' }, ['Everything in the registry is already on this machine.']));
      return nodes;
    }

    for (const entry of available) {
      const install = h('button', { class: 'btn primary' }, ['Install']) as HTMLButtonElement;
      install.disabled = this.busy.has(entry.id);
      install.addEventListener('click', () => {
        void this.withBusy(entry.id, async () => {
          const source = await fetchModSource(entry);
          await this.manager.install(toRecord(entry), source);
        });
      });

      nodes.push(
        h('div', { class: 'card' }, [
          h('div', { class: 'meta' }, [
            h('div', { class: 'name' }, [entry.name, h('span', { class: 'badge' }, [entry.type])]),
            h('div', { class: 'desc' }, [entry.description]),
            h('div', { class: 'sub' }, [`v${entry.version} · by ${entry.author}`]),
          ]),
          h('div', { class: 'actions' }, [install]),
        ]),
      );
    }
    return nodes;
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

  private async loadRegistry(): Promise<void> {
    this.remoteError = null;
    this.remote = null;
    this.renderIfOpen();
    try {
      const registry = await fetchRegistry();
      this.remote = registry.mods;
    } catch (err) {
      this.remoteError = (err as Error).message;
    }
    this.renderIfOpen();
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
