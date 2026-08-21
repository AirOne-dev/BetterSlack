// A column of the current channel's members, down the right of the message pane.
//
// Slack has no such thing: its member list is a modal you open from the channel
// header, so there is no element to restyle into a column and this has to be
// built. That is also why it is a plugin and not part of a theme -- it needs to
// know who the members are and whether they are online, and neither of those is
// something CSS can find out.
//
// Three Slack facts this leans on, all measured against 4.51:
//
//   * `users.info` accepts a comma-separated `users` list and answers with a
//     `users` array. It is not in Slack's documentation, but it is what Slack's
//     own client sends, and it turns "one request per member" into one request.
//     There is a per-user fallback below in case that ever stops being true.
//   * `users.getPresence` has no batch form. Passing `users` is accepted and
//     then ignored -- it answers about the caller instead, which is a silent
//     wrong answer rather than an error. So presence really is one call each,
//     which is why it is capped and polled slowly.
//   * A profile cannot be opened by URL. Slack keeps it out of the address bar,
//     and a synthesised `<a href="/team/U...">` is not intercepted by anything:
//     clicking one navigates the whole window away from the client. Slack's own
//     member list, in the channel details modal, is the only way in -- and it
//     only renders while the window is visible, so it is the secondary action
//     here rather than what a click does.
//
// The actions are real calls, not clicks staged on Slack's own pane. What each
// of Slack's buttons actually does was recorded by instrumenting fetch, XHR and
// history and then pressing them: "Message" turns out to be nothing but a
// navigation, and Slack's deep-link scheme performs it in place. The rest --
// hiding a conversation, listing someone's files -- are public API methods. All
// of it lives in api.slack, so any plugin can use it.
//
// Huddle and VIP are deliberately absent. Neither has a public method, and a
// button that quietly clicked Slack's own would be a puppet with the same
// label; better to not offer it than to offer something pretending.
//
// Clicking a member opens a profile dialog of our own instead. It carries
// `data-qa="member_profile_pane"` and Slack's avatar class, which is not
// decoration: that is the contract every profile add-on in this repository
// already watches, so User Inspector's extra sections appear inside this dialog
// with no knowledge of it and no change to its code.

import { HUDDLE_ICON, MESSAGE_ICON, MORE_ICON, VIP_ICON } from './icons.js';
import { STRINGS } from './strings.js';

// Also spelled out in column.css, which cannot interpolate.
const COLUMN_ID = 'betterslack-member-column';

/**
 * Is the client showing a conversation at all?
 *
 * A different question from `api.slack.currentChannelId()`, which answers
 * *which* one and falls back to any message Slack has drawn. Fils de
 * discussion, Brouillons et envoyes and Activite all draw messages belonging to
 * a dozen channels, so that fallback says "a channel" in a view that has none,
 * and the column mounted into every one of them.
 *
 * The address answers this honestly even at a cold start, when it is still
 * naming the workspace the user left: the id may be stale, but the shape of the
 * view is not. Slack's own views are lowercase routes -- `later`, `dms`,
 * `activity-inbox` -- and a conversation is an uppercase C, D or G id, so the
 * pattern is case-sensitive on purpose.
 */
const CONVERSATION_ROUTE = /\/client\/[^/]+\/[CDG][A-Z0-9]{2,}(?:\/|$)/;
const inConversation = () => CONVERSATION_ROUTE.test(location.pathname);

/** Members to render at most. Slack pages `conversations.members` beyond this. */
const MEMBER_LIMIT_DEFAULT = 100;

/**
 * Members to ask presence for. `users.getPresence` is one request each and sits
 * in a rate-limit tier that starts complaining around fifty a minute, so past
 * this the column still lists everyone, without dots.
 */
const PRESENCE_LIMIT_DEFAULT = 50;
const PRESENCE_INTERVAL_MS = 60_000;

function displayName(user) {
  const profile = user.profile ?? {};
  return profile.display_name || profile.real_name || user.real_name || user.name || user.id;
}

