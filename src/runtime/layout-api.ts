// The object a theme's companion script receives in start().
//
// WHY A THEME MAY RUN CODE AT ALL
//
// CSS reaches everything about how Slack looks and nothing about how it is
// arranged. It cannot put a node under a different parent, cannot read who is
// signed in, and cannot press a button. Reproducing another application's
// layout runs into all three, so a theme may ship a script -- behind a
// permission the user agreed to, and behind a deliberately small API.
//
// This is NOT the plugin API with a different name. There is no message
// action, no toolbar button, no toast, no download. If a mod wants those it is
// a plugin, and it should be reviewed and installed as one.
//
// WHAT IS DELIBERATELY MISSING: A "MOVE THIS SLACK NODE OVER THERE" HELPER
//
// It is the first thing you reach for and it is a trap. Slack's tree is React's,
// and React unmounts a node by calling removeChild on the parent it believes
// owns it. Move one of its nodes and that call throws NotFoundError, which
// React does not catch -- it tears down the surrounding tree, and the user gets
// a blank panel with no hint that a theme did it.
//
// So repositioning is CSS's job (position/order/transform move the picture and
// leave the tree alone), and this API covers the three things CSS genuinely
// cannot do: mount nodes of our own, read what is on screen, and click.

import type { ModRecord, Permission } from '../shared/protocol.js';
import { h, keepMounted, onEach, waitFor, type Cleanup, type MountOptions } from './dom.js';
import { collectCleanups } from './plugins.js';
import type { StyleManager } from './themes.js';
import { createWebApi, userIdFromAvatarUrl, type WebApi } from './web-api.js';

/** Who is signed in, as far as the page itself reveals. */
export interface SelfIdentity {
  /** Slack user id, parsed out of the avatar URL in the rail. */
  id: string | null;
  /** Avatar URL at whatever size Slack happens to be rendering. */
  avatar: string | null;
  /**
   * Presence as Slack labels it for screen readers ("Available", "Away", ...).
   * Localised, because it is the user's own interface string -- match on it
   * only if you are ready for every language Slack ships.
   */
  presence: string | null;
}

export interface LayoutApi {
  readonly id: string;
  readonly manifest: ModRecord;
  /** Permissions this theme declared, all of which the user granted. */
  readonly permissions: Permission[];

  /** DOM helpers, the same ones plugins get, safe against Slack's re-renders. */
  readonly dom: {
    waitFor: typeof waitFor;
    /** Mount a node of your own and keep it there as Slack re-renders. */
    keepMounted: (
      containerSelector: string,
      nodeId: string,
      factory: () => HTMLElement,
      options?: MountOptions | 'append' | 'prepend',
    ) => Cleanup;
    onEach: <T extends Element = Element>(selector: string, handler: (element: T) => void) => Cleanup;
    h: typeof h;
  };

  /**
   * Press one of Slack's own controls, so your layout can drive the real UI
   * instead of reimplementing it. Returns false when nothing matched.
   */
  click(selector: string): boolean;

  /** Read the signed-in user off the page. No token, no network. */
  self(): SelfIdentity;

  /**
   * Slack's web API, as you, for looks that need data the page does not paint
   * -- a member column has to know who the members are. Present only with the
   * `workspace` permission; `undefined` otherwise, so a script that forgot to
   * declare it fails in its own code rather than silently doing nothing.
   */
  readonly workspace?: WebApi;

  /** Stylesheet owned by this script, on top of the theme's own. */
  css(text: string): void;

  /** Register teardown; runs when the theme is switched off. */
  onDispose(fn: Cleanup): void;

  readonly log: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };

  /** @internal - used by the host, not by themes. */
  __disposeAll(): void;
}

export interface LayoutContext {
  styles: StyleManager;
  granted: Permission[];
}

/** Style key for a theme script's own sheet: same layer, sibling of the theme. */
export const scriptStyleId = (id: string): string => `${id}#script`;

export function createLayoutApi(record: ModRecord, ctx: LayoutContext): LayoutApi {
  const cleanups = collectCleanups();
  const prefix = `[slackmod:${record.id}]`;

  const track = <T extends (...args: never[]) => Cleanup>(fn: T): T =>
    ((...args: never[]) => {
      const cleanup = fn(...args);
      cleanups.add(cleanup);
      return cleanup;
    }) as T;

  return {
    id: record.id,
    manifest: record,
    permissions: [...ctx.granted],

    dom: {
      waitFor,
      keepMounted: track(keepMounted),
      onEach: track(onEach) as LayoutApi['dom']['onEach'],
      h,
    },

    click(selector: string): boolean {
      const target = document.querySelector<HTMLElement>(selector);
      if (!target) return false;
      target.click();
      return true;
    },

    self(): SelfIdentity {
      // The avatar URL is the useful part: it carries the user id, and it does
      // so identically in every language, which the button's aria-label
      // ("Utilisateur : ...", "User: ...") does not.
      const img = document.querySelector<HTMLImageElement>('[data-qa="user-button"] img');
      const avatar = img?.getAttribute('src') ?? null;
      const presence = document
        .querySelector('[data-qa="user-button"] [data-qa="presence_indicator"]')
        ?.getAttribute('aria-label');
      return { id: userIdFromAvatarUrl(avatar), avatar, presence: presence ?? null };
    },

    workspace: ctx.granted.includes('workspace') ? createWebApi() : undefined,

    css(text: string) {
      ctx.styles.set('theme', scriptStyleId(record.id), text);
      cleanups.add(() => ctx.styles.remove('theme', scriptStyleId(record.id)));
    },

    onDispose(fn: Cleanup) {
      cleanups.add(fn);
    },

    log: {
      info: (...args) => console.log(prefix, ...args),
      warn: (...args) => console.warn(prefix, ...args),
      error: (...args) => console.error(prefix, ...args),
    },

    __disposeAll: cleanups.disposeAll,
  };
}
