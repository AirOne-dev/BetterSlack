// Slack-specific helpers exposed to plugins as `api.slack`.
//
// Everything that depends on how Slack's DOM is shaped lives here rather than
// in each mod. When Slack renames something, one file changes instead of ten,
// and mods stay readable for whoever reviews the pull request.
//
// Selectors verified against Slack 4.51 (Electron 43).

import type { Cleanup } from './dom.js';
import { h, keepMounted, onEach, waitFor } from './dom.js';
import { attachTooltip, type Placement } from './ui/tooltip.js';
import { createWebApi, currentTeamId, drawnChannelId, userIdFromAvatarUrl, type SlackProfile, type WebApi } from './web-api.js';

/** Hover toolbar that appears over a message. */
const ACTIONS_GROUP = '[data-qa="message-actions"]';
/** One slot in that toolbar. Slack wraps every button in one of these. */
const ACTIONS_ITEM_CLASS = 'c-message_actions__overflow_item c-message_actions__overflow_item--button';
/** The "more actions" button, which should stay last. */
const MORE_ACTIONS = '[data-qa="more_message_actions"]';
const MESSAGE = '[data-qa="message_container"]';
const COMPOSER_EDITOR = '.ql-editor';
const COMPOSER = '[data-qa="message_input"]';

/**
 * The three other places a mod can put a button, with the Slack button classes
 * that make it look native in each. Anchoring on `data-qa` where possible.
 *
 * `c-icon_button--default` matters more than it looks: without it Slack's icon
 * buttons render at 36px instead of the 28px their neighbours use.
 */
const TOOLBARS = {
  /** Bottom strip of the rail: "Créer un nouveau", focus mode, avatar. */
  controlStrip: {
    container: '.p-control_strip',
    buttonClass: 'c-button-unstyled p-control_strip__circle_button',
    /*
     * Anchored on BetterSlack's own launcher, not on Slack's coachmark wrapper.
     *
     * Inserting next to `.c-coachmark-anchor:has([data-qa="user-button"])`
     * freezes the renderer solid -- grey window, no error, no console, Slack
     * has to be killed. Slack's coachmark code evidently reacts to changes
     * around that node and ends up in a loop with whatever put them there.
     * Bisected against a running client: the same button anchored here is fine,
     * anchored there hangs every time.
     */
    before: '#betterslack-control-button',
    placement: 'right' as Placement,
  },
  /**
   * Formatting row under the message box: bold, italic, link…
   * Anchored on whatever element holds the bold button, rather than on the
   * composer body, so the button lands beside its peers and not at the end of
   * an unrelated container.
   */
  composer: {
    container: '*:has(> [data-qa="bold-composer-button"])',
    buttonClass:
      'c-button-unstyled c-icon_button c-icon_button--size_smedium p-composer__button c-icon_button--default',
    before: undefined,
    placement: 'top' as Placement,
  },
  /**
   * Right-hand end of the top bar, beside Slack's own help and account
   * controls. The place for a switch that belongs to the whole client rather
   * than to the conversation on screen.
   *
   * The container is a direct child on purpose: `display_flex` and
   * `align_items_center` are utility classes that appear all over Slack's
   * markup, and matching them anywhere under the right container would put the
   * button in whichever one happened to come first.
   */
  topNav: {
    container: '.p-ia4_top_nav__right_container > .display_flex.align_items_center',
    buttonClass: 'c-button-unstyled c-icon_button c-icon_button--size_medium c-icon_button--default',
    before: undefined,
    placement: 'bottom' as Placement,
  },
  /** Right-hand side of the channel header: huddle, search, more. */
  channelHeader: {
    container: '.p-view_header__actions',
    buttonClass: 'c-button-unstyled c-icon_button c-icon_button--size_medium c-icon_button--default',
    before: undefined,
    placement: 'bottom' as Placement,
  },
} as const;

export type ToolbarName = keyof typeof TOOLBARS;

export interface MessageRef {
  /** The message container element. */
  element: HTMLElement;
  /** Channel id, e.g. C0BFQCYBRAB. */
  channelId: string | null;
  /** Slack message timestamp, e.g. "1786386808.130969". */
  ts: string | null;
  /** Public permalink to the message, or null if it cannot be determined. */
  permalink: string | null;
  /** Plain text of the message body. */
  text: string;
}

