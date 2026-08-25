/**
 * Slack's own realtime events, as something a mod can listen to.
 *
 * Slack keeps a socket per workspace and pushes everything that happens in
 * every conversation you are in down it -- a message, an edit, a deletion, a
 * reaction -- whether or not that conversation is open. Measured against a
 * live client: a message for a channel in a workspace the window was not even
 * showing arrived while the client sat on another one. It is how the unread
 * badges in the sidebar move without you looking at them.
 *
 * **The page cannot see it, and this is not for want of trying.** Slack's own
 * bundle opens the socket before anything else runs, so patching `WebSocket`
 * in the renderer catches nothing. The loader reads the frames off the
 * debugging protocol, where they are visible whatever the bundle does, and
 * pushes them here.
 *
 * **Listening is not reading.** Slack marks a conversation read when its
 * client sends `conversations.mark`; being told a message exists sends
 * nothing. A mod that watches every conversation this way leaves every unread
 * exactly as it was, which is the whole reason this exists rather than a mod
 * opening conversations to look at them.
 *
 * The filter is the point of the shape below. Nothing is forwarded until a mod
 * asks for a type, and the loader does not even switch its tap on before then,
 * so a client whose mods do not listen pays nothing at all.
 */

import type { Bridge } from './rpc.js';
import type { SlackEvent } from '../shared/protocol.js';

export type SlackEventHandler = (event: SlackEvent) => void;
type Off = () => void;

/** A message somebody posted. */
export interface PostedMessage {
  channelId: string;
  /** The workspace it belongs to, taken from the socket it arrived on. */
  teamId: string | null;
  ts: string;
  userId: string | null;
  /** Slack's own markup, not what the client draws. See `renderMrkdwn`. */
  text: string;
  /** The message it replies to, or null for one in the conversation itself. */
  threadTs: string | null;
  subtype: string | null;
  /**
   * The app that posted it, where an app did.
   *
   * Worth its own field rather than left in `raw`: an app's message is one
   * nobody typed, and an app rewriting or removing its own -- a deploy status
   * moving on, an alert resolving -- is the loudest thing on this socket.
   */
  botId: string | null;
  /** Slack's frame, untouched, for anything this shape leaves out. */
  raw: SlackEvent;
}

/** A message somebody rewrote. Both wordings are Slack's own account of it. */
export interface EditedMessage {
  channelId: string;
  teamId: string | null;
  ts: string;
  userId: string | null;
  before: string;
  after: string;
  /** The app whose message this is, where an app posted it. */
  botId: string | null;
  raw: SlackEvent;
}

/** A message somebody deleted, with what it said. */
export interface DeletedMessage {
  channelId: string;
  teamId: string | null;
  ts: string;
  userId: string | null;
  text: string;
  /** The app whose message this was, where an app posted it. */
  botId: string | null;
  raw: SlackEvent;
}

/** A reaction arriving or being taken back, which the socket attributes. */
export interface ReactionChange {
  added: boolean;
  channelId: string;
  teamId: string | null;
  /** The message reacted to, never the moment the reaction happened. */
  ts: string;
  /** The shortcode, without its colons. */
  emoji: string;
  userId: string;
  raw: SlackEvent;
}

/** Somebody arriving in or leaving a conversation. */
export interface MembershipChange {
  joined: boolean;
  channelId: string;
  teamId: string | null;
  userId: string;
  raw: SlackEvent;
}

/** A conversation created, renamed, archived or deleted. */
export interface ConversationChange {
  kind: 'created' | 'renamed' | 'archived' | 'unarchived' | 'deleted';
  channelId: string;
  teamId: string | null;
  /** The new name where there is one, which a rename and a creation carry. */
  name: string | null;
  raw: SlackEvent;
}

/** Somebody's profile as Slack now has it: their name, their status, their face. */
export interface UserChange {
  userId: string;
  teamId: string | null;
  user: Record<string, unknown>;
  raw: SlackEvent;
}

export interface PresenceChange {
  userIds: string[];
  presence: string;
  teamId: string | null;
  raw: SlackEvent;
}

export interface TypingSignal {
  channelId: string;
  teamId: string | null;
  userId: string;
  raw: SlackEvent;
}

/** A conversation you have caught up on, and how far. */
export interface ReadMark {
  channelId: string;
  teamId: string | null;
  ts: string;
  raw: SlackEvent;
}

