// Who and what you can jump to.
//
// The first version listed `users.conversations` and nothing else, which is the
// conversations you are already in. Typing a colleague's name found nobody
// unless you had a DM open with them, while Slack's own switcher found them at
// once -- and a switcher that cannot find people is a switcher you stop opening.
//
// Slack's search is what its client uses, and it is reachable: `search.modules.
// people` and `search.modules.channels`, both of which need `module` repeated
// as an argument (they answer `missing required field: module` otherwise, which
// is how this was found). People come back with their profile, channels with
// whether you are a member. Measured against a live workspace: ~300ms for
// either, so it is debounced and never blocks what is already on screen.
//
// Everything here is per workspace. Switching workspace does not reload the
// client -- same page, same objects, new team in the URL -- so a directory
// built for one workspace is wrong for the next, and the team id is checked on
// every read rather than trusted from boot.

/** What Slack's search answers with; more than this is never asked for. */
const REMOTE_COUNT = 8;
/** Long enough that typing a name is one request, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 180;
/** Conversations to hold in memory. Slack's own switcher shows far fewer. */
const CONVERSATION_LIMIT = 200;
/** Below this, a search matches half the workspace and is not worth the round trip. */
const MIN_QUERY = 2;

/**
 * A group DM, as the people in it.
 *
 * Slack names them `mpdm-alice--bob--carol-1`, which is a key rather than a
 * title: eight of those in a list, all starting with the same six characters,
 * are unreadable and unsearchable. Slack's own client shows the names, so this
 * does too.
 */
function peopleFromMpim(name) {
  if (typeof name !== 'string') return '';
  return name
    .replace(/^mpdm-/, '')
    .replace(/-\d+$/, '')
    .split('--')
    .map((handle) => handle
      .replace(/[._]/g, ' ')
      .trim()
      // Handles are lower case; a list of names reads as names.
      .replace(/\b\p{L}/gu, (letter) => letter.toUpperCase()))
    .filter(Boolean)
    .join(', ');
}

function currentTeam() {
  const match = location.pathname.match(/\/client\/(T[A-Z0-9]+)/i);
  return match ? match[1] : null;
}

/**
 * A live index of conversations and of the wider directory.
 *
 * `onResults` is called when a search lands, so whoever is showing the list can
 * paint again -- the palette stays responsive because nothing waits for this.
 */