export default {
  async start(api) {
    /*
     * Both from the API, not from the URL.
     *
     * At a cold start Slack restores the view before it settles the address:
     * the URL named a channel in a workspace the user had left while the
     * messages on screen belonged to another. Reading the URL here listed the
     * one member of that other channel -- yourself -- a second after the right
     * people had appeared. The runtime reads what the client has drawn.
     */
    const currentTeamId = () => api.slack.currentTeamId();
    const currentChannelId = () => api.slack.currentChannelId();

    api.css(api.assets.text('column.css'));
    const t = api.i18n.strings(STRINGS);

    if (!api.slack.web.available) {
      api.log.warn(t('noToken'));
      return;
    }

    // Declared in mod.json, so the panel draws them and this reads the same
    // keys. The defaults here are the fallback for a settings file written
    // before the declaration existed.
    const MEMBER_LIMIT = api.settings.get('memberLimit', MEMBER_LIMIT_DEFAULT);
    const PRESENCE_LIMIT = api.settings.get('presenceLimit', PRESENCE_LIMIT_DEFAULT);

    /** Latest availability per user id, as api.slack.web reports it. */
    const presence = new Map();
    /*
     * The workspace's custom emoji, for the status shortcodes.
     *
     * Held rather than awaited per row: it is one request for the whole
     * workspace, and a member column redraws on every channel change. Null
     * until it answers -- a status still draws then, from what Slack sent with
     * the profile or from what it has already put on screen.
     */
    let customEmoji = null;
    const loadEmoji = () => {
      // Guarded, not just caught: `emoji` is missing on a runtime older than the
      // mod, and calling it then throws *synchronously* -- inside start(), which
      // takes the whole column down. A status is an enrichment; it is not a
      // reason for the member list to fail to appear.
      if (typeof api.slack.web?.emoji !== 'function') return;
      try {
        void api.slack.web
          .emoji()
          .then((map) => { customEmoji = map; })
          .catch(() => { customEmoji = null; });
      } catch {
        customEmoji = null;
      }
    };
    loadEmoji();

    /** The status, or null on a runtime that cannot describe one. */
    const statusOf = (who) => {
      if (typeof api.slack.describeStatus !== 'function') return null;
      try {
        return api.slack.describeStatus(who, customEmoji);
      } catch {
        return null;
      }
    };
    /** Bumped on every render so a slow response cannot paint over a newer one. */
    let generation = 0;
    /** Stops the presence poll of the channel being left. */
    let stopPolling;

    const paintPresence = () => {
      const host = document.getElementById(COLUMN_ID);
      if (!host) return;
      for (const row of host.querySelectorAll('.betterslack-members__row')) {
        const state = presence.get(row.dataset.userId);
        if (!state) continue;
        row.classList.toggle('betterslack-members__row--active', state === 'active');
        row.querySelector('.betterslack-members__dot')
          ?.classList.toggle('betterslack-members__dot--active', state === 'active');
      }
    };

    const refreshPresence = async (ids, mine) => {
      for (const id of ids.slice(0, PRESENCE_LIMIT)) {
        if (mine !== generation) return;
        // One call each: users.getPresence has no batch form -- passing `users`
        // is accepted, ignored, and answered about the caller instead.
        const { state } = await api.slack.web.availability(id);
        if (state === 'unknown') {
          // Almost always a rate limit. Stop this round rather than spending
          // the rest of the budget discovering the same thing 40 more times.
          api.log.warn('presence lookup stopped');
          return;
        }
        presence.set(id, state);
        paintPresence();
      }
    };

    /**
     * Who is already a VIP, read once and kept in step locally.
     *
     * VIP is a preference holding a comma-separated list, so the menu needs to
     * know the current state to offer add or remove rather than a blind toggle.
     */
    let vips = new Set();
    const loadVips = () => {
      vips = new Set();
      void api.slack.vipUsers().then((ids) => ids.forEach((id) => vips.add(id))).catch(() => {});
    };
    loadVips();

    /** Everything users.info holds, plus presence and do-not-disturb. */
    const profiles = new Map();
    const loadProfile = async (userId) => {
      if (profiles.has(userId)) return profiles.get(userId);
      const data = await (async () => {
        try {
          const user = await api.slack.web.userInfo(userId);
          // Both may fail without the profile being unusable: bots have no
          // presence, and dnd.info is not readable in every workspace.
          const [state, dnd] = await Promise.all([
            api.slack.web.presence(userId).catch(() => null),
            api.slack.web.dndInfo(userId).catch(() => null),
          ]);
          return { user, presence: state, dnd };
        } catch (err) {
          return { error: err.message };
        }
      })();
      profiles.set(userId, data);
      return data;
    };

    const localTime = (offsetSeconds) => {
      if (typeof offsetSeconds !== 'number') return null;
      const now = new Date();
      const there = new Date(now.getTime() + (offsetSeconds + now.getTimezoneOffset() * 60) * 1000);
      return there.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    /**
     * Our own overflow menu, in Slack's menu markup so it follows the theme.
     *
     * Every entry is a direct call. Copying needs nothing from Slack at all;
     * hiding is conversations.close; the file list is files.list rendered here
     * rather than by sending the user somewhere else.
     */
    /** Set while a menu is open, so anything else opening can take it down. */
    let closeMenu = () => {};

    const openMenu = (anchor, userId, data) => {
      const user = data?.user ?? {};
      const name = user.profile?.display_name || user.real_name || user.name || userId;

      const link = api.slack.web.teamDomain
        ? `https://${api.slack.web.teamDomain}.slack.com/team/${userId}`
        : `${location.origin}/team/${userId}`;

      // api.ui.menu is Slack's own `c-menu`, positioned for us and closed on
      // Escape or a click outside. Borrowed rather than drawn, so it follows
      // every theme -- including one being edited in the builder next door.
      closeMenu = api.ui.menu(anchor, [
        {
          label: `${t('copyName')} : @${user.name ?? name}`,
          onSelect: () => void api.helpers.copy(`@${user.name ?? name}`, t('copiedName')),
        },
        { label: t('copyId'), onSelect: () => void api.helpers.copy(userId, t('copiedId')) },
        { label: t('copyLink'), onSelect: () => void api.helpers.copy(link, t('copiedLink')) },
        { label: t('viewFiles'), onSelect: () => void showFiles(userId, name) },
        // Slack's own profile, through its deep-link scheme. Huddle and VIP
        // live there and have no public method of their own, so this is the
        // honest way to reach them: one click, Slack's real pane, no puppetry.
        { label: t('openInSlack'), onSelect: () => api.slack.openUserProfile(userId) },
        {
          label: t('hide'),
          danger: true,
          onSelect: async () => {
            try {
              const id = await api.slack.web.call('conversations.open', { users: userId, return_im: true });
              await api.slack.hideConversation(id.channel.id);
              api.ui.toast(t('hidden'));
            } catch (err) {
              api.ui.toast(t('actionFailed', { reason: err.message }), { variant: 'error' });
            }
          },
        },
      ], { align: 'left' });
    };


    /** Someone's files, in the dialog rather than by navigating away. */
    const showFiles = async (userId, name) => {
      const body = api.dom.h('div', { class: 'betterslack-profile__note' }, [t('loading')]);
      const handle = api.ui.modal({ title: t('filesTitle', { name }), width: 520, content: body });
      try {
        const files = await api.slack.filesFrom(userId, 20);
        if (!handle.body.isConnected) return;
        if (files.length === 0) {
          body.textContent = t('noFiles');
          return;
        }
        const list = api.dom.h('div', { class: 'betterslack-profile__files' });
        for (const file of files) {
          list.append(api.dom.h('a', {
            class: 'c-link betterslack-profile__file',
            href: String(file.permalink ?? '#'),
            target: '_blank',
            rel: 'noreferrer',
          }, [String(file.title || file.name || file.id)]));
        }
        handle.body.replaceChildren(list);
      } catch (err) {
        body.textContent = t('actionFailed', { reason: err.message });
      }
    };

    /**
     * The dialog body.
     *
     * The root carries `data-qa="member_profile_pane"` and the avatar carries
     * Slack's `p-r_member_profile__avatar__img`, which is the whole
     * compatibility story: any plugin that extends profile panes -- User
     * Inspector today -- finds this one the same way it finds Slack's, reads the
     * user id off the avatar the same way, and appends to it. Renaming either
     * of those breaks that, so do not.
     */
    const buildProfile = (userId, data, close = () => {}) => {
      const root = api.dom.h('div', {
        class: 'betterslack-profile',
        'data-qa': 'member_profile_pane',
        // Say who this is instead of leaving it to be read off the avatar URL:
        // a custom or bot avatar is not served from Slack's CDN and carries no
        // id at all, which left add-ons announcing they could not tell.
        'data-user-id': userId,
      });

      if (data.error) {
        root.append(api.dom.h('div', { class: 'betterslack-profile__note' }, [
          t('refused', { reason: data.error }),
        ]));
        return root;
      }

      const user = data.user;
      const profile = user.profile ?? {};
      const name = displayName(user);
      const active = data.presence?.presence === 'active';

      const avatar = api.dom.h('img', {
        class: 'p-r_member_profile__avatar__img betterslack-profile__avatar',
        alt: '',
      });
      const image = profile.image_512 ?? profile.image_192 ?? profile.image_72;
      if (image) avatar.setAttribute('src', image);

      const identity = api.dom.h('div', { class: 'betterslack-profile__identity' }, [
        api.dom.h('div', { class: 'betterslack-profile__name' }, [name]),
      ]);
      const secondLine = [profile.pronouns, profile.title].filter(Boolean).join(' · ');
      if (secondLine) {
        identity.append(api.dom.h('div', { class: 'betterslack-profile__line' }, [secondLine]));
      }
      /*
       * The status, emoji and all.
       *
       * `status_emoji` is a shortcode like `:tada:` and a workspace's custom
       * ones have no unicode behind them, so the runtime resolves it to an
       * image: what Slack sent with the profile, then the workspace's custom
       * emoji, then anything Slack has already drawn on this page.
       */
      const status = statusOf(profile);
      if (status) {
        const line = api.dom.h('div', { class: 'betterslack-profile__line' }, [
          api.slack.statusNode(status, profile),
        ]);
        if (status.expiresAt) {
          line.append(api.dom.h('span', { class: 'betterslack-profile__until' }, [
            ' · ' + t('statusUntil', { time: status.expiresAt.toLocaleTimeString(api.i18n.locale, {
              hour: '2-digit', minute: '2-digit',
            }) }),
          ]));
        }
        identity.append(line);
      }

      const clock = localTime(user.tz_offset);
      const where = [
        active ? t('active') : t('away'),
        clock ? t('localTime', { time: clock }) : null,
        data.dnd?.dnd_enabled ? t('dnd') : null,
      ].filter(Boolean).join(' · ');
      identity.append(api.dom.h('div', { class: 'betterslack-profile__presence' }, [
        api.dom.h('span', {
          class: `betterslack-profile__dot${active ? ' betterslack-profile__dot--active' : ''}`,
        }),
        where,
      ]));

      root.append(api.dom.h('div', { class: 'betterslack-profile__head' }, [avatar, identity]));

      // The same four Slack offers, in the same order, doing the same things --
      // by pressing Slack's own buttons. The overflow opens Slack's menu whole:
      // its entries have no attribute to aim at, only a localised label and an
      // id that changes on every render.
      const actions = api.dom.h('div', { class: 'betterslack-profile__actions' });

      // Slack pairs a glyph with the label on these; icon-only reads as a
      // different control entirely.
      const labelled = (svg, text) => {
        const button = api.dom.h('button', {
          class: 'c-button c-button--outline c-button--medium betterslack-profile__action',
          type: 'button',
        });
        button.innerHTML = svg;
        button.append(api.dom.h('span', {}, [text]));
        return button;
      };

      const message = labelled(MESSAGE_ICON, t('message'));
      message.addEventListener('click', () => {
        close();
        void api.slack.openDirectMessage(userId).catch((err) => {
          api.ui.toast(t('actionFailed', { reason: err.message }), { variant: 'error' });
        });
      });

      // Slack shows an ellipsis glyph, not a word, and its menu is its own.
      // This one is ours: it never reopens Slack's pane, and every entry is a
      // call rather than a click staged somewhere else.
      const more = api.dom.h('button', {
        class: 'c-button c-button--outline c-button--medium betterslack-profile__more',
        type: 'button',
        'aria-label': t('more'),
        'aria-haspopup': 'menu',
      });
      more.innerHTML = MORE_ICON;
      more.addEventListener('click', (event) => {
        event.stopPropagation();
        openMenu(more, userId, data);
      });

      // Huddle opens Slack's own preview window. It is the one action here that
      // presses a control instead of calling something: there is no API for it,
      // and the handler goes through Electron to open a window no web API
      // exposes. It at least needs no trusted gesture.
      const huddle = labelled(HUDDLE_ICON, t('huddle'));
      huddle.addEventListener('click', () => {
        close();
        void api.slack.startHuddle(userId).then((started) => {
          if (!started) api.ui.toast(t('noHuddle'), { variant: 'warn' });
        }).catch((err) => {
          api.ui.toast(t('actionFailed', { reason: err.message }), { variant: 'error' });
        });
      });

      // VIP is a button of its own, the way Slack has it, not an entry buried
      // in the overflow. It is a preference write, so the label follows the
      // current state rather than toggling blind.
      const vip = labelled(VIP_ICON, vips.has(userId) ? t('removeVip') : t('addVip'));
      vip.addEventListener('click', async () => {
        const wanted = !vips.has(userId);
        vip.disabled = true;
        try {
          await api.slack.setVip(userId, wanted);
          if (wanted) vips.add(userId); else vips.delete(userId);
          vip.replaceChildren();
          vip.innerHTML = VIP_ICON;
          vip.append(api.dom.h('span', {}, [wanted ? t('removeVip') : t('addVip')]));
          api.ui.toast(wanted ? t('vipAdded') : t('vipRemoved'));
        } catch (err) {
          api.ui.toast(t('actionFailed', { reason: err.message }), { variant: 'error' });
        } finally {
          vip.disabled = false;
        }
      });

      actions.append(message, huddle, vip, more);
      root.append(actions);

      // Slack's own field markup, through the helper, so these rows look like
      // the ones in Slack's pane rather than like something bolted on.
      const rows = [
        [t('displayName'), profile.display_name],
        [t('fullName'), profile.real_name ?? user.real_name],
        [t('title'), profile.title],
        [t('email'), profile.email],
        [t('phone'), profile.phone],
        [t('timeZone'), user.tz_label ?? user.tz],
        [t('username'), user.name ? `@${user.name}` : null],
        [t('memberId'), user.id],
      ].filter(([, value]) => value);

      const fields = api.dom.h('div', { class: 'betterslack-profile__fields' });
      for (const [label, value] of rows) fields.append(api.helpers.field(label, String(value)));
      root.append(fields);

      return root;
    };

    /** The dialog currently on screen, so a second click replaces it. */
    let openDialog = null;

    const openProfileDialog = async (userId) => {
      // Slack replaces its profile rather than stacking them, and two of these
      // on top of each other is nobody's idea of a profile view.
      openDialog?.close();
      const known = profiles.get(userId);
      // The dialog has to be able to close itself from inside its own body, and
      // the handle only exists after the call, so the buttons go through a box.
      const box = { close: () => {} };
      const close = () => box.close();
      const handle = api.ui.modal({
        title: t('profile'),
        width: 560,
        content: known
          ? buildProfile(userId, known, close)
          : api.dom.h('div', { class: 'betterslack-profile__note' }, ['Loading…']),
        // The copies Slack keeps in its overflow menu. They need nothing from
        // Slack, so they are instant and work with its window in the
        // background; false keeps the dialog open, since copying something is
        // rarely the last thing you came here to do.
        actions: [
          {
            label: t('copyName'),
            onClick: () => {
              const user = profiles.get(userId)?.user;
              const handleName = user?.name ?? user?.profile?.display_name ?? userId;
              void api.helpers.copy(`@${handleName}`, t('copiedName'));
              return false;
            },
          },
          {
            label: t('copyId'),
            onClick: () => {
              void api.helpers.copy(userId, t('copiedId'));
              return false;
            },
          },
          {
            label: t('copyLink'),
            onClick: () => {
              const domain = api.slack.web.teamDomain;
              const link = domain
                ? `https://${domain}.slack.com/team/${userId}`
                : `${location.origin}/team/${userId}`;
              void api.helpers.copy(link, t('copiedLink'));
              return false;
            },
          },
        ],
      });
      box.close = () => handle.close();
      openDialog = handle;
      if (known) return;
      const data = await loadProfile(userId);
      // The dialog may already be gone; body still exists but is detached.
      if (handle.body.isConnected) handle.body.replaceChildren(buildProfile(userId, data, close));
    };

    const row = (user) => {
      const name = displayName(user);
      const avatar = api.dom.h('img', { class: 'betterslack-members__avatar', alt: '' });
      const image = user.profile?.image_72 ?? user.profile?.image_192 ?? user.profile?.image_512;
      if (image) avatar.setAttribute('src', image);

      const active = presence.get(user.id) === 'active';
      const dot = api.dom.h('span', {
        class: `betterslack-members__dot${active ? ' betterslack-members__dot--active' : ''}`,
      });

      const button = api.dom.h('button', {
        class: `betterslack-members__row${active ? ' betterslack-members__row--active' : ''}`,
        type: 'button',
      }, [
        api.dom.h('span', { class: 'betterslack-members__figure' }, [avatar, dot]),
        api.dom.h('span', { class: 'betterslack-members__name' }, [name]),
      ]);

      /*
       * The status emoji beside the name, which is what Slack's own member list
       * shows -- the sentence is too long for a row this narrow and goes in the
       * tooltip instead.
       *
       * `showText` rather than an edited copy of the status. Handing this a
       * status with the text blanked took the sentence away from the tooltip as
       * well, so the row had a little picture on it and no way of finding out
       * what it meant -- which is the whole reason the emoji is there.
       *
       * Left, because this column is against the right edge of the window and a
       * tooltip opening right would be pinned to it.
       */
      const status = statusOf(user);
      // Only when there is a picture: an emoji nothing resolved draws nothing,
      // and an empty node would still take the row's spare width.
      if (status?.imageUrl) {
        const node = api.slack.statusNode(status, user.profile, {
          showText: false,
          placement: 'left',
        });
        node.classList.add('betterslack-members__status');
        button.append(node);
      }
      button.dataset.userId = user.id;
      button.addEventListener('click', () => void openProfileDialog(user.id));

      /*
       * No tooltip.
       *
       * The row already says the name, and a card following the pointer down a
       * column you are scanning is in the way of the thing you are scanning.
       * What the tooltip carried that the row does not -- the status sentence
       * and the title -- is one click away in the profile, and the emoji beside
       * the name is the part worth having at a glance.
       *
       * The label is set here rather than left to go with it: `helpers.tooltip`
       * was what put `aria-label` on the row, since a tooltip takes over the
       * accessible name. Dropping the call dropped the name with it, which the
       * test below caught -- the row is an icon and a first name, and a screen
       * reader needs to be told whose row it is.
       */
      button.setAttribute('aria-label', name);
      return button;
    };

    /**
     * Draw the list.
     *
     * Discord splits its member list into Online and Offline, and Slack's
     * presence is the same active/away distinction, so the grouping carries
     * over exactly. Until presence has come back there is nothing to split on,
     * so it stays one "Members" group rather than claiming everyone is offline.
     */
    const paint = (host, ids, truncated, users) => {
      const people = ids
        .map((id) => users.get(id))
        .filter((user) => user && !user.deleted)
        .sort((a, b) => displayName(a).localeCompare(displayName(b)));

      /*
       * An id the directory could not resolve is dropped from the list, and
       * dropping it silently is how a failed lookup came to look like a channel
       * with one person in it. `users.info` is per workspace and rate-limited;
       * when most of a batch fails there is nothing on screen to say so, and
       * the one row that did resolve is usually yourself -- you are in every
       * cache. Say it instead.
       */
      const unresolved = ids.length - people.length;
      if (unresolved > 0) {
        api.log.warn(`${unresolved} of ${ids.length} members could not be read`
          + ` in ${currentTeamId()} -- showing ${people.length}`);
      }

      const online = people.filter((user) => presence.get(user.id) === 'active');
      const groups = online.length > 0
        ? [
            { label: t('online'), list: online },
            { label: t('offline'), list: people.filter((user) => presence.get(user.id) !== 'active') },
          ]
        : [{ label: t('members'), list: people }];

      host.replaceChildren();
      for (const group of groups) {
        if (group.list.length === 0) continue;
        host.append(api.dom.h('div', { class: 'betterslack-members__heading' }, [
          `${group.label} — ${group.list.length}${truncated ? '+' : ''}`,
        ]));
        for (const user of group.list) host.append(row(user));
      }

      if (unresolved > 0) {
        host.append(api.dom.h('div', { class: 'betterslack-members__note' }, [
          t('unresolved', { count: unresolved }),
        ]));
      }

      if (people.length > PRESENCE_LIMIT) {
        host.append(api.dom.h('div', { class: 'betterslack-members__note' }, [
          t('presenceCap', { count: PRESENCE_LIMIT }),
        ]));
      }
    };

    /*
     * The list you saw last time, before either request is made.
     *
     * Drawing a channel meant `conversations.members` and then a batch of
     * `users.info` -- two round trips, every time you changed channel, and
     * nothing on screen until both landed. What comes back is nearly always
     * what came back before, so it is drawn from what was stored and confirmed
     * behind you.
     *
     * Twelve channels rather than the default forty: the value here is a row
     * per member, and settings are a file the loader reads at every launch. A
     * cache big enough to slow the start is worse than the network it replaced.
     */
    const store = api.helpers.cache('members', { keys: 12 });

    /** The three fields a row draws, and nothing else. */
    const compact = (ids, users) => ids
      .map((id) => users.get(id))
      .filter((user) => user && !user.deleted)
      .map((user) => ({
        id: user.id,
        name: displayName(user),
        image: user.profile?.image_72 ?? user.profile?.image_192 ?? user.profile?.image_512,
        profile: {
          status_text: user.profile?.status_text,
          status_emoji: user.profile?.status_emoji,
          status_emoji_display_info: user.profile?.status_emoji_display_info,
        },
      }));

    /** Compact rows back into the shape `paint` expects. */
    const expand = (rows) => ({
      ids: rows.map((row) => row.id),
      users: new Map(rows.map((row) => [row.id, {
        id: row.id,
        profile: { display_name: row.name, image_72: row.image, ...row.profile },
      }])),
    });

    const render = async (host, channel) => {
      const mine = ++generation;
      /*
       * The workspace this render belongs to, captured with the channel.
       *
       * `generation` catches a second render starting; it does not catch the
       * workspace changing under a render already in flight. Slack settles onto
       * its last session a moment after the client is up, so a request sent
       * against one workspace can be answered and painted while the URL --
       * and the token every later call uses -- has moved to another. What that
       * looks like is a column that lists the right people and then replaces
       * them with a single row: yourself, the only member of that id that the
       * other workspace admits to.
       */
      const team = currentTeamId();
      const key = `${team}:${channel}`;

      /*
       * Whatever was there last time, immediately -- and the loading note only
       * when there is nothing to show. A note that replaces a correct list for
       * half a second is a worse answer than the list.
       */
      const held = store.get(key);
      if (Array.isArray(held) && held.length) {
        const { ids: heldIds, users: heldUsers } = expand(held);
        paint(host, heldIds, false, heldUsers);
      } else {
        host.replaceChildren(api.dom.h('div', { class: 'betterslack-members__note' }, [t('loading')]));
      }

      let ids = [];
      let truncated = false;
      try {
        const res = await api.slack.web.call('conversations.members', {
          channel,
          limit: MEMBER_LIMIT,
        });
        ids = Array.isArray(res.members) ? res.members : [];
        truncated = Boolean(res.response_metadata?.next_cursor);
        api.log.info(`members of ${channel} in ${team}: ${ids.length}`);
      } catch (err) {
        if (mine !== generation || team !== currentTeamId()) return;
        host.replaceChildren(api.dom.h('div', { class: 'betterslack-members__note' }, [t('noMembers')]));
        api.log.warn(`could not list members of ${channel}:`, err.message);
        return;
      }

      // One request for the lot, cached across channels by the API -- and
      // dropped by it when the workspace changes, which is the part that used
      // to be this plugin's problem.
      // Both guards: a newer render, or the workspace having moved while this
      // one was in flight. Either makes this answer somebody else's.
      if (mine !== generation || team !== currentTeamId()) return;
      const users = await api.slack.web.users(ids);
      if (mine !== generation || team !== currentTeamId()) return;

      /*
       * Repainted only when the answer differs from what is already drawn.
       * Redrawing an identical list would flash every avatar for nothing, and
       * the common case is that nothing changed.
       */
      const fresh = compact(ids, users);
      if (JSON.stringify(fresh) !== JSON.stringify(held ?? null)) paint(host, ids, truncated, users);
      store.set(key, fresh);

      stopPolling?.();
      stopPolling = api.helpers.poll(async () => {
        if (mine !== generation || team !== currentTeamId() || !document.getElementById(COLUMN_ID)) return;
        await refreshPresence(ids, mine);
        if (mine !== generation || team !== currentTeamId() || !document.getElementById(COLUMN_ID)) return;
        paint(host, ids, truncated, users);
      }, PRESENCE_INTERVAL_MS);
    };

    /*
     * Dragging the edge, the way the channel sidebar is dragged.
     *
     * The handle wears Slack's own classes, so it is styled by Slack's
     * stylesheet rather than by a copy of it: same 8px hit area, same
     * `col-resize` cursor, same hover, and it follows every theme for nothing.
     * Measured against the real one before copying it.
     */
    const MIN_WIDTH = 180;
    const MAX_WIDTH = 520;
    const DEFAULT_WIDTH = 240;

    const clamp = (px) => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(px)));
    let width = clamp(Number(api.settings.get('width', DEFAULT_WIDTH)) || DEFAULT_WIDTH);

    const applyWidth = (column) => {
      column.style.flex = `0 0 ${width}px`;
    };

    const makeResizer = (column) => {
      const handle = api.dom.h('div', {
        // Slack's classes first: they are what styles it. `--sidebar` is left
        // off, since that one also positions it against the channel list.
        class: 'p-resizer p-ia4_client__resizer betterslack-members__resizer',
        role: 'none',
      });

      handle.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        handle.setPointerCapture(event.pointerId);
        document.documentElement.classList.add('betterslack-members-resizing');
        // The right edge stays put; the width is whatever is left of it.
        const right = column.getBoundingClientRect().right;

        const move = (moved) => {
          width = clamp(right - moved.clientX);
          applyWidth(column);
        };
        const done = () => {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', done);
          handle.removeEventListener('pointercancel', done);
          document.documentElement.classList.remove('betterslack-members-resizing');
          // Written once, at the end: a settings write is a message to the
          // loader, and one per pointermove is a few hundred of them per drag.
          void api.settings.set('width', width);
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', done);
        handle.addEventListener('pointercancel', done);
      });

      return handle;
    };

    api.dom.keepMounted('.p-view_contents--primary', COLUMN_ID, () => {
      const column = api.dom.h('div', {});
      applyWidth(column);
      /*
       * Two children, and the list is the one that gets replaced. `paint` calls
       * `replaceChildren`, so a handle sitting directly in the column would be
       * wiped on every redraw. The list is `display: contents`, so its children
       * are still the column's flex items and every rule about them holds.
       */
      const list = api.dom.h('div', { class: 'betterslack-members__list' });
      column.append(makeResizer(column), list);
      // Hidden until the view is known to be a conversation. The stylesheet
      // keys the whole side-by-side layout off this attribute, so a column that
      // mounts into Repertoires costs nothing and changes nothing.
      column.hidden = !inConversation();
      const channel = inConversation() ? currentChannelId() : null;
      if (channel) void render(list, channel);
      return column;
    });

    // Slack changes channel without any navigation event a mod can hook, so the
    // URL is polled. One string comparison a second is cheaper than the
    // MutationObserver on the header it would otherwise take.
    let seenTeam = currentTeamId();
    let seen = currentChannelId();

    /*
     * Show or hide the column for the view the client is on, and say whether
     * there is a conversation to list.
     *
     * Separate from the channel check below, and always ahead of it: leaving a
     * conversation for Fils de discussion does not necessarily change what
     * `currentChannelId()` answers -- that view draws messages, and the drawn
     * channel is what the runtime reads -- so an early return on "same channel"
     * would leave the column, and with it the side-by-side layout, in a view
     * that has no members.
     */
    const syncView = () => {
      const here = inConversation();
      const column = document.getElementById(COLUMN_ID);
      if (column) column.hidden = !here;
      // So that coming back redraws, rather than trusting a list left behind.
      if (!here) seen = null;
      return here;
    };

    /*
     * The Navigation API fires 40ms before Slack repaints, where a poll notices
     * after it has finished -- so the column goes with the view instead of a
     * second late, which on these views is a second of Slack's own header laid
     * down the left. The poll below is the fallback and the backstop.
     */
    const nav = typeof window === 'undefined' ? null : window.navigation;
    if (typeof nav?.addEventListener === 'function') {
      nav.addEventListener('currententrychange', syncView);
      api.onDispose(() => nav.removeEventListener('currententrychange', syncView));
    }

    const watcher = api.helpers.poll(() => {
      const team = currentTeamId();
      if (team !== seenTeam) {
        // A different workspace: different people, different VIPs. The user
        // directory belongs to api.slack.web, which drops it on the same
        // signal; what is left here is what only this plugin knows.
        seenTeam = team;
        presence.clear();
        profiles.clear();
        // A different workspace has different custom emoji, and a status drawn
        // with the last one's is a picture from somewhere the user has left.
        customEmoji = null;
        loadEmoji();
        loadVips();
        // Force the redraw: two workspaces can have the same channel id in the
        // URL, and then nothing below would notice anything had changed.
        seen = null;
      }
      if (!syncView()) return;
      const column = document.getElementById(COLUMN_ID);
      const channel = currentChannelId();
      if (channel === seen) return;
      seen = channel;
      const list = column?.querySelector('.betterslack-members__list');
      if (list && channel) void render(list, channel);
    }, 1000);

    api.onDispose(() => {
      watcher();
      stopPolling?.();
      generation++;
    });
  },
};
