// Slack-specific helpers exposed to plugins as `api.slack`.
//
// Everything that depends on how Slack's DOM is shaped lives here rather than
// in each mod. When Slack renames something, one file changes instead of ten,
// and mods stay readable for whoever reviews the pull request.
//
// Selectors verified against Slack 4.51 (Electron 43).

import type { Cleanup } from './dom.js';
import { h, keepMounted, onEach } from './dom.js';
import { attachTooltip, type Placement } from './ui/tooltip.js';
import { createWebApi, currentTeamId, userIdFromAvatarUrl, type WebApi } from './web-api.js';

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
    before: '.c-coachmark-anchor:has([data-qa="user-button"])',
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
  const nodeId = `slackmod-action-${pluginId}-${action.id}`;

  const cleanup = onEach<HTMLElement>(ACTIONS_GROUP, (group) => {
    if (group.querySelector(`#${CSS.escape(nodeId)}`)) return;

    const message = group.closest<HTMLElement>(MESSAGE)
      // Some surfaces (threads, saved items) put the toolbar beside the message
      // rather than inside it; fall back to whatever is currently hovered.
      ?? document.querySelector<HTMLElement>('.c-message_kit__hover--hovered')?.closest<HTMLElement>(MESSAGE)
      ?? null;
    if (!message) return;

    const button = h('button', {
      class: 'c-button-unstyled c-icon_button c-icon_button--size_smedium c-message_actions__button slackmod-action',
      type: 'button',
      'aria-label': action.label,
      'data-qa': `slackmod_${pluginId}_${action.id}`,
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
  const nodeId = `slackmod-profile-${pluginId}-${button.id}`;

  const cleanup = onEach<HTMLElement>(PROFILE_PANE, (pane) => {
    if (pane.querySelector(`#${CSS.escape(nodeId)}`)) return;

    const element = h('button', {
      class: 'c-button c-button--outline c-button--medium slackmod-profile-button',
      type: 'button',
      id: nodeId,
      'data-qa': `slackmod_${pluginId}_${button.id}`,
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
    container.append(h('div', { class: 'slackmod-profile-row' }, [element]));
  });

  return () => {
    cleanup();
    for (const node of document.querySelectorAll(`#${CSS.escape(nodeId)}`)) {
      node.closest('.slackmod-profile-row')?.remove();
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
  const nodeId = `slackmod-tb-${pluginId}-${button.id}`;

  const unmount = keepMounted(
    spec.container,
    nodeId,
    () => {
      const element = h('button', {
        class: `${spec.buttonClass} slackmod-toolbar-button`,
        type: 'button',
        'aria-label': button.label,
        'data-qa': `slackmod_${pluginId}_${button.id}`,
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
    button.before ?? spec.before ? { before: button.before ?? spec.before } : {},
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
  /** The channel currently open, read from the client URL. */
  currentChannelId(): string | null;
  /** The author of a message, read from their avatar URL. */
  userIdFromMessage(message: MessageRef): string | null;
  /** Stable selectors, for mods that need to go beyond these helpers. */
  selectors: Readonly<Record<string, string>>;
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
    userIdFromMessage: (message) =>
      userIdFromAvatarUrl(
        message.element.querySelector<HTMLImageElement>('.c-message_kit__avatar img, .c-avatar img')?.src,
      ),
    currentChannelId: () => {
      const match = location.pathname.match(/\/client\/[^/]+\/([A-Z0-9]+)/i);
      return match ? match[1]!.toUpperCase() : null;
    },
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
