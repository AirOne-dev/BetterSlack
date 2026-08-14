// The Mods panel.
//
// Built from Slack's own dialog and menu markup — `c-dialog`, `c-dialog__content`,
// `c-menu_item__button` and friends — and rendered into the light DOM rather
// than a shadow root, so Slack's stylesheet applies to it directly.
//
// That is the point. A shadow root meant reimplementing Slack's look from
// tokens, which lands close but never exactly, and never follows a theme the
// way Slack's own dialogs do.
//
// The trade-off, stated plainly: a theme that restyles `.c-dialog` restyles
// this panel too. Here that is the intended behaviour — the panel should look
// like it belongs to whatever theme is on — but it does mean a careless theme
// can make it ugly. Everything under `mods/themes/` is reviewed, so that is a
// fair deal.

import type { ModRecord } from '../../shared/protocol.js';
import { h } from '../dom.js';
import type { ModManager } from '../manager.js';
import { contributeUrl, repoUrl } from '../registry.js';
import { createCodeEditor } from './code.js';
import { closeMenu, openMenu } from './menu.js';

type TabId = 'themes' | 'plugins' | 'css' | 'about';
type ShelfId = 'installed' | 'enabled' | 'browse';

const HOST_ID = 'slackmod-panel';
/** The shared menu's layer, so Escape can tell it apart from the panel. */
const MENU_ID = 'slackmod-menu-layer';
const REQUIRES_ID = 'slackmod-requires';

const CLOSE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true" style="--s:20px">
  <path fill="currentColor" d="M5.72 5.72a.75.75 0 0 1 1.06 0L10 8.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L11.06 10l3.22 3.22a.75.75 0 1 1-1.06 1.06L10 11.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L8.94 10 5.72 6.78a.75.75 0 0 1 0-1.06Z"/>
</svg>`;

const OVERFLOW_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true" style="--s:20px">
  <path fill="currentColor" d="M5 10a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm6.5 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm5 1.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/>
</svg>`;

