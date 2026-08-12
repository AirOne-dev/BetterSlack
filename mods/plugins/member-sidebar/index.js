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

const COLUMN_ID = 'slackmod-member-column';
const MENU_ID = 'slackmod-profile-menu';

/*
 * Slack's own glyphs, lifted path-for-path from its profile pane so the buttons
 * read as the ones they stand in for rather than as lookalikes. VIP is drawn to
 * match: Slack does not render that button in every workspace, so there was no
 * original to copy.
 */
const icon = (paths) =>
  '<svg viewBox="0 0 20 20" aria-hidden="true" style="height:18px;width:18px;flex:0 0 auto">' +
  paths.map((d) => `<path fill="currentColor" d="${d}"/>`).join('') + '</svg>';

const HUDDLE_ICON = icon(['M5.094 4.571C3.785 5.825 3 7.444 3 8.966v1.371A3.45 3.45 0 0 1 5.25 9.5h.5c1.064 0 1.75.957 1.75 1.904v5.192c0 .947-.686 1.904-1.75 1.904h-.5c-2.168 0-3.75-1.99-3.75-4.211v-.578q0-.105.005-.211H1.5V8.966c0-2.02 1.024-4.01 2.556-5.478C5.595 2.014 7.711 1 10 1s4.405 1.014 5.944 2.488C17.476 4.956 18.5 6.945 18.5 8.966V13.5h-.005q.005.105.005.211v.578c0 2.221-1.582 4.211-3.75 4.211h-.5c-1.064 0-1.75-.957-1.75-1.904v-5.192c0-.947.686-1.904 1.75-1.904h.5c.864 0 1.635.316 2.25.837V8.966c0-1.522-.785-3.141-2.094-4.395C13.602 3.322 11.844 2.5 10 2.5s-3.602.822-4.906 2.071m9.016 6.508a.5.5 0 0 0-.11.325v5.192c0 .145.05.257.11.325.057.066.109.079.14.079h.5c1.146 0 2.25-1.11 2.25-2.711v-.578C17 12.11 15.896 11 14.75 11h-.5c-.031 0-.083.013-.14.08M3 13.711C3 12.11 4.105 11 5.25 11h.5c.031 0 .083.013.14.08.06.067.11.18.11.324v5.192a.5.5 0 0 1-.11.325c-.057.066-.109.079-.14.079h-.5C4.105 17 3 15.89 3 14.289z']);

const MESSAGE_ICON = icon(['M10 3a7 7 0 1 0 3.394 13.124.75.75 0 0 1 .542-.074l2.794.68-.68-2.794a.75.75 0 0 1 .073-.542A7 7 0 0 0 10 3m-8.5 7a8.5 8.5 0 1 1 16.075 3.859l.904 3.714a.75.75 0 0 1-.906.906l-3.714-.904A8.5 8.5 0 0 1 1.5 10']);

const VIP_ICON = icon([
  'M8 3a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7M6 6.5a2 2 0 1 1 4 0 2 2 0 0 1-4 0',
  'M8 11.5c-2.9 0-5.25 1.79-5.25 4a.75.75 0 0 0 1.5 0c0-1.24 1.6-2.5 3.75-2.5.62 0 1.2.1 1.72.29a.75.75 0 1 0 .51-1.41A7 7 0 0 0 8 11.5',
  'M15.25 10a.75.75 0 0 1 .75.75v1.5h1.5a.75.75 0 0 1 0 1.5H16v1.5a.75.75 0 0 1-1.5 0v-1.5H13a.75.75 0 0 1 0-1.5h1.5v-1.5a.75.75 0 0 1 .75-.75',
]);

/** Slack's own overflow glyph, so the button reads as the one it stands in for. */
const MORE_ICON =
  '<svg data-qa="more-actions" viewBox="0 0 20 20" aria-hidden="true" style="--s:20px;height:20px;width:20px">' +
  '<path fill="currentColor" d="M5 10a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm6.5 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z' +
  'm5 1.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/></svg>';