export function createDirectory(api, { onResults }) {
  let team = currentTeam();
  /** Conversations you are in: channels, groups and DMs, with people resolved. */
  let conversations = [];
  let loadedAt = 0;
  /** The newest search answer, and the query it belongs to. */
  let remote = { query: '', people: [], channels: [] };
  let timer = null;
  let searching = false;

  /** Anything held about a workspace is wrong the moment you leave it. */
  const checkTeam = () => {
    const now = currentTeam();
    if (now === team) return;
    team = now;
    conversations = [];
    loadedAt = 0;
    remote = { query: '', people: [], channels: [] };
  };

  const load = async () => {
    checkTeam();
    if (!api.slack.web.available) return;
    if (Date.now() - loadedAt < 60_000) return;
    loadedAt = Date.now();

    try {
      const res = await api.slack.web.call('users.conversations', {
        types: 'public_channel,private_channel,mpim,im',
        exclude_archived: true,
        limit: CONVERSATION_LIMIT,
      });
      const channels = Array.isArray(res.channels) ? res.channels : [];

      const directIds = channels.filter((c) => c.is_im && c.user).map((c) => c.user);
      const people = directIds.length ? await api.slack.web.users(directIds) : new Map();

      conversations = channels.map((channel) => {
        if (channel.is_im) {
          const user = people.get(channel.user);
          const profile = user?.profile ?? {};
          return {
            id: channel.user,
            conversationId: channel.id,
            kind: 'person',
            title: profile.display_name || profile.real_name || user?.name || channel.user,
            // Their face. It is the whole reason a list of people is scannable.
            icon: profile.image_48 || profile.image_72 || '',
            hint: profile.title || profile.status_text || '',
            handle: user?.name ? `@${user.name}` : '',
          };
        }
        if (channel.is_mpim) {
          return {
            id: channel.id,
            conversationId: channel.id,
            kind: 'group',
            title: peopleFromMpim(channel.name),
            icon: '👥',
            hint: '',
            member: true,
          };
        }
        return {
          id: channel.id,
          conversationId: channel.id,
          kind: 'channel',
          title: channel.name,
          icon: channel.is_private ? '🔒' : '#',
          hint: channel.purpose?.value || channel.topic?.value || '',
          member: true,
        };
      });
    } catch (err) {
      api.log.warn('could not list conversations:', err.message);
    }
  };

  /** One search of Slack's own index, for people and channels at once. */
  const searchNow = async (query) => {
    const ask = (module) => api.slack.web.call(`search.modules.${module}`, {
      // `module` is required as an argument as well as being in the path.
      module,
      query,
      count: REMOTE_COUNT,
      page: 1,
      extracts: 0,
      highlight: 0,
      sort: 'score',
      sort_dir: 'desc',
    }).catch((err) => {
      api.log.warn(`search.modules.${module} failed:`, err.message);
      return null;
    });

    searching = true;
    const [people, channels] = await Promise.all([ask('people'), ask('channels')]);
    searching = false;
    // Someone typed on while this was in flight; the newer answer wins.
    if (remote.query !== query) return;

    remote = {
      query,
      people: (people?.items ?? []).map((item) => {
        const profile = item.profile ?? {};
        return {
          id: item.id,
          kind: 'person',
          // Slack matched it, so the client must not un-match it: someone
          // found by their email has none of the query on screen.
          remote: true,
          title: profile.display_name || profile.real_name || item.username || item.id,
          icon: profile.image_48 || profile.image_72 || '',
          hint: profile.title || profile.status_text || profile.real_name || '',
          handle: item.username ? `@${item.username}` : '',
        };
      }),
      channels: (channels?.items ?? []).map((item) => ({
        id: item.id,
        kind: 'channel',
        remote: true,
        title: item.name,
        icon: item.is_private ? '🔒' : '#',
        hint: item.purpose?.value || '',
        member: item.is_member === true,
        members: item.member_count ?? 0,
      })),
    };
    onResults();
  };

  /**
   * Ask for a query, at most once per pause in typing.
   *
   * Called from the provider on every keystroke, which is why it has to be
   * cheap and why it never returns anything: what it finds arrives through
   * `onResults`, and the caller reads it from `people()` / `channels()`.
   */
  const search = (query) => {
    checkTeam();
    if (!api.slack.web.available) return;
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY || trimmed === remote.query) return;

    remote = { query: trimmed, people: [], channels: [] };
    clearTimeout(timer);
    timer = setTimeout(() => void searchNow(trimmed), SEARCH_DEBOUNCE_MS);
  };

  /**
   * What you have, narrowed by what you typed, then what Slack found on top.
   *
   * The narrowing happens here rather than in the palette because of the order
   * things are cut: the palette ranks *after* the provider has capped its list,
   * so handing over every conversation you are in and letting the ranking sort
   * it out means the cap falls on the unranked list and the person Slack just
   * found never reaches the screen. Ask a name, get eight of your channels --
   * which is exactly what it did.
   */
  const narrow = (local, found, query) => {
    const q = query.trim().toLowerCase();
    const kept = q
      ? local.filter((entry) =>
        entry.title.toLowerCase().includes(q)
        || (entry.handle ?? '').toLowerCase().includes(q)
        || (entry.hint ?? '').toLowerCase().includes(q))
      : local;
    const seen = new Set(kept.map((entry) => entry.id));
    return [...kept, ...found.filter((entry) => !seen.has(entry.id))];
  };

  return {
    load,
    search,
    get searching() {
      return searching;
    },
    dispose: () => clearTimeout(timer),

    /** Conversations you are in, people and channels alike. */
    conversations: () => {
      checkTeam();
      return conversations;
    },
    people: (query) => {
      checkTeam();
      const local = conversations.filter((entry) => entry.kind === 'person');
      return narrow(local, query.trim().length >= MIN_QUERY ? remote.people : [], query);
    },
    channels: (query) => {
      checkTeam();
      const local = conversations.filter((entry) => entry.kind !== 'person');
      return narrow(local, query.trim().length >= MIN_QUERY ? remote.channels : [], query);
    },
  };
}