export interface MessageAction {
  /** Unique within your plugin; becomes part of the DOM id. */
  id: string;
  /** Tooltip title and accessible name. */
  label: string;
  /** Inline SVG markup for a 20x20 viewBox icon. */
  icon: string;
  /** Optional second line in the tooltip, like Slack's own actions have. */
  description?: string;
  onClick: (message: MessageRef, event: MouseEvent) => void;
}

/**
 * Slack renders permalinks on the timestamp link of the first message in a
 * group; grouped follow-up messages have one too, but it only appears on hover.
 * Remember the workspace host from the first one seen so a permalink can still
 * be built from the data attributes alone.
 */
let cachedHost: string | null = null;

function rememberHost(url: string): void {
  try {
    cachedHost = new URL(url).origin;
  } catch {
    /* not a URL we can use */
  }
}

export function describeMessage(element: HTMLElement): MessageRef {
  const channelId = element.getAttribute('data-msg-channel-id');
  const ts = element.getAttribute('data-msg-ts');

  let permalink: string | null = null;
  const timestampLink = element.querySelector<HTMLAnchorElement>('a.c-timestamp');
  if (timestampLink?.href) {
    permalink = timestampLink.href;
    rememberHost(permalink);
  } else if (cachedHost && channelId && ts) {
    // Slack's permalink form: /archives/<channel>/p<ts with the dot removed>.
    permalink = `${cachedHost}/archives/${channelId}/p${ts.replace('.', '')}`;
  }

  const body = element.querySelector('[data-qa="message-text"]');
  return {
    element,
    channelId,
    ts,
    permalink,
    text: (body?.textContent ?? element.textContent ?? '').trim(),
  };
}

/**
 * Add a button to the hover toolbar of every message.
 *
 * The toolbar is created and destroyed constantly as the pointer moves, so this
 * watches for each new one rather than trying to hold a reference.
 */
export function addMessageAction(pluginId: string, action: MessageAction): Cleanup {
  const nodeId = `betterslack-action-${pluginId}-${action.id}`;

  const cleanup = onEach<HTMLElement>(ACTIONS_GROUP, (group) => {
    if (group.querySelector(`#${CSS.escape(nodeId)}`)) return;

    const message = group.closest<HTMLElement>(MESSAGE)
      // Some surfaces (threads, saved items) put the toolbar beside the message
      // rather than inside it; fall back to whatever is currently hovered.
      ?? document.querySelector<HTMLElement>('.c-message_kit__hover--hovered')?.closest<HTMLElement>(MESSAGE)
      ?? null;
    if (!message) return;

    const button = h('button', {
      class: 'c-button-unstyled c-icon_button c-icon_button--size_smedium c-message_actions__button betterslack-action',
      type: 'button',
      'aria-label': action.label,
      'data-qa': `betterslack_${pluginId}_${action.id}`,
    });
    button.innerHTML = action.icon;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      action.onClick(describeMessage(message), event as MouseEvent);
    });
    // Slack's neighbouring buttons get a styled tooltip above them; a native
    // `title` here looked obviously foreign next to Reply and Forward.
    attachTooltip(button, {
      title: action.label,
      subtitle: action.description,
      placement: 'top',
    });

    const item = h('div', { class: ACTIONS_ITEM_CLASS, id: nodeId }, [button]);

    // Keep Slack's own "more actions" button in its usual last position.
    const more = group.querySelector(MORE_ACTIONS)?.closest(`.c-message_actions__overflow_item`);
    if (more) more.before(item);
    else group.append(item);
  });

  return () => {
    cleanup();
    for (const node of document.querySelectorAll(`#${CSS.escape(nodeId)}`)) node.remove();
  };
}