const STRINGS = {
  en: {
    loading: 'Loading…',
    members: 'Members',
    online: 'Online',
    offline: 'Offline',
    noMembers: 'Slack does not list members for this conversation.',
    noToken: 'No Slack session token in this window.',
    presenceCap:
      'Online status covers the first {count}. Slack answers about one person per request, and ' +
      'asking about everyone here would hit its rate limit.',
    profile: 'Profile',
    active: 'Active',
    away: 'Away',
    localTime: '{time} local time',
    dnd: 'Do not disturb',
    message: 'Message',
    huddle: 'Huddle',
    noHuddle: 'Slack offers no huddle for this conversation.',
    more: 'More actions',
    viewFiles: 'View files',
    openInSlack: 'Open profile in Slack',
    addVip: 'Add to VIPs',
    removeVip: 'Remove from VIPs',
    vipAdded: 'Added to your VIPs',
    vipRemoved: 'Removed from your VIPs',
    hide: 'Hide conversation',
    hidden: 'Conversation hidden',
    noFiles: 'Nothing shared yet.',
    filesTitle: 'Files from {name}',
    actionFailed: 'Slack refused that: {reason}',
    displayName: 'Display name',
    fullName: 'Full name',
    title: 'Title',
    email: 'Email',
    phone: 'Phone',
    timeZone: 'Time zone',
    username: 'Username',
    memberId: 'Member ID',
    copyName: 'Copy name',
    copyId: 'Copy member ID',
    copyLink: 'Copy profile link',
    copiedName: 'Copied the display name',
    copiedId: 'Copied the member ID',
    copiedLink: 'Copied the profile link',
    noMemberList: 'Slack is not showing a member list for this conversation.',
    profileRefused: 'Slack did not open that profile. Its window may be in the background.',
    notOffered: 'Slack does not offer that for this person.',
    refused: 'Slack refused the request: {reason}',
  },
  fr: {
    loading: 'Chargement…',
    members: 'Membres',
    online: 'En ligne',
    offline: 'Hors ligne',
    noMembers: 'Slack ne donne pas la liste des membres de cette conversation.',
    noToken: 'Aucun jeton de session Slack dans cette fenêtre.',
    presenceCap:
      'La présence ne couvre que les {count} premiers. Slack répond pour une personne par requête, ' +
      'et les demander toutes atteindrait sa limite.',
    profile: 'Profil',
    active: 'Disponible',
    away: 'Absent(e)',
    localTime: '{time} heure locale',
    dnd: 'Ne pas déranger',
    message: 'Message',
    huddle: 'Appel d’équipe',
    noHuddle: 'Slack ne propose pas d’appel d’équipe pour cette conversation.',
    more: 'Plus d’actions',
    viewFiles: 'Voir les fichiers',
    openInSlack: 'Ouvrir le profil dans Slack',
    addVip: 'Ajouter aux VIP',
    removeVip: 'Retirer des VIP',
    vipAdded: 'Ajouté à vos VIP',
    vipRemoved: 'Retiré de vos VIP',
    hide: 'Masquer la conversation',
    hidden: 'Conversation masquée',
    noFiles: 'Rien de partagé pour l’instant.',
    filesTitle: 'Fichiers de {name}',
    actionFailed: 'Slack a refusé : {reason}',
    displayName: 'Nom d’affichage',
    fullName: 'Nom complet',
    title: 'Fonction',
    email: 'E-mail',
    phone: 'Téléphone',
    timeZone: 'Fuseau horaire',
    username: 'Nom d’utilisateur',
    memberId: 'ID de membre',
    copyName: 'Copier le nom',
    copyId: 'Copier l’ID de membre',
    copyLink: 'Copier le lien du profil',
    copiedName: 'Nom d’affichage copié',
    copiedId: 'ID de membre copié',
    copiedLink: 'Lien du profil copié',
    noMemberList: 'Slack n’affiche pas de liste de membres pour cette conversation.',
    profileRefused: 'Slack n’a pas ouvert ce profil. Sa fenêtre est peut-être en arrière-plan.',
    notOffered: 'Slack ne propose pas cette action pour cette personne.',
    refused: 'Slack a refusé la requête : {reason}',
  },
};

