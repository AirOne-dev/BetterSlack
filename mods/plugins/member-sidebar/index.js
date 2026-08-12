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
// Clicking a member opens a profile dialog of our own instead. It carries
// `data-qa="member_profile_pane"` and Slack's avatar class, which is not
// decoration: that is the contract every profile add-on in this repository
// already watches, so User Inspector's extra sections appear inside this dialog
// with no knowledge of it and no change to its code.

const COLUMN_ID = 'slackmod-member-column';

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
  overflow-y: auto;
  padding: 16px 8px;
  background: var(--dt_color-base-sec, rgba(var(--sk_foreground_min_solid, 248, 248, 248), 1));
  border-left: 1px solid var(--dt_color-otl-ter, rgba(var(--sk_foreground_low, 29, 28, 29), 0.13));
}
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
.slackmod-profile__fields { margin-top: 20px; }
.slackmod-profile__note {
  margin-top: 16px;
  font-size: 12px;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.55);
}
`;

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

    if (!api.slack.web.available) {
      api.log.warn('no Slack session token in this window, so the member column is not available');
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
     * Open Slack's own profile pane for a member, as a secondary action.
     *
     * The only route in is Slack's member list: open the channel details modal
     * (which lands on its Members tab) and click the row for this person. Rows
     * are matched on the user id inside the avatar URL rather than on the name
     * beside it, so this does not depend on the display language and does not
     * confuse two people called the same thing.
     *
     * It is not what a click does, for two reasons: it takes a second, and
     * Slack does not render that modal at all while its window is in the
     * background, so it fails exactly when a dialog of our own would not.
     */
    const openSlackProfile = async (userId) => {
      const stack = document.querySelector('[data-qa="avatar_stack"]');
      if (!stack) {
        api.ui.toast('Slack is not showing a member list for this conversation.', { variant: 'warn' });
        return;
      }
      stack.click();

      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 120));
        const modal = document.querySelector('[data-qa="channel_details_modal"]');
        if (!modal) continue;
        const match = [...modal.querySelectorAll('[data-qa="unstyled-button"]')].find((candidate) =>
          (candidate.querySelector('img')?.getAttribute('src') ?? '').includes(`-${userId}-`));
        if (match) {
          match.click();
          return;
        }
      }
      // Slack pages long member lists, so the row may not be there yet. Leaving
      // its modal open is the useful failure: the person is one search away.
      api.log.warn(`could not find ${userId} in Slack's member list`);
    };

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
     * The dialog body.
     *
     * The root carries `data-qa="member_profile_pane"` and the avatar carries
     * Slack's `p-r_member_profile__avatar__img`, which is the whole
     * compatibility story: any plugin that extends profile panes -- User
     * Inspector today -- finds this one the same way it finds Slack's, reads the
     * user id off the avatar the same way, and appends to it. Renaming either
     * of those breaks that, so do not.
     */
    const buildProfile = (userId, data) => {
      const root = api.dom.h('div', {
        class: 'slackmod-profile',
        'data-qa': 'member_profile_pane',
      });

      if (data.error) {
        root.append(api.dom.h('div', { class: 'slackmod-profile__note' }, [
          `Slack refused the request: ${data.error}`,
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

      const where = [
        active ? 'Active' : 'Away',
        localTime(user.tz_offset) ? `${localTime(user.tz_offset)} local time` : null,
        data.dnd?.dnd_enabled ? 'Do not disturb' : null,
      ].filter(Boolean).join(' · ');
      identity.append(api.dom.h('div', { class: 'slackmod-profile__presence' }, [
        api.dom.h('span', {
          class: `slackmod-profile__dot${active ? ' slackmod-profile__dot--active' : ''}`,
        }),
        where,
      ]));

      root.append(api.dom.h('div', { class: 'slackmod-profile__head' }, [avatar, identity]));

      // Slack's own field markup, through the helper, so these rows look like
      // the ones in Slack's pane rather than like something bolted on.
      const rows = [
        ['Display name', profile.display_name],
        ['Full name', profile.real_name ?? user.real_name],
        ['Title', profile.title],
        ['Email', profile.email],
        ['Phone', profile.phone],
        ['Time zone', user.tz_label ?? user.tz],
        ['Username', user.name ? `@${user.name}` : null],
        ['Member ID', user.id],
      ].filter(([, value]) => value);

      const fields = api.dom.h('div', { class: 'slackmod-profile__fields' });
      for (const [label, value] of rows) fields.append(api.helpers.field(label, String(value)));
      root.append(fields);

      root.append(api.dom.h('div', { class: 'slackmod-profile__note' }, [
        'Messaging, huddles and the rest live in Slack\'s own profile — "Open in Slack" below.',
      ]));
      return root;
    };

    const openProfileDialog = async (userId) => {
      const known = profiles.get(userId);
      const handle = api.ui.modal({
        title: 'Profile',
        width: 560,
        content: known
          ? buildProfile(userId, known)
          : api.dom.h('div', { class: 'slackmod-profile__note' }, ['Loading…']),
        actions: [
          {
            label: 'Copy member ID',
            // false keeps the dialog open: copying an id is usually the first
            // of several things you came here to do, not the last.
            onClick: () => {
              void api.helpers.copy(userId, 'Copied the member ID');
              return false;
            },
          },
          {
            label: 'Open in Slack',
            onClick: () => void openSlackProfile(userId),
          },
        ],
      });
      if (known) return;
      const data = await loadProfile(userId);
      // The dialog may already be gone; body still exists but is detached.
      if (handle.body.isConnected) handle.body.replaceChildren(buildProfile(userId, data));
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
            { label: 'Online', list: online },
            { label: 'Offline', list: people.filter((user) => presence.get(user.id) !== 'active') },
          ]
        : [{ label: 'Members', list: people }];

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
          `Online status covers the first ${PRESENCE_LIMIT}. Slack answers about one person per ` +
            'request, and asking about everyone here would hit its rate limit.',
        ]));
      }
    };

    const render = async (host, channel) => {
      const mine = ++generation;
      host.replaceChildren(api.dom.h('div', { class: 'slackmod-members__note' }, ['Loading…']));

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
        host.replaceChildren(api.dom.h('div', { class: 'slackmod-members__note' }, [
          'Slack does not list members for this conversation.',
        ]));
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
    let seen = currentChannelId();
    const watcher = setInterval(() => {
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