/* -- somebody's status ----------------------------------------------------- *
 *
 * A Slack status is a shortcode and a sentence -- `:coffee:` and "back at 3" --
 * and drawing the first is the hard half. Measured against a live client:
 *
 * - `emoji.list` answers with the workspace's *custom* emoji only. Fifteen of
 *   them here; `coffee` and `tada` are not in it.
 * - Slack draws every emoji as an `<img>`, standard ones included, from
 *   `a.slack-edge.com/production-standard-emoji-assets/16.0/apple-small/
 *   <codepoint>@2x.png`. The codepoint, not the name -- so a shortcode alone
 *   does not build that URL.
 * - Each of those images carries `data-stringify-emoji`, which is the name. So
 *   Slack's own DOM is a name-to-image table for everything it has drawn, and
 *   the statuses on screen are drawn from the same small set of emoji the
 *   workspace actually uses.
 *
 * Hence three sources, in order: what Slack sent with the profile, the custom
 * map, and what Slack has already drawn. A name none of them knows keeps its
 * colons and is shown as text, which is what Slack does for an emoji it cannot
 * resolve either.
 */

export interface SlackStatus {
  /** The sentence, without the emoji. Empty when there is only an emoji. */
  text: string;
  /** The shortcode without its colons, or null when there is no emoji. */
  emoji: string | null;
  /** An image for that emoji, when one could be resolved. */
  imageUrl: string | null;
  /** When it clears, or null for a status with no end. */
  expiresAt: Date | null;
}

/** Names Slack has drawn in this page, to the image it drew them with. */
const drawnEmoji = new Map<string, string>();

/**
 * Read Slack's own emoji images for their names.
 *
 * Cheap, and worth redoing: it is a `querySelectorAll` over what is on screen,
 * and what is on screen changes. The map only grows.
 */
function harvestEmoji(): Map<string, string> {
  for (const img of document.querySelectorAll<HTMLImageElement>('.c-emoji img[data-stringify-emoji]')) {
    const name = img.getAttribute('data-stringify-emoji')?.replace(/^:|:$/g, '');
    if (!name || drawnEmoji.has(name)) continue;
    // The small size is the one Slack uses inline, which is the size a status
    // wants; a large one scaled down is a bigger request for a worse picture.
    if (img.src) drawnEmoji.set(name, img.src);
  }
  return drawnEmoji;
}

/**
 * What somebody's status is, ready to draw.
 *
 * Takes a user or a profile so callers do not have to remember which shape they
 * are holding: `users.info` gives one, a profile pane read gives the other.
 */
export function describeStatus(
  who: { profile?: SlackProfile } | SlackProfile | null | undefined,
  customEmoji?: Map<string, string> | null,
): SlackStatus | null {
  const profile = (who && 'profile' in who && who.profile ? who.profile : who) as SlackProfile | null;
  if (!profile) return null;

  const text = (profile.status_text ?? '').trim();
  const emoji = (profile.status_emoji ?? '').replace(/^:|:$/g, '').trim() || null;
  if (!text && !emoji) return null;

  const expiration = Number(profile.status_expiration ?? 0);

  return {
    text,
    emoji,
    imageUrl: emoji ? imageForEmoji(emoji, profile, customEmoji) : null,
    // 0 means "no end", which is not the same as the epoch.
    expiresAt: expiration > 0 ? new Date(expiration * 1000) : null,
  };
}

function imageForEmoji(
  name: string,
  profile: SlackProfile | null,
  customEmoji?: Map<string, string> | null,
): string | null {
  const sent = profile?.status_emoji_display_info?.find(
    (entry) => !entry.emoji_name || entry.emoji_name.replace(/^:|:$/g, '') === name,
  );
  if (sent?.display_url) return sent.display_url;
  return customEmoji?.get(name) ?? harvestEmoji().get(name) ?? null;
}

/**
 * The status as a node, since both mods that show one draw it the same way.
 *
 * An image when one resolved, the unicode character when Slack sent one, and
 * nothing when neither. Never the raw shortcode: `:tada:` on screen reads as a
 * rendering that failed, which is also what Slack does with an emoji it cannot
 * draw. The name goes in the title instead, so it is still there to be found,
 * and the sentence beside it is drawn either way -- that is the half carrying
 * the meaning.
 */