/** Members to render at most. Slack pages `conversations.members` beyond this. */
const MEMBER_LIMIT = 100;

/**
 * Members to ask presence for. `users.getPresence` is one request each and sits
 * in a rate-limit tier that starts complaining around fifty a minute, so past
 * this the column still lists everyone, without dots.
 */
const PRESENCE_LIMIT = 50;
const PRESENCE_INTERVAL_MS = 60_000;

const CSS = `
/* The pane is a column of one child; making it a row leaves room beside it. */
.p-view_contents--primary { flex-direction: row !important; }
.p-view_contents--primary > div:not(#${COLUMN_ID}) { flex: 1 1 auto; min-width: 0; }

#${COLUMN_ID} {
  flex: 0 0 240px;
  order: 99;
  display: flex;
  flex-direction: column;
  /* Without these a flex item is sized by its content, so a long list grows
     the column past the window instead of scrolling inside it. */
  min-height: 0;
  max-height: 100%;
  overflow-y: auto;
  padding: 16px 8px;
  background: var(--dt_color-base-sec, rgba(var(--sk_foreground_min_solid, 248, 248, 248), 1));
  border-left: 1px solid var(--dt_color-otl-ter, rgba(var(--sk_foreground_low, 29, 28, 29), 0.13));
}
/*
 * Nothing in the column may shrink.
 *
 * These are flex items in a flex column, so by default they give up height
 * before the container overflows: the rows quietly rendered at 34px instead of
 * 42, tightening as the window got shorter, and there was never any overflow
 * for the scrollbar to appear on. Both reported symptoms were this one line.
 */
#${COLUMN_ID} .slackmod-members__heading,
#${COLUMN_ID} .slackmod-members__row,
#${COLUMN_ID} .slackmod-members__note { flex: 0 0 auto; }

#${COLUMN_ID} .slackmod-members__heading {
  padding: 12px 8px 4px;
  font-size: 12px;
  font-weight: var(--custom-font-weight-bold, 700);
  text-transform: uppercase;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.6);
}
#${COLUMN_ID} .slackmod-members__row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  height: 42px;
  padding: 0 8px;
  border-radius: 4px;
  cursor: pointer;
  text-align: left;
  background: none;
  border: 0;
  font: inherit;
}
#${COLUMN_ID} .slackmod-members__row:hover {
  background: var(--dt_color-base-pry-hover, rgba(var(--sk_foreground_low, 29, 28, 29), 0.06));
}
#${COLUMN_ID} .slackmod-members__figure { position: relative; flex: 0 0 auto; }
#${COLUMN_ID} .slackmod-members__avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: block;
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.12);
}
/* Slack draws presence as a ring cut into the avatar; this is Discord's dot. */
#${COLUMN_ID} .slackmod-members__dot {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 3px solid var(--dt_color-base-sec, #f8f8f8);
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.4);
}
#${COLUMN_ID} .slackmod-members__dot--active {
  background: var(--dt_color-content-hgl-2, #007a5a);
}
#${COLUMN_ID} .slackmod-members__name {
  min-width: 0;
  font-size: 15px;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.7);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#${COLUMN_ID} .slackmod-members__row--active .slackmod-members__name {
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1);
}
#${COLUMN_ID} .slackmod-members__note {
  padding: 8px;
  font-size: 13px;
  line-height: 1.5;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.55);
}

/* Below this the column costs more width than it earns. */
@media (max-width: 1100px) { #${COLUMN_ID} { display: none; } }

/* The profile dialog. Slack has no class for any of this, so it is built from
   its design tokens and follows whatever theme is on. */
.slackmod-profile__head { display: flex; gap: 16px; align-items: flex-start; }
/*
 * The avatar wears Slack's own p-r_member_profile__avatar__img, because that is
 * the hook other plugins read the user id from. Borrowing the class borrows its
 * layout too: Slack positions it absolutely for its own pane, which here parked
 * it on top of the dialog's title. Everything it sets has to be undone
 * explicitly, hence the !important on a selector that is already specific.
 * (No backticks in here: this whole block is inside a template literal.)
 */
.slackmod-profile .slackmod-profile__avatar {
  position: static !important;
  inset: auto !important;
  width: 96px !important;
  height: 96px !important;
  max-width: none !important;
  border-radius: 8px !important;
  flex: 0 0 auto;
  object-fit: cover;
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.12);
}
.slackmod-profile__identity { min-width: 0; padding-top: 2px; }
.slackmod-profile__name {
  font-size: 22px;
  font-weight: var(--custom-font-weight-black, 900);
  line-height: 1.2;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1);
}
.slackmod-profile__line {
  margin-top: 4px;
  font-size: 15px;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.7);
}
.slackmod-profile__presence { display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 13px; }
.slackmod-profile__dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.5);
}
.slackmod-profile__dot--active { background: var(--dt_color-content-hgl-2, #007a5a); }
.slackmod-profile__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 18px;
}
.slackmod-profile__menu { position: fixed; top: 0; left: 0; z-index: 1100; }
.slackmod-profile__danger { color: var(--dt_color-content-imp, #c01343); }
.slackmod-profile__files { display: flex; flex-direction: column; gap: 8px; }
.slackmod-profile__file { font-size: 14px; }

/* Slack pairs a glyph with the label; the gap is its own. */
.slackmod-profile__action { display: inline-flex; align-items: center; gap: 6px; }

/* Slack's own overflow button is square and icon-only; match it. */
.slackmod-profile__more {
  min-width: 0;
  padding: 0 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.slackmod-profile__fields { margin-top: 20px; }
.slackmod-profile__note {
  margin-top: 16px;
  font-size: 12px;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.55);
}
`;