/** A message pinned or unpinned, or saved for later. */
export interface MarkedMessage {
  added: boolean;
  channelId: string | null;
  teamId: string | null;
  ts: string | null;
  raw: SlackEvent;
}

/** The workspace's custom emoji changing under a mod that drew one. */
export interface EmojiChange {
  kind: string;
  names: string[];
  teamId: string | null;
  raw: SlackEvent;
}

/**
 * Slack's realtime events, named.
 *
 * `on` is the whole surface and everything else is a reading of it: Slack's
 * frames are shaped for its own client rather than for a reader, and every mod
 * that wanted a deletion was about to write the same three lines finding the
 * text in `previous_message`. Each of these hands over what the event is
 * *about*, and `raw` for whatever the shape leaves out.
 */
export interface SlackEvents {
  /**
   * Any of Slack's own event types, as Slack sent them.
   *
   * The escape hatch under everything below: Slack pushes far more than this
   * names, and a mod that needs one of the others should not have to wait for
   * a release to get at it.
   */
  on(types: string[], handler: SlackEventHandler): Off;

  /** A message posted, anywhere you are. Not an edit, a deletion or a join. */
  onMessage(handler: (message: PostedMessage) => void): Off;
  /**
   * A message rewritten, with both wordings.
   *
   * Only when the words actually moved: Slack sends `message_changed` when an
   * unfurl attaches too, and a history full of edits nobody made is worse than
   * one that misses a few.
   */
  onMessageChanged(handler: (edit: EditedMessage) => void): Off;
  /** A message deleted, with what it said. */
  onMessageDeleted(handler: (deletion: DeletedMessage) => void): Off;
  /**
   * A reaction arriving or being taken back, in one listener.
   *
   * Both directions, because a mod that cares about one nearly always cares
   * about the other, and `added` is one field against two subscriptions.
   */
  onReaction(handler: (reaction: ReactionChange) => void): Off;

  /** Somebody joining or leaving a conversation. */
  onMembership(handler: (change: MembershipChange) => void): Off;
  /** A conversation created, renamed, archived, unarchived or deleted. */
  onConversation(handler: (change: ConversationChange) => void): Off;
  /** Somebody's profile as Slack now has it: name, status, face, title. */
  onUserChanged(handler: (change: UserChange) => void): Off;
  /** Somebody going active or away. Slack's own dot, without asking for it. */
  onPresence(handler: (change: PresenceChange) => void): Off;
  /** Somebody typing in a conversation. */
  onTyping(handler: (signal: TypingSignal) => void): Off;
  /** A conversation marked read, and how far -- including by another device. */
  onRead(handler: (mark: ReadMark) => void): Off;
  /** A message pinned or unpinned. */
  onPin(handler: (pin: MarkedMessage) => void): Off;
  /** A message saved for later, or taken off the list. */
  onSaved(handler: (star: MarkedMessage) => void): Off;
  /** The workspace's custom emoji changing under a mod that drew one. */
  onEmojiChanged(handler: (change: EmojiChange) => void): Off;

  /** Hand an event from the loader to whoever asked for it. */
  deliver(event: SlackEvent): void;
  /** Every type currently asked for, which is what the loader is told. */
  watching(): string[];
}

/** The subtypes of `message` that are not somebody posting a message. */
const NOT_A_POST = new Set([
  'message_changed', 'message_deleted', 'message_replied',
  'channel_join', 'channel_leave', 'group_join', 'group_leave',
]);

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const orNull = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