export function statusNode(status: SlackStatus, profile?: SlackProfile | null): HTMLElement {
  const node = h('span', { class: 'betterslack-status' });
  if (status.emoji) {
    const unicode = profile?.status_emoji_display_info?.find((e) => e.unicode)?.unicode;
    if (status.imageUrl) {
      node.append(h('img', {
        class: 'betterslack-status__emoji',
        src: status.imageUrl,
        alt: status.emoji,
        loading: 'lazy',
      }));
    } else if (unicode) {
      node.append(h('span', { class: 'betterslack-status__emoji betterslack-status__emoji--char' }, [
        // Slack sends it as codepoints joined by dashes: "1f1eb-1f1f7".
        unicode.split('-').map((point) => String.fromCodePoint(parseInt(point, 16))).join(''),
      ]));
    }
  }
  if (status.text) node.append(h('span', { class: 'betterslack-status__text' }, [status.text]));
  node.title = [status.text, status.emoji ? `:${status.emoji}:` : ''].filter(Boolean).join(' ');
  return node;
}

/** The member profile flexpane, and the avatar that identifies whose it is. */
const PROFILE_PANE = '[data-qa="member_profile_pane"]';
const PROFILE_AVATAR = '.p-r_member_profile__avatar__img';

export interface ProfilePane {
  element: HTMLElement;
  /** The user whose profile is open, read from the avatar URL. */
  userId: string | null;
}

/** Run a handler each time a member profile pane opens. */
export function onProfilePane(handler: (pane: ProfilePane) => void): Cleanup {
  return onEach<HTMLElement>(PROFILE_PANE, (element) => {
    const avatar = element.querySelector<HTMLImageElement>(PROFILE_AVATAR);
    handler({ element, userId: userIdFromAvatarUrl(avatar?.src) });
  });
}

export interface ProfileButton {
  id: string;
  label: string;
  /** Optional inline SVG shown before the label. */
  icon?: string;
  onClick: (pane: ProfilePane) => void;
}

/**
 * Add a full-width button to the member profile pane. Uses Slack's standard
 * outline button so it sits with the pane's own controls.
 */
export function addProfileButton(pluginId: string, button: ProfileButton): Cleanup {
  const nodeId = `betterslack-profile-${pluginId}-${button.id}`;

  const cleanup = onEach<HTMLElement>(PROFILE_PANE, (pane) => {
    if (pane.querySelector(`#${CSS.escape(nodeId)}`)) return;

    const element = h('button', {
      class: 'c-button c-button--outline c-button--medium betterslack-profile-button',
      type: 'button',
      id: nodeId,
      'data-qa': `betterslack_${pluginId}_${button.id}`,
    });
    if (button.icon) element.innerHTML = button.icon;
    element.append(h('span', {}, [button.label]));
    element.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const avatar = pane.querySelector<HTMLImageElement>(PROFILE_AVATAR);
      button.onClick({ element: pane, userId: userIdFromAvatarUrl(avatar?.src) });
    });

    const container = pane.querySelector('.p-r_member_profile__container') ?? pane;
    container.append(h('div', { class: 'betterslack-profile-row' }, [element]));
  });

  return () => {
    cleanup();
    for (const node of document.querySelectorAll(`#${CSS.escape(nodeId)}`)) {
      node.closest('.betterslack-profile-row')?.remove();
      node.remove();
    }
  };
}

export interface ToolbarButton {
  /** Unique within your plugin; becomes part of the DOM id. */
  id: string;
  /** Tooltip title and accessible name. */
  label: string;
  /** Inline SVG for a 20x20 viewBox icon, using `currentColor`. */
  icon: string;
  /** Optional second line in the tooltip. */
  description?: string;
  /**
   * Selector, inside the toolbar, to insert before. Defaults to the toolbar's
   * own anchor. Use it to sit above an existing button rather than after it.
   */
  before?: string;
  onClick: (event: MouseEvent) => void;
}

/**
 * Put a button in one of Slack's toolbars.
 *
 * The button wears Slack's own classes for that toolbar, so its size, colour,
 * hover, active state and transition come from Slack and stay in step with the
 * buttons beside it. It is remounted automatically whenever Slack re-renders.
 */
export function addToolbarButton(
  pluginId: string,
  toolbar: ToolbarName,
  button: ToolbarButton,
): Cleanup {
  const spec = TOOLBARS[toolbar];
  const nodeId = `betterslack-tb-${pluginId}-${button.id}`;

  const unmount = keepMounted(
    spec.container,
    nodeId,
    () => {
      const element = h('button', {
        class: `${spec.buttonClass} betterslack-toolbar-button`,
        type: 'button',
        'aria-label': button.label,
        'data-qa': `betterslack_${pluginId}_${button.id}`,
      });
      element.innerHTML = button.icon;
      element.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        button.onClick(event as MouseEvent);
      });
      attachTooltip(element, {
        title: button.label,
        subtitle: button.description,
        placement: spec.placement,
      });
      return element;
    },
    // Prepend rather than append when the anchor is missing: the end of a
    // container is where the app's own re-renders land.
    { before: button.before ?? spec.before, position: 'prepend' },
  );

  return () => {
    unmount();
    for (const node of document.querySelectorAll(`#${CSS.escape(nodeId)}`)) node.remove();
  };
}

