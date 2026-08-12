// Discord Dark — the two pieces of Discord's layout that CSS cannot reach.
//
// Everything about colour, corners, type and the rail lives in theme.css. This
// file exists for the two things a stylesheet genuinely cannot do:
//
//   1. The account strip at the bottom of the sidebar. Slack's user button is
//      in the rail, and it holds an avatar and nothing else -- no name, no
//      status line. CSS can move a picture around; it cannot fetch a name.
//
//   2. The member column down the right. Slack has no such thing at all: its
//      member list is a modal you open from the channel header, so there is no
//      element to restyle into one. It has to be built, and building it means
//      knowing who the members are.
//
// Both are additive: they mount nodes of our own next to Slack's and never
// reparent Slack's own. That is not fussiness. Slack's tree belongs to React,
// which unmounts a node by calling removeChild on the parent it believes owns
// it -- move one and that call throws, taking the surrounding view down with
// it and leaving no clue that a theme was responsible.

const ACCOUNT_ID = 'dc-account-strip';
const MEMBERS_ID = 'dc-member-column';

/** Slack serves avatars as `<base>-<size>`; the rail renders a 48. */
function avatarAt(url, size) {
  return typeof url === 'string' ? url.replace(/-\d+$/, `-${size}`) : null;
}

/** Channel id from the client URL: /client/<team>/<channel>. */
function currentChannelId() {
  const match = location.pathname.match(/\/client\/[^/]+\/([A-Z0-9]+)/i);
  return match ? match[1].toUpperCase() : null;
}

const CSS = `
/* The sidebar becomes a column so the strip can sit under a scrolling list. */
.p-channel_sidebar { display: flex !important; flex-direction: column !important; }
.p-channel_sidebar__list { flex: 1 1 auto !important; min-height: 0 !important; }

#${ACCOUNT_ID} {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 52px;
  padding: 0 8px;
  background: var(--dc-account, #202024);
}
#${ACCOUNT_ID} .dc-me {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1 1 auto;
  min-width: 0;
  padding: 4px 6px;
  border-radius: 4px;
  cursor: pointer;
  text-align: left;
  background: none;
  border: 0;
  color: inherit;
  font: inherit;
}
#${ACCOUNT_ID} .dc-me:hover { background: var(--dc-hover, #1f1f23); }
#${ACCOUNT_ID} .dc-me__avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  flex: 0 0 auto;
  background: var(--dc-surface, #29292d);
  object-fit: cover;
}
#${ACCOUNT_ID} .dc-me__text { min-width: 0; line-height: 1.2; }
#${ACCOUNT_ID} .dc-me__name {
  font-size: 14px;
  font-weight: 600;
  color: var(--dc-bright, #fbfbfb);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#${ACCOUNT_ID} .dc-me__status {
  font-size: 12px;
  color: var(--dc-muted, #81828a);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The message pane becomes a row so the column can sit beside it. */
.p-view_contents--primary { flex-direction: row !important; }
.p-view_contents--primary > div:not(#${MEMBERS_ID}) { flex: 1 1 auto; min-width: 0; }

#${MEMBERS_ID} {
  flex: 0 0 240px;
  order: 99;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 16px 8px;
  background: var(--dc-rail, #121214);
}
#${MEMBERS_ID} .dc-members__heading {
  padding: 8px 8px 4px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--dc-muted, #81828a);
}
#${MEMBERS_ID} .dc-members__row {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 42px;
  padding: 0 8px;
  border-radius: 4px;
  cursor: default;
}
#${MEMBERS_ID} .dc-members__row:hover { background: var(--dc-hover, #1f1f23); }
#${MEMBERS_ID} .dc-members__avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  flex: 0 0 auto;
  background: var(--dc-surface, #29292d);
}
#${MEMBERS_ID} .dc-members__name {
  font-size: 16px;
  color: var(--dc-muted, #81828a);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#${MEMBERS_ID} .dc-members__note {
  padding: 8px;
  font-size: 13px;
  color: var(--dc-placeholder, #6c6d76);
}

@media (max-width: 1100px) { #${MEMBERS_ID} { display: none; } }
`;

/**
 * The account strip.
 *
 * It is our own markup rather than Slack's button moved down here, and clicking
 * it presses Slack's real one, so the menu that opens is Slack's own with all
 * of its behaviour intact.
 */
