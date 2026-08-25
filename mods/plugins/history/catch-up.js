/**
 * What changed while nobody was looking.
 *
 * The rest of this mod reads the screen, so it only ever knows what your client
 * drew: a message edited in a channel you were not in was never in front of
 * you. That is honest and it is also the first thing anybody notices, because
 * the answer to "why is this not in my history" is usually "you were
 * elsewhere".
 *
 * `conversations.history` closes most of that gap, and it was measured against
 * a live workspace before any of this was written -- an `xoxc` token is refused
 * by more of Slack's API than it is allowed by, and a feature built on a guess
 * is a feature that fails on somebody else's account:
 *
 *   conversations.history   answers, with `has_more` and a `limit`
 *   message.edited          `{ user, ts }` -- who rewrote it, and when
 *   message.reactions       `[{ name, users, count }]`, and `users` are ids
 *
 * That last one matters more than it looks. Reading the screen, this mod
 * refuses to say who reacted, because Slack only says so in a tooltip built on
 * hover, in the reader's language, with names rather than ids. Here Slack says
 * it outright, so a reaction taken back can name the person who took it back.
 *
 * Everything in this file is a pure function over two answers, so the rules can
 * be driven by a test rather than by a live Slack.
 */

/**
 * What is worth remembering about a channel, so the next visit can compare.
 *
 * Not the whole message: the text, when it was last edited, and the reactions.
 * A snapshot is written through `helpers.cache`, which is the loader's settings
 * file, so everything here is paid for at every launch.
 *
 * @param {object[]} messages what `conversations.history` answered
 */
export function snapshotOf(messages) {
  const out = {};
  for (const message of messages ?? []) {
    if (!message?.ts) continue;
    out[message.ts] = {
      text: String(message.text ?? ''),
      user: message.user ?? null,
      editedAt: message.edited?.ts ?? null,
      reactions: Object.fromEntries((message.reactions ?? [])
        .filter((reaction) => reaction?.name)
        .map((reaction) => [reaction.name, {
          count: Number(reaction.count) || 0,
          users: Array.isArray(reaction.users) ? reaction.users : [],
        }])),
    };
  }
  return out;
}

/**
 * The difference between what you last saw and what is there now.
 *
 * @param {Record<string, object>|null} before the snapshot from the last visit
 * @param {object[]} messages what `conversations.history` answers now
 * @param {{ channelId: string, channelName: string|null }} where
 */
export function catchUp(before, messages, where) {
  // Nothing to compare against is not "everything changed": a first visit has
  // to be the baseline or opening a busy channel writes a hundred events for
  // things that happened before this mod existed.
  if (!before) return [];

  const now = snapshotOf(messages);
  const events = [];

  /*
   * How far back this answer reaches.
   *
   * `conversations.history` returns a page, so a message older than the oldest
   * one it sent is not missing -- it is simply outside the window, and calling
   * it deleted would empty somebody's history into the log every time they
   * opened a busy channel.
   */
  const oldest = Object.keys(now).sort()[0] ?? null;

  for (const [ts, was] of Object.entries(before)) {
    const is = now[ts];

    if (!is) {
      if (!oldest || ts < oldest) continue;
      events.push({
        kind: 'deleted',
        channelId: where.channelId,
        channelName: where.channelName,
        ts,
        before: was.text,
        subject: was.text,
        userId: was.user ?? null,
        subjectUser: was.user ?? null,
      });
      continue;
    }

    // An edit is the text moving. `edited.ts` moving says the same thing and is
    // what Slack itself records, so either is enough -- a message edited back
    // to what it said before is still an edit, and only the stamp shows it.
    if (was.text !== is.text || (is.editedAt && is.editedAt !== was.editedAt)) {
      if (was.text !== is.text) {
        events.push({
          kind: 'edited',
          channelId: where.channelId,
          channelName: where.channelName,
          ts,
          before: was.text,
          after: is.text,
          subject: is.text,
          userId: is.user ?? was.user ?? null,
          subjectUser: is.user ?? was.user ?? null,
        });
      }
    }

    for (const event of reactionDiff(was.reactions ?? {}, is.reactions ?? {})) {
      // `userId` is the person who reacted, which Slack names here. The message
      // they reacted to has an author of its own, and the two are not the same.
      events.push({
        ...event,
        channelId: where.channelId,
        channelName: where.channelName,
        ts,
        subject: is.text,
        subjectUser: is.user ?? null,
      });
    }
  }

  // Oldest first, so a run of them reads in the order it happened.
  return events.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
}

/**
 * Reactions, as who arrived and who left.
 *
 * The count alone would do, but Slack hands over the ids, and a reaction taken
 * back is the one thing in this mod people actually want a name for. One event
 * per person rather than one per emoji: "three people un-reacted" is a number,
 * and the point is which three.
 */
export function reactionDiff(before, after) {
  const events = [];
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const name of names) {
    const was = new Set(before[name]?.users ?? []);
    const is = new Set(after[name]?.users ?? []);
    const wasCount = before[name]?.count ?? 0;
    const isCount = after[name]?.count ?? 0;

    const gone = [...was].filter((id) => !is.has(id));
    const came = [...is].filter((id) => !was.has(id));

    for (const userId of came) {
      events.push({ kind: 'reaction-added', emoji: `:${name}:`, userId, before: String(wasCount), after: String(isCount) });
    }
    for (const userId of gone) {
      events.push({ kind: 'reaction-removed', emoji: `:${name}:`, userId, before: String(wasCount), after: String(isCount) });
    }

    /*
     * A count that moved with nobody named.
     *
     * Slack truncates `users` on a reaction with a great many of them, so the
     * ids can stay identical while the count changes. The event is still
     * worth recording; it simply has nobody to attribute it to, which is the
     * same thing the screen-reading half of this mod always says.
     */
    if (gone.length === 0 && came.length === 0 && wasCount !== isCount) {
      events.push({
        kind: isCount > wasCount ? 'reaction-added' : 'reaction-removed',
        emoji: `:${name}:`,
        before: String(wasCount),
        after: String(isCount),
      });
    }
  }
  return events;
}