export interface ComposerApi {
  /** The contenteditable Slack types into, if a composer is on screen. */
  element(): HTMLElement | null;
  focus(): boolean;
  /** Move the caret to the very end of the composer. */
  caretToEnd(): void;
  /** Insert plain text at the caret. */
  insertText(text: string): boolean;
  /**
   * Insert a real hyperlink at the caret.
   *
   * Uses execCommand('insertHTML'): Slack's Quill instance picks the mutation
   * up through its own observer and keeps it. Synthetic paste events do not
   * work -- Slack ignores untrusted clipboard events.
   */
  insertLink(url: string, text: string): boolean;
  isEmpty(): boolean;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const composer: ComposerApi = {
  element: () => document.querySelector<HTMLElement>(COMPOSER_EDITOR),

  focus() {
    const editor = composer.element();
    if (!editor) return false;
    editor.focus();
    return document.activeElement === editor || editor.contains(document.activeElement);
  },

  caretToEnd() {
    const editor = composer.element();
    if (!editor) return;
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  },

  insertText(text: string) {
    if (!composer.focus()) return false;
    composer.caretToEnd();
    return document.execCommand('insertText', false, text);
  },

  insertLink(url: string, text: string) {
    if (!composer.focus()) return false;
    composer.caretToEnd();
    // Only http(s) links: an unchecked scheme here would let a mod put
    // javascript: into the user's own message box.
    let safe: URL;
    try {
      safe = new URL(url);
    } catch {
      return false;
    }
    if (safe.protocol !== 'https:' && safe.protocol !== 'http:') return false;
    return document.execCommand(
      'insertHTML',
      false,
      `<a href="${escapeHtml(safe.href)}">${escapeHtml(text)}</a>`,
    );
  },

  isEmpty() {
    const editor = composer.element();
    if (!editor) return true;
    return editor.innerText.replace(/\n/g, '').trim() === '';
  },
};

export interface SlackApi {
  /** Add a button to the hover toolbar on messages. */
  addMessageAction(action: MessageAction): Cleanup;
  /**
   * Add a button to one of Slack's toolbars:
   *   `controlStrip`  – the bottom of the rail, next to your avatar
   *   `composer`      – the formatting row under the message box
   *   `channelHeader` – the right-hand side of the channel header
   */
  addToolbarButton(toolbar: ToolbarName, button: ToolbarButton): Cleanup;
  /** Add a button to the member profile pane. */
  addProfileButton(button: ProfileButton): Cleanup;
  /** Run a handler each time a member profile pane opens. */
  onProfilePane(handler: (pane: ProfilePane) => void): Cleanup;
  /**
   * Move the client to a conversation, without a page load.
   *
   * Slack's own navigation lives in a private closure: its router state is
   * pushed with history.pushState and nothing outside reacts to a synthetic
   * popstate, there is no exposed React Router instance, and an <a> to
   * /archives/<id> leaves the client entirely. What does work is Slack's own
   * documented deep-link scheme, which the desktop app handles in place --
   * measured against 4.51: same document, no reload, view follows.
   */
  openConversation(channelId: string): void;

  /**
   * Open the direct message with someone, creating it if there is none.
   *
   * `conversations.open` returns the IM's id, and opening one that did not
   * exist makes Slack navigate to it on its own; the deep link covers the rest.
   */
  openDirectMessage(userId: string): Promise<string | null>;

  /** Show someone's profile in Slack, through the same deep-link scheme. */
  openUserProfile(userId: string): void;

  /** Remove a conversation from the sidebar. The history is untouched. */
  hideConversation(channelId: string): Promise<void>;

  /** Files someone shared, newest first. */
  filesFrom(userId: string, limit?: number): Promise<Array<Record<string, unknown>>>;

