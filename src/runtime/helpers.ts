// Higher-level helpers, exposed to mods as `api.helpers`.
//
// Everything here is built out of the lower-level API. It exists so that the
// common shapes of a mod — a toggle, a setting, a badge, a hotkey, a menu, a
// section in some pane — are one call rather than twenty lines of DOM.
//
// If you find yourself writing the same block in two mods, it belongs here.

import { h, keepMounted, onEach, onShortcut, type Cleanup } from './dom.js';
import { attachTooltip } from './ui/tooltip.js';

export interface HelperContext {
  pluginId: string;
  css(text: string): void;
  /** Injected rather than imported, so helpers go through the same UI layer a
   * mod would use and a test can observe them. */
  toast(message: string, options?: { variant?: 'info' | 'success' | 'warning' | 'error' }): unknown;
  settings: {
    get<T = unknown>(key: string, fallback?: T): T | undefined;
    set(key: string, value: unknown): Promise<void>;
  };
  track(cleanup: Cleanup): Cleanup;
}

export interface Cache {
  /** What was stored for this key, or undefined. Synchronous. */
  get<T = unknown>(key: string): T | undefined;
  /** Store a value. Persisted, so it outlives the page. */
  set(key: string, value: unknown): void;
  /**
   * The stored value now, the fresh one later, and `onFresh` only if they
   * differ. Failures are silent: a cache that cannot refresh is still a cache.
   */
  swr<T>(key: string, load: () => Promise<T>, onFresh: (value: T) => void): T | undefined;
}

/**
 * How much of one may be kept.
 *
 * Settings are a JSON file the loader reads at every launch, so a cache that
 * grows without limit turns into a slower start than the network it replaced.
 * The oldest keys go first; a member list nobody has opened in weeks is the one
 * worth losing. A caller holding bigger values passes a smaller number.
 */
const CACHE_KEYS = 40;

/** Slack's icon buttons expect a 20x20 viewBox and `currentColor`. */
export type Icon = string;

export interface ToggleOptions {
  /** Settings key the state is stored under. */
  key: string;
  /** Class put on <html> while the toggle is on. */
  className?: string;
  /** Default state on first run. */
  defaultOn?: boolean;
  /** CSS applied only while the toggle is on. `&` stands for the flag class. */
  whenOn?: string;
  onChange?: (on: boolean) => void;
}

export interface Toggle {
  readonly on: boolean;
  set(on: boolean): Promise<void>;
  toggle(): Promise<boolean>;
}

export interface Helpers {
  /**
   * A persisted on/off flag that also drives a class on <html>, so the whole
   * behaviour can be pure CSS. This is the shape most "mode" mods want.
   */
  toggle(options: ToggleOptions): Toggle;

  /**
   * Bind a keyboard shortcut in the platform's idiom: `mod+shift+f`.
   *
   * `when` gates the *match*, not the handler: a shortcut that does not apply
   * must not swallow the key, or a mod binding Escape would break Slack's own
   * dialogs.
   */
  hotkey(combo: string, handler: () => void, options?: { when?: () => boolean }): Cleanup;

  /** Human-readable form of a combo, for tooltips: ⌘⇧F or Ctrl+Shift+F. */
  describeHotkey(combo: string): string;

  /**
   * Run something every so often, and stop while nobody is looking.
   *
   * Slack does not render while its window is hidden, so a poll that keeps
   * going in the background is requests nobody will see the result of -- and
   * for anything hitting Slack's API, requests against a rate limit that is
   * shared with the client itself. This runs once immediately, then on the
   * interval, and pauses whenever the document is hidden, catching up as soon
   * as it comes back. Stops with the plugin.
   */
  poll(handler: () => void | Promise<void>, everyMs: number): Cleanup;