export function createSlackEvents(bridge: Pick<Bridge, 'request'>): SlackEvents {
  const subscriptions = new Set<{ types: Set<string>; handler: SlackEventHandler }>();
  let told = '';

  const watching = (): string[] => {
    const all = new Set<string>();
    for (const sub of subscriptions) for (const type of sub.types) all.add(type);
    return [...all].sort();
  };

  /*
   * Told once per change, and never once per subscription.
   *
   * Two mods starting in the same tick would otherwise send two filters and
   * have the loader switch its tap on twice; a mod stopping would send a
   * third. Compared as text because that is what matters -- the same types in
   * another order is the same filter.
   */
  const publish = (): void => {
    const types = watching();
    const key = types.join(',');
    if (key === told) return;
    told = key;
    void bridge.request({ type: 'slack.watch', types }).catch(() => {
      // A loader that will not take the filter is one that sends nothing,
      // which is where this was before anybody asked. Nothing to say.
      told = '';
    });
  };

  const on = (types: string[], handler: SlackEventHandler): Off => {
    const sub = { types: new Set(types.filter(Boolean)), handler };
    subscriptions.add(sub);
    publish();
    return () => {
      subscriptions.delete(sub);
      publish();
    };
  };

  /** A listener that only hears the frames a reading could be made of. */
  const shaped = <T>(
    types: string[],
    read: (event: SlackEvent) => T | null,
    handler: (value: T) => void,
  ): Off => on(types, (event) => {
    const value = read(event);
    if (value !== null) handler(value);
  });

  const team = (event: SlackEvent): string | null => orNull(event.teamId) ?? orNull(event.team);

  return {
    on,
    watching,

    onMessage: (handler) => shaped(['message'], (event) => {
      const subtype = orNull(event.subtype);
      if (subtype && NOT_A_POST.has(subtype)) return null;
      const channelId = orNull(event.channel);
      const ts = orNull(event.ts);
      if (!channelId || !ts) return null;
      return {
        channelId,
        teamId: team(event),
        ts,
        userId: orNull(event.user),
        text: str(event.text),
        threadTs: orNull(event.thread_ts),
        subtype,
        botId: orNull(event.bot_id) ?? orNull(event.app_id),
        raw: event,
      } satisfies PostedMessage;
    }, handler),

    onMessageChanged: (handler) => shaped(['message'], (event) => {
      if (event.subtype !== 'message_changed') return null;
      const message = (event.message ?? {}) as Record<string, unknown>;
      const previous = (event.previous_message ?? {}) as Record<string, unknown>;
      const channelId = orNull(event.channel);
      const ts = orNull(message.ts) ?? orNull(event.ts);
      const before = str(previous.text);
      const after = str(message.text);
      // An unfurl attaching sends one of these too, and it is not an edit.
      if (!channelId || !ts || !before || before === after) return null;
      return {
        channelId,
        teamId: team(event),
        ts,
        userId: orNull(message.user) ?? orNull(previous.user),
        before,
        after,
        botId: orNull(message.bot_id) ?? orNull(previous.bot_id)
          ?? orNull(message.app_id) ?? orNull(previous.app_id),
        raw: event,
      } satisfies EditedMessage;
    }, handler),

    onMessageDeleted: (handler) => shaped(['message'], (event) => {
      if (event.subtype !== 'message_deleted') return null;
      const previous = (event.previous_message ?? {}) as Record<string, unknown>;
      const channelId = orNull(event.channel);
      const ts = orNull(event.deleted_ts) ?? orNull(previous.ts);
      if (!channelId || !ts) return null;
      return {
        channelId,
        teamId: team(event),
        ts,
        userId: orNull(previous.user),
        text: str(previous.text),
        botId: orNull(previous.bot_id) ?? orNull(previous.app_id),
        raw: event,
      } satisfies DeletedMessage;
    }, handler),

    onReaction: (handler) => shaped(['reaction_added', 'reaction_removed'], (event) => {
      const item = (event.item ?? {}) as Record<string, unknown>;
      const channelId = orNull(item.channel) ?? orNull(event.channel);
      const ts = orNull(item.ts);
      const userId = orNull(event.user);
      const emoji = orNull(event.reaction);
      if (!channelId || !ts || !userId || !emoji) return null;
      return {
        added: event.type === 'reaction_added',
        channelId,
        teamId: team(event),
        ts,
        emoji,
        userId,
        raw: event,
      } satisfies ReactionChange;
    }, handler),

    onMembership: (handler) => shaped(
      ['member_joined_channel', 'member_left_channel', 'message'],
      (event) => {
        const joining = event.type === 'member_joined_channel' || event.subtype === 'channel_join'
          || event.subtype === 'group_join';
        const leaving = event.type === 'member_left_channel' || event.subtype === 'channel_leave'
          || event.subtype === 'group_leave';
        if (!joining && !leaving) return null;
        const channelId = orNull(event.channel);
        const userId = orNull(event.user);
        if (!channelId || !userId) return null;
        return { joined: joining, channelId, teamId: team(event), userId, raw: event } satisfies MembershipChange;
      },
      handler,
    ),

    onConversation: (handler) => shaped(
      ['channel_created', 'channel_rename', 'channel_archive', 'channel_unarchive', 'channel_deleted',
        'group_rename', 'group_archive', 'group_unarchive'],
      (event) => {
        const channel = (typeof event.channel === 'object' && event.channel
          ? event.channel : {}) as Record<string, unknown>;
        const channelId = orNull(channel.id) ?? orNull(event.channel);
        if (!channelId) return null;
        const kind = event.type.includes('created') ? 'created'
          : event.type.includes('rename') ? 'renamed'
            : event.type.includes('unarchive') ? 'unarchived'
              : event.type.includes('archive') ? 'archived' : 'deleted';
        return {
          kind: kind as ConversationChange['kind'],
          channelId,
          teamId: team(event),
          name: orNull(channel.name),
          raw: event,
        } satisfies ConversationChange;
      },
      handler,
    ),

    onUserChanged: (handler) => shaped(['user_change'], (event) => {
      const user = (event.user ?? {}) as Record<string, unknown>;
      const userId = orNull(user.id);
      if (!userId) return null;
      return { userId, teamId: team(event) ?? orNull(user.team_id), user, raw: event } satisfies UserChange;
    }, handler),

    onPresence: (handler) => shaped(['presence_change'], (event) => {
      // Slack sends one id or a list of them, depending on how it was asked.
      const userIds = Array.isArray(event.users)
        ? (event.users as unknown[]).map(str).filter(Boolean)
        : [orNull(event.user)].filter((id): id is string => Boolean(id));
      if (userIds.length === 0) return null;
      return { userIds, presence: str(event.presence), teamId: team(event), raw: event } satisfies PresenceChange;
    }, handler),

    onTyping: (handler) => shaped(['user_typing'], (event) => {
      const channelId = orNull(event.channel);
      const userId = orNull(event.user);
      if (!channelId || !userId) return null;
      return { channelId, teamId: team(event), userId, raw: event } satisfies TypingSignal;
    }, handler),

    onRead: (handler) => shaped(
      ['channel_marked', 'im_marked', 'group_marked', 'thread_marked'],
      (event) => {
        const channelId = orNull(event.channel);
        if (!channelId) return null;
        return { channelId, teamId: team(event), ts: str(event.ts), raw: event } satisfies ReadMark;
      },
      handler,
    ),

    onPin: (handler) => shaped(['pin_added', 'pin_removed'], (event) => {
      const item = (event.item ?? {}) as Record<string, unknown>;
      const message = (item.message ?? {}) as Record<string, unknown>;
      return {
        added: event.type === 'pin_added',
        channelId: orNull(event.channel_id) ?? orNull(event.channel) ?? orNull(item.channel),
        teamId: team(event),
        ts: orNull(message.ts) ?? orNull(item.ts),
        raw: event,
      } satisfies MarkedMessage;
    }, handler),

    onSaved: (handler) => shaped(['star_added', 'star_removed'], (event) => {
      const item = (event.item ?? {}) as Record<string, unknown>;
      const message = (item.message ?? {}) as Record<string, unknown>;
      return {
        added: event.type === 'star_added',
        channelId: orNull(item.channel) ?? orNull(event.channel),
        teamId: team(event),
        ts: orNull(message.ts) ?? orNull(item.ts),
        raw: event,
      } satisfies MarkedMessage;
    }, handler),

    onEmojiChanged: (handler) => shaped(['emoji_changed'], (event) => ({
      kind: str(event.subtype) || 'add',
      names: Array.isArray(event.names)
        ? (event.names as unknown[]).map(str).filter(Boolean)
        : [orNull(event.name)].filter((n): n is string => Boolean(n)),
      teamId: team(event),
      raw: event,
    } satisfies EmojiChange), handler),

    deliver(event) {
      if (typeof event?.type !== 'string') return;
      for (const sub of [...subscriptions]) {
        if (!sub.types.has(event.type)) continue;
        try {
          sub.handler(event);
        } catch (err) {
          // One mod throwing on an event must not stop the next mod hearing it.
          console.error('[betterslack] a listener threw on a Slack event:', err);
        }
      }
    },
  };
}