  /**
   * Start a huddle with someone: open the conversation, then press Slack's own
   * start control.
   *
   * This one really is a press, and there is no way around it -- measured:
   * `rooms.join` provisions a room that rings nobody, there is no
   * `slack://huddle` scheme, and the handler goes through Electron to open a
   * separate window that no web API exposes. A plain element.click() reaches
   * it, so at least no trusted gesture is needed.
   *
   * Resolves false when Slack shows no huddle control for that conversation.
   */
  startHuddle(userId: string): Promise<boolean>;
  /**
   * Slack's own "set a status" dialog, which is two clicks rather than a URL.
   *
   * There is no deep link and no exposed action for it: the entry lives in the
   * account menu, so the menu has to be opened first. Its `data-qa` is
   * `main-menu-custom-status-item`, which is the same in every language -- the
   * label beside it is not.
   */
  openStatusEditor(): Promise<boolean>;

  /** The people marked VIP, in Slack's own order. */
  vipUsers(): Promise<string[]>;

  /**
   * Add or remove someone from your VIP list, and report the new state.
   *
   * VIP is a user preference, not an endpoint of its own: Slack keeps it in
   * `vip_users` as a comma-separated list. Read, edit, write -- which also
   * means two windows editing it at once can clobber each other, exactly as
   * they would in Slack itself.
   */
  setVip(userId: string, isVip: boolean): Promise<boolean>;

  /**
   * Slack's own web API, as the signed-in user. Reads the session token in one
   * audited place so mods never touch localStorage themselves; requests can
   * only reach Slack's own origin. See src/runtime/web-api.ts.
   */
  web: WebApi;
  /** Read channel, timestamp, permalink and text off a message element. */
  describeMessage(element: HTMLElement): MessageRef;
  /** The message composer. */
  composer: ComposerApi;
  /**
   * Somebody's status, ready to draw: the sentence, the emoji name, an image
   * for it when one resolves, and when it clears.
   */
  describeStatus(
    who: { profile?: SlackProfile } | SlackProfile | null | undefined,
    customEmoji?: Map<string, string> | null,
  ): SlackStatus | null;
  /** That status as a node, so two mods showing one draw the same thing. */
  statusNode(status: SlackStatus, profile?: SlackProfile | null): HTMLElement;
  /** The channel currently open, read from the client URL. */
  currentChannelId(): string | null;
  /**
   * The workspace the client is showing.
   *
   * Not simply the URL: at a cold start Slack restores the view before it
   * settles the address, and reading the URL then answers with the workspace
   * the user has left.
   */
  currentTeamId(): string | null;
  /** The author of a message, read from their avatar URL. */
  userIdFromMessage(message: MessageRef): string | null;

  /**
   * The same avatar at another size.
   *
   * Slack serves them as `<base>-<size>`, so asking for a bigger one is a
   * string edit rather than another request -- the rail renders a 48 and a
   * profile wants a 72, and every mod that shows a face was doing this by hand.
   * Returns null for anything that is not one of Slack's avatar URLs, which is
   * what a custom image or a data URI will be.
   */
  avatarUrl(url: string | null | undefined, size: number): string | null;
  /**
   * Slack's own translucent window, which it ships switched off.
   *
   * `set` takes effect the next time Slack starts: the window's material is
   * chosen when the window is created, and nothing in the page can restart it.
   * Tell the user so rather than leaving them to wonder why nothing happened.
   */
  desktop: {
    /** False where there is no Slack settings file to read -- Linux, mostly. */
    supported: boolean;
    /** Every preference this API will touch, with a sentence about each. */
    keys(): Array<{ key: string; type: string; restart: boolean; note: string }>;
    /** What the file says now, whether BetterSlack set it or Slack did. */
    get(key: string): unknown;
    /** What the Slack now running was launched with. */
    launched(key: string): unknown;
    /** Whether a restart is needed for `key` to take effect. */
    needsRestart(key: string): boolean;
    /** Keep a preference at a value. Refuses anything off the list, by name. */
    set(key: string, value: unknown): Promise<void>;
    /** Stop keeping it, and leave whatever is there. */
    clear(key: string): Promise<void>;
    /** Only what BetterSlack is keeping set. */
    managed(): Record<string, unknown>;

    /**
     * The translucent materials the window can wear, clearest first.
     *
     * macOS only, and live: unlike everything else here this is not a
     * preference written for the next launch but a method called on the window
     * that is already open.
     */
    materials: readonly string[];
    /**
     * Put one on, now. Answers false where the bridge does not exist.
     *
     * Slack's main process exposes a channel that runs an allow-listed set of
     * BrowserWindow methods on behalf of the page, and its preload passes it
     * through as `desktop.window.callBrowserWindowMethod`. `setVibrancy` is on
     * that list. This is the only thing BetterSlack calls through it, and the
     * names above are the only arguments it will pass.
     */
    setMaterial(name: string): Promise<boolean>;
  };