/** Team id from the client URL: /client/<team>/<channel>. */
function currentTeamId() {
  const match = location.pathname.match(/\/client\/(T[A-Z0-9]+)/i);
  return match ? match[1].toUpperCase() : null;
}

/** Channel id from the client URL: /client/<team>/<channel>. */
function currentChannelId() {
  const match = location.pathname.match(/\/client\/[^/]+\/([A-Z0-9]+)/i);
  return match ? match[1].toUpperCase() : null;
}

function displayName(user) {
  const profile = user.profile ?? {};
  return profile.display_name || profile.real_name || user.real_name || user.name || user.id;
}

export default {
  async start(api) {
    api.css(CSS);
    const t = api.i18n.strings(STRINGS);

    if (!api.slack.web.available) {
      api.log.warn(t('noToken'));
      return;
    }

    /** users.info results for this session, so switching channels is cheap. */
    const users = new Map();
    /** Latest presence per user id: "active" or "away". */
    const presence = new Map();
    /** Bumped on every render so a slow response cannot paint over a newer one. */
    let generation = 0;
    let presenceTimer;

    const fetchUsers = async (ids) => {
      const missing = ids.filter((id) => !users.has(id));
      if (missing.length === 0) return;
      try {
        const res = await api.slack.web.call('users.info', { users: missing.join(',') });
        if (Array.isArray(res.users)) {
          for (const user of res.users) users.set(user.id, user);
          return;
        }
      } catch (err) {
        api.log.warn('batched users.info failed, falling back to one call each:', err.message);
      }
      // The documented shape. Slower, but it keeps working if Slack ever drops
      // the batch form that its own client relies on.
      for (const id of missing) {
        const user = await api.slack.web.userInfo(id).catch(() => null);
        if (user) users.set(id, user);
      }
    };

    const paintPresence = () => {
      const host = document.getElementById(COLUMN_ID);
      if (!host) return;
      for (const row of host.querySelectorAll('.slackmod-members__row')) {
        const state = presence.get(row.dataset.userId);
        if (!state) continue;
        row.classList.toggle('slackmod-members__row--active', state === 'active');
        row.querySelector('.slackmod-members__dot')
          ?.classList.toggle('slackmod-members__dot--active', state === 'active');
      }
    };

    const refreshPresence = async (ids, mine) => {
      for (const id of ids.slice(0, PRESENCE_LIMIT)) {
        if (mine !== generation) return;
        try {
          const res = await api.slack.web.presence(id);
          presence.set(id, res.presence === 'active' ? 'active' : 'away');
        } catch (err) {
          // Almost always a rate limit. Stop this round rather than spending the
          // rest of the budget discovering the same thing 40 more times.
          api.log.warn('presence lookup stopped:', err.message);
          return;
        }
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
    const openMenu = (anchor, userId, data) => {
      document.getElementById(MENU_ID)?.remove();
      const user = data?.user ?? {};
      const name = user.profile?.display_name || user.real_name || user.name || userId;

      const entry = (label, run, danger = false) => {
        const button = api.dom.h('button', {
          class: 'c-button-unstyled c-menu_item__button',
          role: 'menuitem',
          type: 'button',
        }, [api.dom.h('div', {
          class: `c-menu_item__label${danger ? ' slackmod-profile__danger' : ''}`,
        }, [label])]);
        button.addEventListener('click', () => {
          closeMenu();
          void run();
        });
        return api.dom.h('div', { class: 'c-menu_item__li' }, [button]);
      };

      const link = api.slack.web.teamDomain
        ? `https://${api.slack.web.teamDomain}.slack.com/team/${userId}`
        : `${location.origin}/team/${userId}`;

      const items = api.dom.h('div', { class: 'c-menu__items', role: 'menu', tabindex: '-1' }, [
        entry(`${t('copyName')} : @${user.name ?? name}`,
          () => api.helpers.copy(`@${user.name ?? name}`, t('copiedName'))),
        entry(t('copyId'), () => api.helpers.copy(userId, t('copiedId'))),
        entry(t('copyLink'), () => api.helpers.copy(link, t('copiedLink'))),
        entry(t('viewFiles'), () => showFiles(userId, name)),
        // Slack's own profile, through its deep-link scheme. Huddle and VIP
        // live there and have no public method of their own, so this is the
        // honest way to reach them: one click, Slack's real pane, no puppetry.
        entry(t('openInSlack'), () => {
          close();
          api.slack.openUserProfile(userId);
        }),
        entry(t('hide'), async () => {
          try {
            const id = await api.slack.web.call('conversations.open', { users: userId, return_im: true });
            await api.slack.hideConversation(id.channel.id);
            api.ui.toast(t('hidden'));
          } catch (err) {
            api.ui.toast(t('actionFailed', { reason: err.message }), { variant: 'error' });
          }
        }, true),
      ]);

      const layer = api.dom.h('div', { id: MENU_ID, class: 'slackmod-profile__menu' }, [
        api.dom.h('div', { class: 'c-menu' }, [
          api.dom.h('div', { class: 'c-menu__items_scroller' }, [items]),
        ]),
      ]);
      document.body.append(layer);

      const rect = anchor.getBoundingClientRect();
      const box = layer.getBoundingClientRect();
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - box.width - 8));
      const top = rect.bottom + box.height > window.innerHeight
        ? rect.top - box.height - 4
        : rect.bottom + 4;
      layer.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
      setTimeout(() => document.addEventListener('mousedown', onDocumentDown, true), 0);
    };

    const closeMenu = () => {
      document.getElementById(MENU_ID)?.remove();
      document.removeEventListener('mousedown', onDocumentDown, true);
    };
    const onDocumentDown = (event) => {
      const menu = document.getElementById(MENU_ID);
      if (menu && !menu.contains(event.target)) closeMenu();
    };
    api.onDispose(closeMenu);

    /** Someone's files, in the dialog rather than by navigating away. */
    const showFiles = async (userId, name) => {
      const body = api.dom.h('div', { class: 'slackmod-profile__note' }, [t('loading')]);
      const handle = api.ui.modal({ title: t('filesTitle', { name }), width: 520, content: body });
      try {
        const files = await api.slack.filesFrom(userId, 20);
        if (!handle.body.isConnected) return;
        if (files.length === 0) {
          body.textContent = t('noFiles');
          return;
        }
        const list = api.dom.h('div', { class: 'slackmod-profile__files' });
        for (const file of files) {
          list.append(api.dom.h('a', {
            class: 'c-link slackmod-profile__file',
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
        class: 'slackmod-profile',
        'data-qa': 'member_profile_pane',
        // Say who this is instead of leaving it to be read off the avatar URL:
        // a custom or bot avatar is not served from Slack's CDN and carries no
        // id at all, which left add-ons announcing they could not tell.
        'data-user-id': userId,
      });

      if (data.error) {
        root.append(api.dom.h('div', { class: 'slackmod-profile__note' }, [
          t('refused', { reason: data.error }),
        ]));
        return root;
      }

      const user = data.user;
      const profile = user.profile ?? {};
      const name = displayName(user);
      const active = data.presence?.presence === 'active';

      const avatar = api.dom.h('img', {
        class: 'p-r_member_profile__avatar__img slackmod-profile__avatar',
        alt: '',
      });
      const image = profile.image_512 ?? profile.image_192 ?? profile.image_72;
      if (image) avatar.setAttribute('src', image);

      const identity = api.dom.h('div', { class: 'slackmod-profile__identity' }, [
        api.dom.h('div', { class: 'slackmod-profile__name' }, [name]),
      ]);
      const secondLine = [profile.pronouns, profile.title].filter(Boolean).join(' · ');
      if (secondLine) {
        identity.append(api.dom.h('div', { class: 'slackmod-profile__line' }, [secondLine]));
      }
      // status_emoji is a shortcode like `:tada:`, and a workspace's custom
      // ones have no unicode to fall back on, so printing it raw is worse than
      // leaving it out. The text is the part that carries meaning.
      if (profile.status_text) {
        identity.append(api.dom.h('div', { class: 'slackmod-profile__line' }, [profile.status_text]));
      }

      const clock = localTime(user.tz_offset);
      const where = [
        active ? t('active') : t('away'),
        clock ? t('localTime', { time: clock }) : null,
        data.dnd?.dnd_enabled ? t('dnd') : null,
      ].filter(Boolean).join(' · ');
      identity.append(api.dom.h('div', { class: 'slackmod-profile__presence' }, [
        api.dom.h('span', {
          class: `slackmod-profile__dot${active ? ' slackmod-profile__dot--active' : ''}`,
        }),
        where,
      ]));

      root.append(api.dom.h('div', { class: 'slackmod-profile__head' }, [avatar, identity]));

      // The same four Slack offers, in the same order, doing the same things --
      // by pressing Slack's own buttons. The overflow opens Slack's menu whole:
      // its entries have no attribute to aim at, only a localised label and an
      // id that changes on every render.
      const actions = api.dom.h('div', { class: 'slackmod-profile__actions' });

      // Slack pairs a glyph with the label on these; icon-only reads as a
      // different control entirely.
      const labelled = (svg, text) => {
        const button = api.dom.h('button', {
          class: 'c-button c-button--outline c-button--medium slackmod-profile__action',
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
        class: 'c-button c-button--outline c-button--medium slackmod-profile__more',
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

      const fields = api.dom.h('div', { class: 'slackmod-profile__fields' });
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
          : api.dom.h('div', { class: 'slackmod-profile__note' }, ['Loading…']),
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
      const avatar = api.dom.h('img', { class: 'slackmod-members__avatar', alt: '' });
      const image = user.profile?.image_72 ?? user.profile?.image_192 ?? user.profile?.image_512;
      if (image) avatar.setAttribute('src', image);

      const active = presence.get(user.id) === 'active';
      const dot = api.dom.h('span', {
        class: `slackmod-members__dot${active ? ' slackmod-members__dot--active' : ''}`,
      });

      const button = api.dom.h('button', {
        class: `slackmod-members__row${active ? ' slackmod-members__row--active' : ''}`,
        type: 'button',
      }, [
        api.dom.h('span', { class: 'slackmod-members__figure' }, [avatar, dot]),
        api.dom.h('span', { class: 'slackmod-members__name' }, [name]),
      ]);
      button.dataset.userId = user.id;
      button.addEventListener('click', () => void openProfileDialog(user.id));

      // Slack's own tooltip markup rather than a native title: a native one
      // would show as well as this, and half a second later.
      // Trimmed before the truthiness test: a profile field holding a single
      // space is truthy, and would render a tooltip subtitle made of nothing.
      const subtitle = (user.profile?.title || user.profile?.status_text || '').trim() || undefined;
      api.helpers.tooltip(button, name, subtitle);
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
    const paint = (host, ids, truncated) => {
      const people = ids
        .map((id) => users.get(id))
        .filter((user) => user && !user.deleted)
        .sort((a, b) => displayName(a).localeCompare(displayName(b)));

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
        host.append(api.dom.h('div', { class: 'slackmod-members__heading' }, [
          `${group.label} — ${group.list.length}${truncated ? '+' : ''}`,
        ]));
        for (const user of group.list) host.append(row(user));
      }

      if (people.length > PRESENCE_LIMIT) {
        host.append(api.dom.h('div', { class: 'slackmod-members__note' }, [
          t('presenceCap', { count: PRESENCE_LIMIT }),
        ]));
      }
    };

    const render = async (host, channel) => {
      const mine = ++generation;
      host.replaceChildren(api.dom.h('div', { class: 'slackmod-members__note' }, [t('loading')]));

      let ids = [];
      let truncated = false;
      try {
        const res = await api.slack.web.call('conversations.members', {
          channel,
          limit: MEMBER_LIMIT,
        });
        ids = Array.isArray(res.members) ? res.members : [];
        truncated = Boolean(res.response_metadata?.next_cursor);
      } catch (err) {
        if (mine !== generation) return;
        host.replaceChildren(api.dom.h('div', { class: 'slackmod-members__note' }, [t('noMembers')]));
        api.log.warn(`could not list members of ${channel}:`, err.message);
        return;
      }

      await fetchUsers(ids);
      if (mine !== generation) return;
      paint(host, ids, truncated);

      clearTimeout(presenceTimer);
      const tick = () => {
        void refreshPresence(ids, mine).then(() => {
          if (mine !== generation || !document.getElementById(COLUMN_ID)) return;
          paint(host, ids, truncated);
          presenceTimer = setTimeout(tick, PRESENCE_INTERVAL_MS);
        });
      };
      tick();
    };

    api.dom.keepMounted('.p-view_contents--primary', COLUMN_ID, () => {
      const host = api.dom.h('div', {});
      const channel = currentChannelId();
      if (channel) void render(host, channel);
      return host;
    });

    // Slack changes channel without any navigation event a mod can hook, so the
    // URL is polled. One string comparison a second is cheaper than the
    // MutationObserver on the header it would otherwise take.
    let seenTeam = currentTeamId();
    let seen = currentChannelId();
    const watcher = setInterval(() => {
      const team = currentTeamId();
      if (team !== seenTeam) {
        // A different workspace: different people, different VIPs, and the
        // cached users belong to the one we left.
        seenTeam = team;
        users.clear();
        presence.clear();
        profiles.clear();
        loadVips();
        // Force the redraw: two workspaces can have the same channel id in the
        // URL, and then nothing below would notice anything had changed.
        seen = null;
      }
      const channel = currentChannelId();
      if (channel === seen) return;
      seen = channel;
      const host = document.getElementById(COLUMN_ID);
      if (host && channel) void render(host, channel);
    }, 1000);

    api.onDispose(() => {
      clearInterval(watcher);
      clearTimeout(presenceTimer);
      generation++;
    });
  },
};
