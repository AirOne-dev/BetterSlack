// Who and what you can jump to.
//
// `message.js` is the other half: this finds things, that draws what one of
// them said.
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

import { messageText } from './message.js';

/** What Slack's search answers with; more than this is never asked for. */
const REMOTE_COUNT = 8;
/** Long enough that typing a name is one request, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 180;
/** Conversations to hold in memory. Slack's own switcher shows far fewer. */
const CONVERSATION_LIMIT = 200;
/** Below this, a search matches half the workspace and is not worth the round trip. */
const MIN_QUERY = 2;
/**
 * How much of a message goes on its row.
 *
 * A deploy notification is a screenful, and a row is a glance: measured on a
 * live workspace, the first result for "deploy" was 340 characters of commit
 * log. The row clamps it visually either way; this keeps it out of the ranking
 * and out of what a screen reader has to get through.
 */
const MESSAGE_CHARS = 140;
/** How many conversations are remembered as recent, per workspace. */
const RECENT_LIMIT = 24;

/**
 * Slack's markup, as the line a person reads.
 *
 * Everything a channel or a message carries is Slack's own mrkdwn, and a list
 * is the one place it is never rendered: a channel purpose came out as
 * `Point du vendredi : <https://us02web.zoom.us/j/889…>` across three lines,
 * ampersands and all. So links become their label, entities are decoded, and
 * the whole thing is one line -- a row is a glance, not a document.
 */