  /**
   * Stop Slack and start it again, with the loader still driving.
   *
   * For settings that are read when a window is created, so they can never
   * take effect in place. This tears down the page that called it: do nothing
   * after it but let go, and never call it without asking first.
   */
  restart(): Promise<void>;

  /** Stable selectors, for mods that need to go beyond these helpers. */
  selectors: Readonly<Record<string, string>>;
}

/*
 * The materials, measured rather than copied from Electron's documentation.
 *
 * Each was applied to a live window with the page's own backgrounds cleared and
 * photographed against the same wallpaper; the number is the first decile of
 * the frame, which is the level of the backdrop showing through. The wallpaper
 * alone reads 3, so lower is clearer:
 *
 *   none            29     the material removed; the window is still not clear,
 *                          because `transparent` is fixed when a window is made
 *   hud             22     the clearest of them
 *   fullscreen-ui   24
 *   under-window    33
 *   titlebar        43     what Slack asks for, and the frostiest
 *
 * Ordered clearest first, so a picker reads as a scale.
 */
export const WINDOW_MATERIALS = Object.freeze([
  'hud', 'fullscreen-ui', 'under-window', 'titlebar', 'none',
] as const);

/**
 * Ask Slack's own bridge to put a material on this window.
 *
 * Everything about this is deliberately narrow: one method out of the list
 * Slack's main process is willing to run, and only the arguments above. A
 * plugin runs unsandboxed, and `callBrowserWindowMethod` reaches a good deal
 * more than vibrancy.
 */
async function setMaterial(name: string): Promise<boolean> {
  if (!WINDOW_MATERIALS.includes(name as (typeof WINDOW_MATERIALS)[number])) {
    throw new Error(`"${name}" is not a window material BetterSlack will set`);
  }
  const bridge = (window as unknown as {
    desktop?: { window?: { getWindowId?: () => Promise<number>; callBrowserWindowMethod?: (...args: unknown[]) => Promise<unknown> } };
  }).desktop?.window;
  if (typeof bridge?.getWindowId !== 'function' || typeof bridge?.callBrowserWindowMethod !== 'function') {
    return false;
  }
  try {
    const id = await bridge.getWindowId();
    await bridge.callBrowserWindowMethod(id, 'setVibrancy', name === 'none' ? null : name);
    return true;
  } catch {
    return false;
  }
}

export function createSlackApi(pluginId: string): SlackApi {
  const web = createWebApi();
  return {
    addMessageAction: (action) => addMessageAction(pluginId, action),
    addToolbarButton: (toolbar, button) => addToolbarButton(pluginId, toolbar, button),
    addProfileButton: (button) => addProfileButton(pluginId, button),
    onProfilePane,
    web,

    openConversation(channelId: string): void {
      const team = currentTeamId();
      if (!team) return;
      // Assigning location.href hands the URL to the desktop app's protocol
      // handler, which routes it internally. The page itself does not navigate.
      window.location.href = `slack://channel?team=${team}&id=${encodeURIComponent(channelId)}`;
    },

    async openDirectMessage(userId: string): Promise<string | null> {
      const res = await web.call<{ channel?: { id?: string } }>('conversations.open', {
        users: userId,
        return_im: true,
      });
      const id = res.channel?.id ?? null;
      if (id) this.openConversation(id);
      return id;
    },

    openUserProfile(userId: string): void {
      const team = currentTeamId();
      if (!team) return;
      window.location.href = `slack://user?team=${team}&id=${encodeURIComponent(userId)}`;
    },

    async hideConversation(channelId: string): Promise<void> {
      await web.call('conversations.close', { channel: channelId });
    },

    async startHuddle(userId: string): Promise<boolean> {
      await this.openDirectMessage(userId);
      // The header re-renders on the way in, so wait for its control rather
      // than guessing at a delay.
      const button = await waitFor<HTMLElement>(
        '[data-qa="huddle_channel_header_button__start_button"]',
        8000,
      );
      if (!button) return false;
      button.click();
      return true;
    },

    async openStatusEditor(): Promise<boolean> {
      /*
       * The menu, then the item.
       *
       * The account menu is what holds it, and it is drawn on demand, so the
       * item cannot be waited for before the menu is asked for. The user button
       * may be hidden by a mod -- the account strip covers it -- and a hidden
       * button still takes a click, which is why this does not go looking for
       * something visible.
       */
      const button = document.querySelector<HTMLElement>('[data-qa="user-button"]');
      if (!button) return false;
      button.click();
      const item = await waitFor<HTMLElement>('[data-qa="main-menu-custom-status-item"]', 4000);
      if (!item) return false;
      item.click();
      return true;
    },

    async vipUsers(): Promise<string[]> {
      const res = await web.call<{ prefs?: { vip_users?: string } }>('users.prefs.get');
      return String(res.prefs?.vip_users ?? '').split(',').map((id) => id.trim()).filter(Boolean);
    },

    async setVip(userId: string, isVip: boolean): Promise<boolean> {
      const current = await this.vipUsers();
      const next = isVip
        ? [...new Set([...current, userId])]
        : current.filter((id) => id !== userId);
      await web.call('users.prefs.set', { name: 'vip_users', value: next.join(',') });
      return isVip;
    },

    async filesFrom(userId: string, limit = 20): Promise<Array<Record<string, unknown>>> {
      const res = await web.call<{ files?: Array<Record<string, unknown>> }>('files.list', {
        user: userId,
        count: limit,
      });
      return Array.isArray(res.files) ? res.files : [];
    },
    describeMessage,
    composer,
    describeStatus,
    statusNode,
    avatarUrl: (url, size) =>
      typeof url === 'string' && /-\d+$/.test(url) ? url.replace(/-\d+$/, `-${size}`) : null,
    userIdFromMessage: (message) =>
      userIdFromAvatarUrl(
        message.element.querySelector<HTMLImageElement>('.c-message_kit__avatar img, .c-avatar img')?.src,
      ),
    currentChannelId: () => {
      /*
       * What the client has drawn, when the URL disagrees with it.
       *
       * At a cold start Slack restores the view before it settles the address:
       * the URL named a channel in one workspace while the messages on screen
       * belonged to another. Every message Slack renders carries its channel,
       * so the screen is its own witness; the URL is used when nothing has been
       * drawn yet, and while the two agree it makes no difference which is
       * read.
       */
      const fromUrl = location.pathname.match(/\/client\/[^/]+\/([A-Z0-9]+)/i)?.[1]?.toUpperCase()
        ?? null;
      return drawnChannelId()?.toUpperCase() ?? fromUrl;
    },
    currentTeamId: () => currentTeamId(),
    /*
     * Filled in by `createPluginApi`, which is where the settings live. Left
     * inert here so `createSlackApi` still satisfies the type on its own, and
     * so a caller that somehow reaches this copy gets an honest "no" rather
     * than a promise nobody keeps.
     */
    desktop: {
      supported: false,
      keys: () => [],
      get: () => undefined,
      launched: () => undefined,
      needsRestart: () => false,
      set: async () => undefined,
      clear: async () => undefined,
      managed: () => ({}),
      materials: WINDOW_MATERIALS,
      setMaterial,
    },
    restart: async () => undefined,

    selectors: Object.freeze({
      message: MESSAGE,
      messageActions: ACTIONS_GROUP,
      composer: COMPOSER,
      composerEditor: COMPOSER_EDITOR,
      channelSidebar: '[data-qa="channel-sidebar"]',
      tabRail: '[data-qa="tab_rail_desktop"]',
      topNav: '[data-qa="top-nav"]',
      messageText: '[data-qa="message-text"]',
      profilePane: PROFILE_PANE,
      profileAvatar: PROFILE_AVATAR,
    }),
  };
}