function mountAccountStrip(api) {
  const nameFor = (user) => {
    const profile = user?.profile ?? {};
    return profile.display_name || profile.real_name || user?.real_name || user?.name || null;
  };

  api.dom.keepMounted('.p-channel_sidebar', ACCOUNT_ID, () => {
    const self = api.self();

    const avatar = api.dom.h('img', { class: 'dc-me__avatar', alt: '' });
    const source = avatarAt(self.avatar, 72) ?? self.avatar;
    if (source) avatar.setAttribute('src', source);

    const name = api.dom.h('div', { class: 'dc-me__name' }, ['…']);
    // Presence is Slack's own screen-reader label, so it is already in the
    // user's language -- which is what Discord shows there too.
    const status = api.dom.h('div', { class: 'dc-me__status' }, [self.presence ?? '']);

    const me = api.dom.h('button', { class: 'dc-me', type: 'button' }, [
      avatar,
      api.dom.h('div', { class: 'dc-me__text' }, [name, status]),
    ]);
    me.addEventListener('click', () => api.click('[data-qa="user-button"]'));

    if (self.id && api.workspace) {
      api.workspace
        .userInfo(self.id)
        .then((user) => {
          name.textContent = nameFor(user) ?? '';
          const custom = user?.profile?.status_text;
          if (custom) status.textContent = custom;
        })
        .catch((err) => {
          // Not worth a visible failure: the strip still shows the avatar and
          // presence, which is most of what it is for.
          api.log.warn('could not read your profile for the account strip:', err.message);
          name.textContent = '';
        });
    }

    return api.dom.h('div', {}, [me]);
  });
}

/**
 * The member column.
 *
 * Capped at 100 people. Discord shows everyone, but Slack's API returns members
 * a page at a time and looks each one up individually, so a 2000-person channel
 * would mean 2000 requests to render a list nobody scrolls to the end of. The
 * heading says "100+" when it is truncated rather than quietly showing a subset.
 */
function mountMemberColumn(api) {
  const users = new Map();
  let generation = 0;

  const lookup = async (id) => {
    const known = users.get(id);
    if (known) return known;
    const user = await api.workspace.userInfo(id).catch(() => null);
    if (user) users.set(id, user);
    return user;
  };

  const render = async (host, channel) => {
    const mine = ++generation;
    host.replaceChildren(api.dom.h('div', { class: 'dc-members__note' }, ['Loading…']));

    let ids = [];
    let truncated = false;
    try {
      const res = await api.workspace.call('conversations.members', { channel, limit: 100 });
      ids = Array.isArray(res.members) ? res.members : [];
      truncated = Boolean(res.response_metadata?.next_cursor);
    } catch (err) {
      if (mine !== generation) return;
      host.replaceChildren(
        api.dom.h('div', { class: 'dc-members__note' }, ['Members unavailable here.']),
      );
      api.log.warn(`could not list members of ${channel}:`, err.message);
      return;
    }
    if (mine !== generation) return;

    // Sequential rather than parallel: this is Slack's API on the user's own
    // token, and a burst of 100 lookups is how a client gets rate-limited.
    const people = [];
    for (const id of ids) {
      const user = await lookup(id);
      if (mine !== generation) return;
      if (user && !user.deleted) people.push(user);
    }

    const label = (user) =>
      user.profile?.display_name || user.profile?.real_name || user.real_name || user.name || user.id;
    people.sort((a, b) => label(a).localeCompare(label(b)));

    const heading = `Members — ${people.length}${truncated ? '+' : ''}`;
    host.replaceChildren(api.dom.h('div', { class: 'dc-members__heading' }, [heading]));

    for (const user of people) {
      const avatar = api.dom.h('img', { class: 'dc-members__avatar', alt: '' });
      const image = user.profile?.image_72 ?? user.profile?.image_192;
      if (image) avatar.setAttribute('src', image);
      host.append(
        api.dom.h('div', { class: 'dc-members__row', title: label(user) }, [
          avatar,
          api.dom.h('div', { class: 'dc-members__name' }, [label(user)]),
        ]),
      );
    }
  };

  api.dom.keepMounted('.p-view_contents--primary', MEMBERS_ID, () => {
    const host = api.dom.h('div', {});
    const channel = currentChannelId();
    if (channel) void render(host, channel);
    return host;
  });

  // Slack changes channel without a navigation event anything here can hook, so
  // the URL is polled. One string comparison a second is cheaper than the
  // MutationObserver on the header it would otherwise take.
  let seen = currentChannelId();
  const timer = setInterval(() => {
    const channel = currentChannelId();
    if (channel === seen) return;
    seen = channel;
    const host = document.getElementById(MEMBERS_ID);
    if (host && channel) void render(host, channel);
  }, 1000);
  api.onDispose(() => clearInterval(timer));
}

export async function start(api) {
  api.css(CSS);
  mountAccountStrip(api);
  if (api.workspace) mountMemberColumn(api);
  else api.log.warn('no workspace permission, so the member column is not available');
}