  /**
   * A cache that survives a restart, and refreshes itself behind you.
   *
   * Both mods that list people had the same shape: ask Slack, wait, draw. The
   * answer is nearly always the one from last time, so the waiting is spent
   * confirming what was already known -- and after a restart there is nothing
   * to confirm against, so every list starts empty.
   *
   * `swr` gives back what is stored, synchronously, and goes to the network
   * anyway. Your callback runs only if the answer differs from what was shown,
   * so a list that has not changed does not flicker and one that has does not
   * stay wrong. Stored through `api.settings`, which is a file the loader owns,
   * so it is there at the next launch.
   */
  cache(name: string, options?: { keys?: number }): Cache;

  /** A small count/dot badge pinned to any element, kept in sync by a getter. */
  badge(selector: string, id: string, value: () => string | number | null): Cleanup;

  /**
   * Run a handler for every element matching a selector, now and in future,
   * and undo it for you when the plugin stops.
   */
  each<T extends Element = Element>(selector: string, handler: (element: T) => void): Cleanup;

  /** Keep an element mounted somewhere, surviving Slack's re-renders. */
  mount(container: string, id: string, factory: () => HTMLElement, options?: { before?: string }): Cleanup;

  /** Slack-styled tooltip on anything. */
  tooltip(element: HTMLElement, title: string, subtitle?: string): Cleanup;

  /** Copy text and confirm with a toast, the way three mods were doing by hand. */
  copy(text: string, message?: string): Promise<boolean>;

  /** Build an icon button wearing Slack's classes for a given surface. */
  iconButton(options: {
    icon: Icon;
    label: string;
    description?: string;
    surface?: 'composer' | 'header' | 'strip' | 'message';
    onClick: (event: MouseEvent) => void;
  }): HTMLElement;

  /** A labelled row in Slack's profile/field style. */
  field(label: string, value: string | Node): HTMLElement;

  /** A section with Slack's own header styling, for panes. */
  section(title: string, children: (Node | string)[]): HTMLElement;

  /**
   * Debounce. No shipped mod calls this today -- the two that debounce
   * something do it inside code that has no `api` to reach for: the palette's
   * directory search, and Demo Mode's engine, which the screenshot recipe also
   * runs outside the runtime. Kept because it is three lines and it is the
   * obvious thing to reach for.
   */
  debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T;
}

const BUTTON_CLASSES = {
  composer:
    'c-button-unstyled c-icon_button c-icon_button--size_smedium p-composer__button c-icon_button--default',
  header: 'c-button-unstyled c-icon_button c-icon_button--size_medium c-icon_button--default',
  strip: 'c-button-unstyled p-control_strip__circle_button',
  message:
    'c-button-unstyled c-icon_button c-icon_button--size_smedium c-message_actions__button',
} as const;

const isMac = () => {
  if (typeof navigator === 'undefined') return false;
  const hint = `${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`;
  return /Mac|iPhone|iPad/.test(hint);
};