export class Panel {
  private host: HTMLElement | null = null;
  private tab: TabId = 'themes';
  private shelf: ShelfId = 'installed';
  private scrollTop = 0;
  private search = '';
  private busy = new Set<string>();

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
    this.host = h('div', { id: HOST_ID, class: 'c-dialog slackmod-dialog', role: 'presentation' });
    document.body.append(this.host);
    document.addEventListener('keydown', this.onKeyDown, true);
    this.render();
    queueMicrotask(() => this.host?.querySelector<HTMLElement>('.slackmod-nav__item')?.focus());
  }

  close(): void {
    this.closeMenu();
    this.dismissRequires?.();
    this.host?.remove();
    this.host = null;
    document.removeEventListener('keydown', this.onKeyDown, true);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.isOpen) return;
    event.stopPropagation();
    // Innermost first: Escape should dismiss the consent dialog without also
    // closing the panel behind it.
    if (document.getElementById(REQUIRES_ID)) this.dismissRequires?.();
    else if (document.getElementById(MENU_ID)) this.closeMenu();
    else this.close();
  };

  private renderIfOpen(): void {
    if (this.isOpen) this.render();
  }

  /** Put the list back where the user left it after a re-render. */
  private restoreScroll(): void {
    const body = this.host?.querySelector<HTMLElement>('.c-dialog__body');
    if (body && this.scrollTop > 0 && body.scrollTop !== this.scrollTop) {
      body.scrollTop = this.scrollTop;
    }
  }

  private render(): void {
    const host = this.host;
    if (!host) return;
    this.closeMenu();
    host.replaceChildren();

    const close = h('button', {
      class:
        'c-button-unstyled c-icon_button c-icon_button--size_medium c-icon_button--default slackmod-close',
      type: 'button',
      'aria-label': 'Close',
    });
    close.innerHTML = CLOSE_ICON;
    close.addEventListener('click', () => this.close());

    const body = h('div', { class: 'c-dialog__body slackmod-body' });
    // The panel re-renders wholesale on every change, and one toggle triggers
    // several renders in a frame; the user's own scrolling is the only
    // reliable source of position.
    body.addEventListener('scroll', () => {
      this.scrollTop = body.scrollTop;
    }, { passive: true });

    const content = h('div', {
      class: 'c-dialog__content slackmod-content',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'SlackMod',
    }, [
      h('div', { class: 'c-dialog__header slackmod-header' }, [
        h('h1', { class: 'c-dialog__title' }, ['SlackMod']),
        close,
      ]),
      h('div', { class: 'slackmod-layout' }, [this.renderNav(), body]),
    ]);

    host.append(content);
    host.addEventListener('mousedown', (event) => {
      if (event.target === host) this.close();
    });

    this.renderBody(body);
    requestAnimationFrame(() => this.restoreScroll());
  }

  private renderNav(): HTMLElement {
    const mods = this.manager.list();
    const count = (type: 'theme' | 'plugin') =>
      mods.filter((m) => m.type === type && this.manager.isInstalled(m.id)).length;

    const items: { id: TabId; label: string; count?: number }[] = [
      { id: 'themes', label: 'Themes', count: count('theme') },
      { id: 'plugins', label: 'Plugins', count: count('plugin') },
      { id: 'css', label: 'Custom CSS' },
      { id: 'about', label: 'About' },
    ];

    const nav = h('nav', { class: 'slackmod-nav', role: 'tablist' });
    for (const item of items) {
      const button = h('button', {
        class: 'c-button-unstyled slackmod-nav__item',
        role: 'tab',
        'aria-selected': String(this.tab === item.id),
        type: 'button',
      }, [item.label]);
      if (item.count !== undefined) {
        button.append(h('span', { class: 'slackmod-count' }, [String(item.count)]));
      }
      button.addEventListener('click', () => {
        if (this.tab === item.id) return;
        this.tab = item.id;
        this.scrollTop = 0;
        this.search = '';
        this.render();
      });
      nav.append(button);
    }
    return nav;
  }

  private renderBody(body: HTMLElement): void {
    const mods = this.manager.list();
    // Above whatever tab is open, not tucked behind About: a notice you have to
    // go looking for is a notice nobody finds. It renders as nothing at all
    // unless this copy is genuinely behind.
    body.append(...this.renderUpdate());

    switch (this.tab) {
      case 'themes':
        body.append(...this.renderShelves(mods.filter((m) => m.type === 'theme'), 'theme'));
        break;
      case 'plugins':
        body.append(...this.renderShelves(mods.filter((m) => m.type === 'plugin'), 'plugin'));
        break;
      case 'css':
        body.append(...this.renderCustomCss());
        break;
      case 'about':
        body.append(...this.renderAbout());
        break;
    }
  }

  /**
   * Installed / Enabled / Browse. The repository is a catalogue: nothing is
   * installed until you say so, so a fresh setup opens on an empty Installed
   * shelf and a full Browse shelf.
   */
  private renderShelves(mods: ModRecord[], kind: 'theme' | 'plugin'): Node[] {
    const installed = mods.filter((m) => this.manager.isInstalled(m.id));
    const shelves: { id: ShelfId; label: string; list: ModRecord[] }[] = [
      { id: 'installed', label: 'Installed', list: installed },
      { id: 'enabled', label: 'Enabled', list: installed.filter((m) => this.manager.isEnabled(m.id)) },
      { id: 'browse', label: 'Browse', list: mods.filter((m) => !this.manager.isInstalled(m.id)) },
    ];

    const tabs = h('div', { class: 'slackmod-shelves', role: 'tablist' });
    for (const shelf of shelves) {
      const button = h('button', {
        class: 'c-button-unstyled slackmod-shelf',
        role: 'tab',
        'aria-selected': String(this.shelf === shelf.id),
        type: 'button',
      }, [shelf.label, h('span', { class: 'slackmod-count' }, [String(shelf.list.length)])]);
      button.addEventListener('click', () => {
        if (this.shelf === shelf.id) return;
        this.shelf = shelf.id;
        this.scrollTop = 0;
        this.render();
      });
      tabs.append(button);
    }

    const current = shelves.find((shelf) => shelf.id === this.shelf) ?? shelves[0]!;

    const search = h('input', {
      class: 'slackmod-search',
      type: 'text',
      placeholder: `Search ${kind}s`,
      spellcheck: 'false',
    }) as HTMLInputElement;
    search.value = this.search;
    // Its own container, so typing does not rebuild the panel and take focus
    // back off the input.
    search.addEventListener('input', () => {
      this.search = search.value;
      this.renderList(current.list, kind);
    });

    queueMicrotask(() => this.renderList(current.list, kind));

    return [
      h('div', { class: 'slackmod-toolbar' }, [tabs, search]),
      h('div', { class: 'slackmod-list' }),
    ];
  }

  private renderList(mods: ModRecord[], kind: 'theme' | 'plugin'): void {
    const host = this.host?.querySelector('.slackmod-list');
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
      host.append(h('div', { class: 'slackmod-empty' }, [
        query ? 'Nothing matches that search.' : messages[this.shelf],
      ]));
      return;
    }

    for (const mod of list) host.append(this.renderRow(mod));
    this.restoreScroll();
  }

  private renderRow(mod: ModRecord): HTMLElement {
    const installed = this.manager.isInstalled(mod.id);
    const enabled = this.manager.isEnabled(mod.id);
    const busy = this.busy.has(mod.id);

    const actions = h('div', { class: 'slackmod-row__actions' });

    if (installed) {
      const input = h('input', {
        type: 'checkbox',
        id: `slackmod-toggle-${mod.id}`,
        'aria-label': `Enable ${mod.name}`,
      }) as HTMLInputElement;
      input.checked = enabled;
      input.disabled = busy;
      input.addEventListener('change', () => {
        void this.withBusy(mod.id, () =>
          input.checked ? this.enableWithRequirements(mod) : this.manager.setEnabled(mod.id, false));
      });

      // A Remove button on every row shouted louder than anything else in the
      // dialog. Slack puts destructive actions behind an overflow menu.
      const overflow = h('button', {
        class:
          'c-button-unstyled c-icon_button c-icon_button--size_smedium c-icon_button--default slackmod-row__more',
        type: 'button',
        'aria-label': `More actions for ${mod.name}`,
        'aria-haspopup': 'menu',
      });
      overflow.innerHTML = OVERFLOW_ICON;
      overflow.addEventListener('click', (event) => {
        event.stopPropagation();
        this.openMenu(overflow, mod);
      });

      actions.append(overflow, h('label', { class: 'slackmod-switch', for: input.id }, [
        input,
        h('span', { class: 'slackmod-switch__track' }, [
          h('span', { class: 'slackmod-switch__thumb' }),
        ]),
      ]));
    } else {
      const install = h('button', {
        class: 'c-button c-button--outline c-button--medium',
        type: 'button',
      }, ['Install']) as HTMLButtonElement;
      install.disabled = busy;
      install.addEventListener('click', () => {
        void this.withBusy(mod.id, () => this.manager.setInstalled(mod.id, true));
      });
      actions.append(install);
    }

    const title = h('div', { class: 'slackmod-row__name' }, [mod.name]);
    for (const tag of (mod.tags ?? []).slice(0, 3)) {
      title.append(h('span', { class: 'slackmod-tag' }, [tag]));
    }

    const meta = h('div', { class: 'slackmod-row__meta' }, [
      title,
      h('div', { class: 'slackmod-row__desc' }, [mod.description]),
      h('div', { class: 'slackmod-row__sub' }, [`v${mod.version} · by ${mod.author}`]),
    ]);

    const requires = mod.requires ?? [];
    if (requires.length > 0) {
      const { found, unknown } = this.missingRecords(mod);
      const names = requires.map((id) => this.manager.list().find((m) => m.id === id)?.name ?? id);
      const satisfied = found.length === 0 && unknown.length === 0;

      const note = h('div', {
        class: `slackmod-row__requires${satisfied ? '' : ' slackmod-row__requires--missing'}`,
      }, [satisfied ? `Uses ${names.join(', ')}` : `Needs ${names.join(', ')}`]);

      // Only offer the button once the theme is on: before that, switching it
      // on is what asks the question anyway.
      if (found.length > 0 && enabled) {
        const fix = h('button', {
          class: 'c-button-unstyled slackmod-row__review',
          type: 'button',
        }, [found.length === 1 ? 'Enable it' : 'Enable them']);
        fix.addEventListener('click', () => {
          void this.withBusy(mod.id, () => this.enableWithRequirements(mod));
        });
        note.append(' ', fix);
      }
      if (unknown.length > 0) {
        // A theme naming a plugin nobody has. Say which, rather than leaving
        // the user to wonder why it looks wrong.
        note.append(h('div', { class: 'slackmod-row__sub' }, [
          `Not in the catalogue: ${unknown.join(', ')}`,
        ]));
      }
      meta.append(note);
    }

    return h('div', { class: 'slackmod-row' }, [meta, actions]);
  }

  /** Set while the requirements dialog is open, so Escape can cancel it. */
  private dismissRequires: (() => void) | null = null;

  /**
   * Ask before switching on a theme's required plugins.
   *
   * A theme is CSS; when a look needs behaviour, that behaviour is a plugin and
   * the theme names it. Turning those on is the user's call, not something to
   * do quietly on their behalf -- a plugin is code, and it will still be
   * running after the theme is switched off again.
   */
  private requestRequirements(mod: ModRecord, missing: ModRecord[]): Promise<boolean> {
    if (missing.length === 0) return Promise.resolve(true);

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (accepted: boolean) => {
        if (settled) return;
        settled = true;
        this.dismissRequires = null;
        document.getElementById(REQUIRES_ID)?.remove();
        resolve(accepted);
      };
      this.dismissRequires = () => finish(false);

      const cancel = h('button', {
        class: 'c-button c-button--outline c-button--medium',
        type: 'button',
      }, ['Cancel']);
      cancel.addEventListener('click', () => finish(false));

      const accept = h('button', {
        class: 'c-button c-button--primary c-button--medium',
        type: 'button',
      }, [missing.length === 1 ? 'Enable it' : `Enable all ${missing.length}`]);
      accept.addEventListener('click', () => finish(true));

      const list = h('ul', { class: 'slackmod-requires' });
      for (const plugin of missing) {
        list.append(h('li', { class: 'slackmod-require' }, [
          h('div', { class: 'slackmod-require__title' }, [plugin.name]),
          h('div', { class: 'slackmod-require__detail' }, [plugin.description]),
        ]));
      }

      const layer = h('div', { id: REQUIRES_ID, class: 'c-dialog slackmod-dialog' }, [
        h('div', {
          class: 'c-dialog__content slackmod-content slackmod-content--narrow',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': `Plugins required by ${mod.name}`,
        }, [
          h('div', { class: 'c-dialog__header slackmod-header' }, [
            h('h1', { class: 'c-dialog__title' }, [mod.name]),
          ]),
          h('div', { class: 'c-dialog__body slackmod-body' }, [
            h('p', { class: 'slackmod-hint' }, [
              missing.length === 1
                ? 'This theme needs a plugin to look the way it is meant to. Plugins run code in ' +
                  'your Slack window, and this one stays on until you switch it off yourself.'
                : 'This theme needs these plugins to look the way it is meant to. Plugins run code ' +
                  'in your Slack window, and they stay on until you switch them off yourself.',
            ]),
            list,
          ]),
          h('div', { class: 'slackmod-actions slackmod-actions--dialog' }, [cancel, accept]),
        ]),
      ]);

      document.body.append(layer);
      layer.addEventListener('mousedown', (event) => {
        if (event.target === layer) finish(false);
      });
      queueMicrotask(() => accept.focus());
    });
  }

  /** Which of a mod's requirements are known to the catalogue but not enabled. */
  private missingRecords(mod: ModRecord): { found: ModRecord[]; unknown: string[] } {
    const found: ModRecord[] = [];
    const unknown: string[] = [];
    for (const id of this.manager.missingRequirements(mod.id)) {
      const record = this.manager.list().find((m) => m.id === id);
      if (record) found.push(record);
      else unknown.push(id);
    }
    return { found, unknown };
  }

  /**
   * Switch a theme on, offering to switch its requirements on first.
   *
   * Declining still enables the theme. It is a stylesheet either way, and half
   * a look is a better answer than refusing to do what was asked.
   */
  private async enableWithRequirements(mod: ModRecord): Promise<void> {
    const { found } = this.missingRecords(mod);
    if (found.length > 0 && (await this.requestRequirements(mod, found))) {
      for (const plugin of found) {
        if (!this.manager.isInstalled(plugin.id)) await this.manager.setInstalled(plugin.id, true);
        await this.manager.setEnabled(plugin.id, true);
      }
    }
    await this.manager.setEnabled(mod.id, true);
  }

  /** The shared menu, so the panel and every mod open the same thing. */
  private openMenu(anchor: HTMLElement, mod: ModRecord): void {
    this.closeRowMenu = openMenu(anchor, [
      {
        label: this.manager.isEnabled(mod.id) ? 'Disable' : 'Enable',
        onSelect: () => {
          void this.withBusy(mod.id, () =>
            this.manager.isEnabled(mod.id)
              ? this.manager.setEnabled(mod.id, false)
              : this.enableWithRequirements(mod));
        },
      },
      {
        label: 'Remove',
        danger: true,
        onSelect: () => {
          void this.withBusy(mod.id, () => this.manager.setInstalled(mod.id, false));
        },
      },
    ]);
  }

  private closeRowMenu: () => void = () => {};

  private closeMenu(): void {
    this.closeRowMenu();
    closeMenu();
  }

  private renderCustomCss(): Node[] {
    // The same editor the theme builder uses: highlighting, and Tab that
    // indents instead of leaving the field. A missing brace in here silently
    // stops the whole stylesheet from applying, which is exactly the mistake
    // colour makes visible.
    const editor = createCodeEditor(document, {
      value: this.manager.getSettings().customCss,
      rows: 16,
      placeholder: ':root { --dt_color-content-pry: #e8e8ea; }',
    });

    const status = h('span', { class: 'slackmod-status' });
    const save = h('button', {
      class: 'c-button c-button--primary c-button--medium',
      type: 'button',
    }, ['Save and apply']);
    save.addEventListener('click', () => {
      void this.manager
        .setCustomCss(editor.value())
        .then(() => {
          status.className = 'slackmod-status';
          status.textContent = 'Applied.';
        })
        .catch((err: Error) => {
          status.className = 'slackmod-status slackmod-danger';
          status.textContent = err.message;
        });
    });

    return [
      h('p', { class: 'slackmod-hint' }, [
        'Applied after every theme, so it always wins. Slack exposes its palette as CSS custom ' +
          'properties (--dt_color-*), which is a steadier target than its class names.',
      ]),
      editor.node,
      h('div', { class: 'slackmod-actions' }, [save, status]),
    ];
  }

  private renderAbout(): Node[] {
    const info = this.manager.info;
    const settings = this.manager.getSettings();

    const hotReload = h('input', {
      type: 'checkbox',
      id: 'slackmod-hot-reload',
      'aria-label': 'Hot reload',
    }) as HTMLInputElement;
    hotReload.checked = settings.hotReload;
    hotReload.addEventListener('change', () => {
      void this.manager.patchSettings({ hotReload: hotReload.checked });
    });

    return [
      h('p', { class: 'slackmod-hint' }, [
        'SlackMod injects into the Slack renderer over the Chrome DevTools Protocol, carried on a ' +
          'private pipe rather than a debugging port — nothing listens on the network. It does not ' +
          'modify Slack.app, so Slack updates cannot break your install, but mods stay loaded only ' +
          'while the loader runs.',
      ]),
      h('div', { class: 'slackmod-row' }, [
        h('div', { class: 'slackmod-row__meta' }, [
          h('div', { class: 'slackmod-row__name' }, ['Hot reload']),
          h('div', { class: 'slackmod-row__desc' }, [
            'Reapply a mod as soon as its file changes on disk.',
          ]),
        ]),
        h('div', { class: 'slackmod-row__actions' }, [
          h('label', { class: 'slackmod-switch', for: hotReload.id }, [
            hotReload,
            h('span', { class: 'slackmod-switch__track' }, [
              h('span', { class: 'slackmod-switch__thumb' }),
            ]),
          ]),
        ]),
      ]),
      h('dl', { class: 'slackmod-info' }, [
        h('dt', {}, ['Version']),
        h('dd', {}, [info.version]),
        h('dt', {}, ['Catalogue']),
        h('dd', {}, [info.modsRoot]),
        h('dt', {}, ['Your mods']),
        h('dd', {}, [info.userModsRoot]),
        h('dt', {}, ['Transport']),
        h('dd', {}, [info.transport]),
      ]),
      h('p', { class: 'slackmod-hint' }, [
        h('a', { class: 'c-link', href: repoUrl, target: '_blank', rel: 'noreferrer' }, ['Repository']),
        ' · ',
        h('a', { class: 'c-link', href: contributeUrl, target: '_blank', rel: 'noreferrer' }, [
          'Submit a mod',
        ]),
      ]),
    ];
  }

  /**
   * Whether this copy is current, and the offer to make it so.
   *
   * Nothing is shown while the answer is unknown -- the check goes out on the
   * network and is allowed to fail -- and nothing is shown when it is up to
   * date either. A row that says "you are fine" every time you open the panel
   * is a row nobody reads.
   */
  private renderUpdate(): Node[] {
    const status = this.manager.update;
    if (!status || !status.behind) return [];

    const detail = status.kind === 'git'
      ? `${status.commits} commit${status.commits === 1 ? '' : 's'} behind${
        status.headline ? ` — latest: ${status.headline}` : ''}`
      : `Version ${status.latest} is out; this is ${this.manager.info.version}.`;

    const status_line = h('span', { class: 'slackmod-status' });
    const actions: Node[] = [];

    if (status.updatable) {
      const update = h('button', {
        class: 'c-button c-button--primary c-button--medium',
        type: 'button',
      }, ['Update and restart']);
      update.addEventListener('click', () => {
        update.setAttribute('disabled', 'disabled');
        status_line.textContent = 'Pulling and rebuilding…';
        void this.manager
          .updateApp()
          .then((result) => {
            status_line.textContent = result.ok
              ? 'Updated. Slack is restarting…'
              : `Could not update: ${result.detail}`;
            if (!result.ok) update.removeAttribute('disabled');
          })
          .catch((err: Error) => {
            status_line.textContent = err.message;
            update.removeAttribute('disabled');
          });
      });
      actions.push(update);
    } else {
      actions.push(h('a', {
        class: 'c-button c-button--outline c-button--medium',
        href: repoUrl,
        target: '_blank',
        rel: 'noreferrer',
      }, ['Open GitHub']));
    }
    actions.push(status_line);

    return [
      h('div', { class: 'slackmod-row slackmod-row--notice' }, [
        h('div', { class: 'slackmod-row__meta' }, [
          h('div', { class: 'slackmod-row__name' }, ['An update is available']),
          h('div', { class: 'slackmod-row__desc' }, [
            status.note ? `${detail} — ${status.note}` : detail,
          ]),
        ]),
        h('div', { class: 'slackmod-row__actions' }, actions),
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
    } finally {
      this.busy.delete(id);
      this.renderIfOpen();
    }
  }
}