function plainText(value) {
  return String(value ?? '')
    // <url|label> is the label; <url> and <#C…|name> are what is left of them.
    .replace(/<([^>|]+)\|([^>]+)>/g, '$2')
    .replace(/<([^>]+)>/g, '$1')
    // Slack sends these escaped, and only these three.
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    /*
     * Emphasis, as emphasis rather than as punctuation. A row is plain text and
     * cannot show bold, so the markers are noise -- `queue is *backing up*`.
     *
     * Only `*` and a backtick. Slack's italic marker is `_`, and half the
     * handles in a workspace are snake_case: stripping it turns
     * `deploy_from_main` into `deploy from main`, which is worse than leaving
     * one asterisk in.
     */
    .replace(/\*(\S(?:[^*]*\S)?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    /*
     * A shortcode nothing can draw is never printed -- the same rule
     * `api.slack.statusNode` follows. A row is plain text, so `:satellite:` is
     * a word the reader has to skip, and a deploy notification carries two.
     */
    .replace(/:[a-z0-9_+-]+:/gi, ' ')
    // Blockquote markers, which mean nothing on one line and come in runs.
    .replace(/(^|\s)>+(\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A group DM, as the people in it.
 *
 * Slack names them `mpdm-alice--bob--carol-1`, which is a key rather than a
 * title: eight of those in a list, all starting with the same six characters,
 * are unreadable and unsearchable. Slack's own client shows the names, so this
 * does too.
 */
function peopleFromMpim(name, self) {
  if (typeof name !== 'string') return '';
  return name
    .replace(/^mpdm-/, '')
    .replace(/-\d+$/, '')
    .split('--')
    // Not yourself. Slack leaves you out of the name it draws, and a list that
    // starts with your own name every time is a list you read past.
    .filter((handle) => !self || handle.toLowerCase() !== self.toLowerCase())
    .map((handle) => handle
      .replace(/[._]/g, ' ')
      .trim()
      // Handles are lower case; a list of names reads as names.
      .replace(/\b\p{L}/gu, (letter) => letter.toUpperCase()))
    .filter(Boolean)
    .join(', ');
}

/**
 * True of the key Slack gives a group DM, which is not a name.
 *
 * `mpdm-alice--bob--carol-1`: eight of those in a list all start with the same
 * six characters, and it comes back that way from the conversation list *and*
 * from the channel search, which is where it was still showing.
 */
const isMpim = (channel) => channel?.is_mpim === true
  || typeof channel?.name === 'string' && channel.name.startsWith('mpdm-');

/**
 * A live index of conversations and of the wider directory.
 *
 * `onResults` is called when a search lands, so whoever is showing the list can
 * paint again -- the palette stays responsive because nothing waits for this.
 */
export function createDirectory(api, { onResults }) {
  /*
   * The workspace the client is showing, not the one in the URL. At a cold
   * start Slack restores the view before it settles the address, and reading
   * the URL then keys the whole directory to a workspace the user has left.
   */
  const currentTeam = () => api.slack.currentTeamId();
  let team = currentTeam();
  /** Conversations you are in: channels, groups and DMs, with people resolved. */
  let conversations = [];
  let loadedAt = 0;
  /** The newest search answer, and the query it belongs to. */
  let remote = { query: '', people: [], channels: [], messages: [] };
  let timer = null;
  let searching = false;
  /** True from the keystroke to the answer, debounce included. */
  let pending = false;
  /*
   * The workspace's custom emoji, for status shortcodes.
   *
   * One request per workspace, held rather than awaited per row: the palette
   * rebuilds its list on every keystroke. Null until it answers, and a status
   * still draws then -- from what Slack sent with the profile, or from what it
   * has already put on screen.
   */
  let customEmoji = null;
  /** Whoever a message search turned up, kept for the length of a session. */
  let authors = new Map();
  /*
   * Your own handle, for taking you out of a group DM's name.
   *
   * The name Slack gives one is a list of handles, not of ids, so the only way
   * to recognise yourself in it is to know your own -- one request, once per
   * workspace, and the name is drawn without it either way until it lands.
   */
  let selfHandle = null;
  const loadSelf = () => {
    const id = api.slack.web.selfId;
    if (!id) return;
    Promise.resolve()
      .then(() => api.slack.web.users([id]))
      .then((map) => {
        const found = map.get(id)?.name ?? null;
        if (found && found !== selfHandle) { selfHandle = found; onResults(); }
      })
      .catch(() => undefined);
  };
  const loadEmoji = () => {
    // Guarded, not merely caught: on a runtime older than this mod the method
    // is missing, and calling it throws synchronously.
    if (typeof api.slack.web?.emoji !== 'function') return;
    Promise.resolve()
      .then(() => api.slack.web.emoji())
      .then((map) => { customEmoji = map; })
      .catch(() => { customEmoji = null; });
  };
  loadEmoji();
  loadSelf();

  /**
   * Somebody's status, resolved when the row is read rather than when it is
   * cached.
   *
   * The conversation list is built once and kept, and the workspace's emoji map
   * arrives over the network after it: computed at cache time, every status
   * came out with no picture and stayed that way until the cache expired. So
   * the entry keeps the profile and the picture is looked up here, on the way
   * out, where the map is whatever it is by then.
   */
  /*
   * A group DM's name, worked out on the way out rather than when it is cached.
   *
   * It is a list of handles with your own in it, and taking yours out means
   * knowing your own handle -- which arrives over the network after the
   * conversation list has been built and stored. Computed at cache time, every
   * group DM kept your name in it until the cache expired.
   */
  const withNames = (entry) => (entry.kind === 'group' && entry.key
    ? { ...entry, title: peopleFromMpim(entry.key, selfHandle) }
    : entry);

  /** What Slack says about a conversation right now, rather than at cache time. */
  const withCounts = (entry) => {
    const row = counts.get(entry.conversationId ?? entry.id);
    if (!row?.unread) return entry;
    return { ...entry, unread: true, mentions: row.mentions };
  };

  const withStatus = (entry) => {
    if (!entry.profile || typeof api.slack.describeStatus !== 'function') return entry;
    try {
      return { ...entry, status: api.slack.describeStatus(entry.profile, customEmoji) };
    } catch {
      return entry;
    }
  };

  /** Anything held about a workspace is wrong the moment you leave it. */
  const checkTeam = () => {
    const now = currentTeam();
    if (now === team) return;
    team = now;
    conversations = [];
    loadedAt = 0;
    recents = null;
    counts = new Map();
    countsAt = 0;
    remote = { query: '', people: [], channels: [], messages: [] };
    // Different workspace, different custom emoji: a status drawn with the last
    // one's is a picture from somewhere the user has left.
    customEmoji = null;
    selfHandle = null;
    authors = new Map();
    loadEmoji();
    loadSelf();
  };

  /*
   * The list you saw last time, before the network is asked.
   *
   * Opening the palette used to mean waiting on `users.conversations` and then
   * on a batch of `users.info`, every time -- and after a restart there was
   * nothing at all until both landed. The answer is nearly always the one from
   * last time, so it is drawn first and confirmed behind you. Four workspaces'
   * worth: the value is a list of small records, and settings are a file the
   * loader reads at every launch.
   */
  const store = api.helpers.cache('conversations', { keys: 4 });

  /*
   * Where you have been, which is the best guess at where you are going.
   *
   * `users.conversations` answers in an order of its own -- roughly when you
   * joined -- so an untyped palette opened on the channel you joined in 2021 and
   * never on the two you live in. Slack's own switcher is recency-ordered, and
   * the client keeps no history a mod can read, so this keeps its own: the ids
   * opened from the palette, newest first, per workspace.
   *
   * It is deliberately what *this* opened rather than what Slack thinks is
   * recent. The list is then about the way you actually use the palette, and it
   * is right from the first use rather than after a round trip.
   */
  /*
   * Slack's own idea of where you have been, which the client asks for at boot.
   *
   * `client.counts` answers one record per conversation with `last_read`, the
   * timestamp of the last message you have read there, and `has_unreads`. It is
   * the recency the desktop client itself sorts by, it is shared across your
   * devices, and it is one request for the whole workspace. Measured against a
   * live workspace: 52 channels in one answer.
   *
   * It is not enough on its own -- `last_read` only moves when there was
   * something new to read, so a quiet channel you open every morning stays at
   * the bottom of it for ever. That is the half `recents` covers.
   */
  let counts = new Map();
  let countsAt = 0;

  const recentStore = api.helpers.cache('recents', { keys: 4 });
  let recents = null;
  const recentIds = () => {
    if (recents) return recents;
    const held = recentStore.get(team ?? 'none');
    recents = Array.isArray(held) ? held.filter((id) => typeof id === 'string') : [];
    return recents;
  };

  /*
   * One key per entry, whichever list it came out of.
   *
   * A person is the *user* id and never the DM's: they arrive from the
   * conversation list carrying both and from search carrying only the user, so
   * keying on the DM would forget somebody the moment they were opened from a
   * search. Everything else is the conversation, which is all it has.
   */
  const keyOf = (entry) => (entry.kind === 'person'
    ? entry.id
    : (entry.conversationId ?? entry.id));

  /** Remember a conversation as the last place you went. */
  const remember = (entry) => {
    const id = typeof entry === 'string' ? entry : keyOf(entry ?? {});
    if (!id) return;
    const next = [id, ...recentIds().filter((other) => other !== id)].slice(0, RECENT_LIMIT);
    recents = next;
    recentStore.set(team ?? 'none', next);
  };

  /**
   * Recently opened first, everything else in the order it came.
   *
   * Only ever a re-ordering: a switcher that *hid* what you have not opened
   * lately would be one you cannot use to reach anything new.
   */
  const byRecent = (list) => {
    const order = new Map(recentIds().map((id, at) => [id, at]));
    const rank = (entry) => order.get(keyOf(entry)) ?? Infinity;
    // Slack's reading, as a tie-break under our own: newest read first, and
    // everything Slack said nothing about after everything it did.
    const read = (entry) => -Number(counts.get(entry.conversationId ?? entry.id)?.lastRead ?? 0);
    return list
      .map((entry, at) => ({ entry, at, rank: rank(entry), read: read(entry) }))
      .sort((a, b) => (a.rank - b.rank) || (a.read - b.read) || (a.at - b.at))
      .map((row) => row.entry);
  };

  /** Everything the palette draws for a conversation, and nothing else. */
  const compact = (entry) => ({
    id: entry.id,
    conversationId: entry.conversationId,
    kind: entry.kind,
    key: entry.key,
    title: entry.title,
    icon: entry.icon,
    hint: entry.hint,
    handle: entry.handle,
    member: entry.member,
    profile: entry.profile
      ? {
        status_text: entry.profile.status_text,
        status_emoji: entry.profile.status_emoji,
        status_emoji_display_info: entry.profile.status_emoji_display_info,
        status_expiration: entry.profile.status_expiration,
      }
      : undefined,
  });

  const load = async () => {
    checkTeam();
    if (!api.slack.web.available) return;

    /*
     * Served, then confirmed. `onResults` fires only when the fresh list is not
     * the stored one, so a palette open on an unchanged workspace never
     * repaints -- and one on a changed workspace does, without having made
     * anybody wait for it.
     */
    if (conversations.length === 0) {
      const held = store.get(team ?? 'none');
      if (Array.isArray(held) && held.length) {
        conversations = held;
        onResults();
      }
    }

    if (Date.now() - loadedAt < 60_000) return;
    loadedAt = Date.now();

    /*
     * Asked for alongside the list, and never waited on: the conversations are
     * what the palette draws, and an ordering that arrives a moment later
     * re-sorts a list that is already on screen. Failing is fine -- the local
     * recents still order it.
     */
    if (Date.now() - countsAt > 30_000) {
      countsAt = Date.now();
      void api.slack.web.call('client.counts').then((res) => {
        const next = new Map();
        for (const group of ['channels', 'mpims', 'ims']) {
          for (const row of res?.[group] ?? []) {
            if (!row?.id) continue;
            next.set(row.id, {
              lastRead: Number(row.last_read ?? 0),
              // The conversation's newest message, which is what
              // `conversations.mark` wants to be told you have read.
              latest: String(row.latest ?? ''),
              unread: row.has_unreads === true,
              mentions: Number(row.mention_count ?? 0),
            });
          }
        }
        counts = next;
        onResults();
      }).catch((err) => api.log.warn('client.counts failed:', err.message));
    }

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
            // The title, not the status: the status has a place of its own on
            // the row now, and printing it twice reads as a mistake.
            hint: plainText(profile.title),
            profile,
            handle: user?.name ? `@${user.name}` : '',
          };
        }
        if (channel.is_mpim) {
          return {
            id: channel.id,
            conversationId: channel.id,
            kind: 'group',
            key: channel.name,
            title: peopleFromMpim(channel.name, selfHandle),
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
          hint: plainText(channel.purpose?.value || channel.topic?.value),
          member: true,
        };
      });
      store.set(team ?? 'none', conversations.map(compact));
    } catch (err) {
      api.log.warn('could not list conversations:', err.message);
    }
  };

  /** One search of Slack's own index: people, channels and messages at once. */
  const searchNow = async (query) => {
    const ask = (module, over = {}) => api.slack.web.call(`search.modules.${module}`, {
      // `module` is required as an argument as well as being in the path.
      module,
      query,
      count: REMOTE_COUNT,
      page: 1,
      extracts: 0,
      highlight: 0,
      sort: 'score',
      sort_dir: 'desc',
      ...over,
    }).catch((err) => {
      api.log.warn(`search.modules.${module} failed:`, err.message);
      return null;
    });

    searching = true;
    const [people, channels, messages] = await Promise.all([
      ask('people'),
      ask('channels'),
      // Messages come back nested: an item is a conversation, and the match is
      // in `messages[0]`. Extracts on, since the line is the whole point of a
      // message result -- a row saying only which channel it was in is a row
      // nobody can choose between.
      ask('messages', { extracts: 1, sort: 'timestamp' }),
    ]);
    searching = false;
    pending = false;
    // Someone typed on while this was in flight; the newer answer wins.
    if (remote.query !== query) return;

    remote = {
      query,
      messages: (messages?.items ?? []).flatMap((item) => {
        const message = (item.messages ?? [])[0];
        if (!message) return [];
        // A message with nothing readable in it is a row nobody can choose
        // between, and eight of them is a search that looks broken.
        const said = messageText(message, { users: authors });
        if (!said) return [];
        const channel = item.channel ?? {};
        return [{
          id: `${channel.id}:${message.ts}`,
          kind: 'message',
          remote: true,
          team: item.team,
          channelId: channel.id,
          ts: message.ts,
          /*
           * The plain reading and the message itself.
           *
           * `title` is what the ranking and a screen reader get; the row draws
           * `message` instead -- with the bold, the link's label and the emoji
           * that the flattening throws away.
           */
          title: said,
          message,
          authorId: message.user ?? null,
          username: message.username ?? '',
          /*
           * Where it was said, as a name rather than a key.
           *
           * A DM answers with the other person's user id and a group DM with
           * `mpdm-a--b--c-1`; `#U02U00MA8F6` under a message is worse than
           * saying nothing, since the row already carries who said it.
           */
          channelName: channel.is_im ? '' : (isMpim(channel)
            ? peopleFromMpim(channel.name, selfHandle)
            : channel.name ?? ''),
          isIm: channel.is_im === true,
        }];
      }),
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
          hint: plainText(profile.title || profile.real_name),
          profile,
          handle: item.username ? `@${item.username}` : '',
        };
      }),
      channels: (channels?.items ?? []).map((item) => (isMpim(item)
        ? {
          id: item.id,
          kind: 'group',
          remote: true,
          key: item.name,
          title: peopleFromMpim(item.name, selfHandle),
          icon: '👥',
          hint: '',
          member: item.is_member === true,
        }
        : {
          id: item.id,
          kind: 'channel',
          remote: true,
          title: item.name,
          icon: item.is_private ? '🔒' : '#',
          hint: plainText(item.purpose?.value),
          member: item.is_member === true,
          members: item.member_count ?? 0,
        })),
    };
    resolveAuthors(remote.messages, messages);
    onResults();
  };

  /*
   * The faces and the names behind a message search.
   *
   * Slack's search answers with a handle and a user id and nothing else, and a
   * row that says `erwan.martin` is a row missing the two things you actually
   * scan a list of results by: the face and the name. `web.users` is the
   * batched `users.info`, cached per workspace, so this is one request for the
   * whole page of results and usually none at all.
   */
  const resolveAuthors = (rows, raw) => {
    const wanted = new Set();
    for (const row of rows) if (row.authorId && !authors.has(row.authorId)) wanted.add(row.authorId);
    // Everybody a message mentions, too: a mention draws as a name or as an id,
    // and an id in the middle of a sentence is the raw markup showing through.
    for (const item of raw?.items ?? []) {
      const blocks = JSON.stringify((item.messages ?? [])[0]?.blocks ?? '');
      for (const [, id] of blocks.matchAll(/"user_id":"(U[A-Z0-9]+)"/g)) {
        if (!authors.has(id)) wanted.add(id);
      }
    }
    if (wanted.size === 0) return;
    Promise.resolve()
      .then(() => api.slack.web.users([...wanted]))
      .then((map) => {
        for (const [id, user] of map) authors.set(id, user);
        onResults();
      })
      .catch(() => undefined);
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
    if (trimmed.length < MIN_QUERY || trimmed === remote.query) {
      // Nothing will be asked, so nothing is being waited for. Without this the
      // spinner would sit there for a one-letter query that is never sent.
      if (trimmed.length < MIN_QUERY) pending = false;
      return;
    }

    remote = { query: trimmed, people: [], channels: [], messages: [] };
    clearTimeout(timer);
    /*
     * Waiting starts here, not when the request goes out.
     *
     * There is a debounce between the keystroke and the fetch, and during it
     * the local list has already been narrowed to nothing while Slack has not
     * been asked yet. Counting only the request left that gap saying "nothing
     * matches", then a spinner, then the answer -- three states for one wait.
     */
    pending = true;
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
    return [...byRecent(kept), ...found.filter((entry) => !seen.has(entry.id))];
  };

  return {
    load,
    search,
    remember,
    /** The newest message in a conversation, as `conversations.mark` wants it. */
    latestTs: (id) => counts.get(id)?.latest || '',
    /** What a row needs to draw a message: who is known, and what can be drawn. */
    get authors() {
      return authors;
    },
    get emoji() {
      return customEmoji;
    },
    /** Whether anything is still out: the debounce as well as the request. */
    get searching() {
      return pending || searching;
    },
    dispose: () => clearTimeout(timer),

    /** Conversations you are in, people and channels alike. */
    conversations: () => {
      checkTeam();
      return byRecent(conversations).map(withNames).map(withCounts).map(withStatus);
    },
    people: (query) => {
      checkTeam();
      const local = conversations.filter((entry) => entry.kind === 'person');
      return narrow(local, query.trim().length >= MIN_QUERY ? remote.people : [], query)
        .map(withCounts)
        .map(withStatus);
    },
    /*
     * Messages, which are only ever what Slack just answered.
     *
     * Nothing local to narrow: a message index is not something a client keeps,
     * so this is the one list with no half of its own to show while the search
     * is out.
     */
    messages: (query) => {
      checkTeam();
      return query.trim().length >= MIN_QUERY ? remote.messages : [];
    },
    channels: (query) => {
      checkTeam();
      const local = conversations.filter((entry) => entry.kind !== 'person').map(withNames);
      const found = (query.trim().length >= MIN_QUERY ? remote.channels : []).map(withNames);
      return narrow(local, found, query).map(withCounts);
    },
  };
}