/** `mod+shift+f` -> a matcher. `mod` is ⌘ on macOS and Ctrl elsewhere. */
function parseCombo(combo: string): (event: KeyboardEvent) => boolean {
  const parts = combo.toLowerCase().split('+').map((p) => p.trim());
  const key = parts[parts.length - 1] ?? '';
  const want = {
    mod: parts.includes('mod'),
    ctrl: parts.includes('ctrl'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt') || parts.includes('option'),
    meta: parts.includes('cmd') || parts.includes('meta'),
  };
  const code = key.length === 1 ? `Key${key.toUpperCase()}` : null;

  return (event: KeyboardEvent) => {
    // `mod` means "the platform's primary modifier". Accepting either ⌘ or
    // Ctrl keeps this off the platform-detection path, which is worth doing:
    // navigator.platform is empty in some environments and the shortcut then
    // silently never fires.
    if (want.mod && !event.metaKey && !event.ctrlKey) return false;
    if (!want.mod && want.meta !== event.metaKey) return false;
    if (!want.mod && want.ctrl !== event.ctrlKey) return false;
    if (want.shift !== event.shiftKey) return false;
    if (want.alt !== event.altKey) return false;
    return code ? event.code === code : event.key.toLowerCase() === key;
  };
}

function describeCombo(combo: string): string {
  const mac = isMac();
  return combo
    .toLowerCase()
    .split('+')
    .map((part) => {
      const p = part.trim();
      if (p === 'mod') return mac ? '⌘' : 'Ctrl';
      if (p === 'shift') return mac ? '⇧' : 'Shift';
      if (p === 'alt' || p === 'option') return mac ? '⌥' : 'Alt';
      if (p === 'cmd' || p === 'meta') return mac ? '⌘' : 'Win';
      if (p === 'ctrl') return mac ? '⌃' : 'Ctrl';
      return p.toUpperCase();
    })
    .join(mac ? '' : '+');
}

export function createHelpers(ctx: HelperContext): Helpers {
  const scopedCss = new Map<string, string>();
  const applyCss = () => ctx.css([...scopedCss.values()].join('\n'));

  return {
    toggle({ key, className, defaultOn = false, whenOn, onChange }) {
      const flag = className ?? `betterslack-${ctx.pluginId}-${key}`;
      if (whenOn) {
        scopedCss.set(`toggle:${key}`, whenOn.replace(/&/g, `html.${flag}`));
        applyCss();
      }

      const apply = (on: boolean) => {
        document.documentElement.classList.toggle(flag, on);
        onChange?.(on);
      };
      apply(ctx.settings.get<boolean>(key, defaultOn) === true);
      ctx.track(() => document.documentElement.classList.remove(flag));

      return {
        get on() {
          return document.documentElement.classList.contains(flag);
        },
        async set(on: boolean) {
          apply(on);
          await ctx.settings.set(key, on);
        },
        async toggle() {
          const next = !document.documentElement.classList.contains(flag);
          apply(next);
          await ctx.settings.set(key, next);
          return next;
        },
      };
    },

    hotkey: (combo, handler, options) => {
      const matches = parseCombo(combo);
      return ctx.track(
        onShortcut((event) => matches(event) && (options?.when?.() ?? true), handler),
      );
    },
    describeHotkey: describeCombo,

    cache(name, options = {}) {
      const store = `cache:${name}`;
      const limit = Math.max(1, options.keys ?? CACHE_KEYS);
      /*
       * Held in memory as well as written, because `settings.set` is a message
       * to the loader: reading back what was just written would race the answer,
       * and a list drawn from a cache that has not caught up is worse than one
       * drawn from none.
       */
      let entries = ctx.settings.get<Record<string, { at: number; value: unknown }>>(store, {}) ?? {};
      let writing: Promise<void> | null = null;

      const persist = () => {
        // Coalesced: several keys can be filled in one paint, and each write
        // crosses to the loader and back.
        if (writing) return;
        writing = Promise.resolve().then(async () => {
          writing = null;
          const keys = Object.keys(entries);
          if (keys.length > limit) {
            const oldest = keys.sort((a, b) => (entries[a]?.at ?? 0) - (entries[b]?.at ?? 0));
            for (const key of oldest.slice(0, keys.length - limit)) delete entries[key];
          }
          await ctx.settings.set(store, entries).catch(() => undefined);
        });
      };

      const write = (key: string, value: unknown) => {
        entries = { ...entries, [key]: { at: Date.now(), value } };
        persist();
      };

      return {
        get: (key) => entries[key]?.value as never,
        set: write,
        swr(key, load, onFresh) {
          const held = entries[key]?.value;
          void Promise.resolve()
            .then(load)
            .then((fresh) => {
              if (fresh === undefined) return;
              // Compared as text: these are lists of ids and small records, and
              // "did it change" is the only question being asked. A deep
              // comparison written by hand would be a second thing to get
              // wrong.
              if (JSON.stringify(fresh) === JSON.stringify(held)) {
                // Still touch it, so a key in use is not the one evicted.
                write(key, fresh);
                return;
              }
              write(key, fresh);
              onFresh(fresh);
            })
            .catch(() => undefined);
          return held as never;
        },
      };
    },

    poll(handler, everyMs) {
      let timer: ReturnType<typeof setInterval> | undefined;
      let running = false;

      const tick = () => {
        // Overlapping runs are the other half of the same problem: a slow round
        // of requests should not have a second one starting behind it.
        if (running || document.visibilityState === 'hidden') return;
        running = true;
        void Promise.resolve(handler()).finally(() => { running = false; });
      };

      const start = () => {
        if (timer !== undefined) return;
        tick();
        timer = setInterval(tick, everyMs);
      };
      const stop = () => {
        if (timer === undefined) return;
        clearInterval(timer);
        timer = undefined;
      };

      const onVisibility = () => (document.visibilityState === 'hidden' ? stop() : start());
      document.addEventListener('visibilitychange', onVisibility);
      if (document.visibilityState !== 'hidden') start();

      ctx.track(() => {
        document.removeEventListener('visibilitychange', onVisibility);
        stop();
      });
      return () => {
        document.removeEventListener('visibilitychange', onVisibility);
        stop();
      };
    },

    badge(selector, id, value) {
      const nodeId = `betterslack-badge-${ctx.pluginId}-${id}`;
      scopedCss.set(`badge:${id}`, `
        #${nodeId} {
          position: absolute; top: -2px; right: -2px; min-width: 16px; height: 16px;
          padding: 0 4px; border-radius: 999px; display: grid; place-items: center;
          font: 700 10px/1 Lato, sans-serif; color: #fff;
          background: var(--dt_color-content-imp, #c01343);
        }
        #${nodeId}[hidden] { display: none; }
      `);
      applyCss();

      const refresh = () => {
        const node = document.getElementById(nodeId);
        if (!node) return;
        const next = value();
        node.textContent = next === null ? '' : String(next);
        node.toggleAttribute('hidden', next === null || next === 0 || next === '');
      };

      const cleanup = keepMounted(selector, nodeId, () => {
        const node = h('span', { 'aria-hidden': 'true' });
        queueMicrotask(refresh);
        return node;
      });
      const timer = setInterval(refresh, 1000);
      return ctx.track(() => {
        clearInterval(timer);
        cleanup();
      });
    },

    each: (selector, handler) => ctx.track(onEach(selector, handler)),
    mount: (container, id, factory, options) => ctx.track(keepMounted(container, id, factory, options ?? {})),
    tooltip: (element, title, subtitle) => ctx.track(attachTooltip(element, { title, subtitle })),

    async copy(text, message = 'Copied') {
      try {
        await navigator.clipboard.writeText(text);
        ctx.toast(message, { variant: 'success' });
        return true;
      } catch {
        ctx.toast('Could not copy', { variant: 'error' });
        return false;
      }
    },

    iconButton({ icon, label, description, surface = 'header', onClick }) {
      const button = h('button', {
        class: `${BUTTON_CLASSES[surface]} betterslack-icon-button`,
        type: 'button',
        'aria-label': label,
      });
      button.innerHTML = icon;
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick(event as MouseEvent);
      });
      ctx.track(attachTooltip(button, {
        title: label,
        subtitle: description,
        placement: surface === 'strip' ? 'right' : 'top',
      }));
      return button;
    },

    field(label, value) {
      return h('div', { class: 'p-rimeto_member_profile_field__contact_info' }, [
        h('div', { class: 'p-rimeto_member_profile_field' }, [
          h('div', { class: 'p-rimeto_member_profile_field__primary' }, [
            h('div', { class: 'p-rimeto_member_profile_field__label' }, [label]),
            h('div', { class: 'p-rimeto_member_profile_field__value' }, [value]),
          ]),
        ]),
      ]);
    },

    section(title, children) {
      return h('div', { class: 'p-r_member_profile_section' }, [
        h('div', { style: 'display: flex;' }, [
          h('div', { class: 'p-r_member_profile_section_header', style: 'flex: 1 1 0%;' }, [title]),
        ]),
        h('div', { class: 'p-r_member_profile_section_content' }, children),
      ]);
    },

    debounce(fn, ms) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      return ((...args: never[]) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
      }) as typeof fn;
    },
  };
}
