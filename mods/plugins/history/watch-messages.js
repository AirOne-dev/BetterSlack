/**
 * Telling a change apart from a re-render.
 *
 * This is the sharpest part of the mod, kept away from the DOM so it can be
 * driven by a test rather than by a live Slack. It is handed what is on screen
 * now -- one reading per message, in the order Slack drew them -- and answers
 * what changed since the last time it was asked.
 *
 * Three things make that harder than comparing two strings, and each of them
 * would otherwise fill the log with events nobody caused:
 *
 * **Slack's list is virtual.** Thirteen messages are in the document out of a
 * conversation of thousands; scrolling adds some at one end and drops others at
 * the other. A message leaving the document is almost always a scroll, so a
 * deletion is only believed when the messages *either side of it* are both
 * still there -- the shape a real deletion has and a scroll cannot.
 *
 * With one exception, and it is the common case: the message you delete is
 * usually the one you just wrote, at the bottom, which has nothing after it.
 * Asking for a neighbour on both sides means never seeing that at all. A
 * message vanishing from the *end* of the window counts too, but only when
 * nothing new arrived in the same sweep -- scrolling up drops from the bottom
 * and always brings older messages in at the top, so "nothing came in" is what
 * tells the two apart. The top of the window keeps the strict rule, because
 * scrolling down drops from there constantly.
 *
 * **Other mods rewrite the text.** Full Links replaces a truncated link's label
 * with the whole URL moments after the message is drawn, which changes the text
 * without anybody editing anything. So a message is not comparable the first
 * time it is seen: it has to be read twice with the same text before a later
 * difference counts. That is what `armed` means below.
 *
 * **Slack re-renders constantly.** A message can leave the document and come
 * back in the same second. A deletion therefore has to be missing from two
 * consecutive sweeps before it is written down.
 */

/** How many sweeps a message must be missing, while surrounded, to be gone. */
const MISSING_BEFORE_GONE = 2;
/** How many messages off the socket are held, for the frames with no history. */
const WIRE_LIMIT = 3000;

/**
 * @typedef {object} Reading
 * @property {string} key        `<channel>:<ts>`, which is what Slack puts on the element
 * @property {string} channelId
 * @property {string} ts
 * @property {string} text
 * @property {string|null} [userId]
 * @property {string|null} [botId]               the app that posted it, if any
 * @property {string|null} [who]                 the sender's name as drawn
 * @property {Record<string, number>} [reactions] emoji shortcode to count
 */

export function createMessageWatcher() {
  /** What each message said last time it was read, keyed by `<channel>:<ts>`. */
  const seen = new Map();
  /** The order Slack drew them in, per channel, so a gap has neighbours. */
  const order = new Map();
  /** What Slack's socket said, in Slack's markup. See `remember` below. */
  const wire = new Map();

  /**
   * @param {Reading[]} readings everything on screen, in the order it is drawn
   * @returns {object[]} what changed, oldest first
   */
  const sweep = (drawnReadings) => {
    const changes = [];
    /*
     * One reading per message.
     *
     * The same message can be on screen twice -- a conversation and a thread
     * draw the same node, and a jump leaves the old one in place for a frame.
     * Read twice in one sweep, the second reading is compared against the
     * first and any difference between the two copies is reported as an edit
     * by somebody who wrote nothing.
     */
    const byKey = new Map();
    for (const reading of drawnReadings) {
      const held = byKey.get(reading.key);
      if (!held) { byKey.set(reading.key, reading); continue; }
      // Slack draws no avatar on a follow-up, and a copy in a thread may carry
      // what the copy in the conversation does not. Take whichever knows more.
      held.userId ??= reading.userId ?? null;
      held.who ??= reading.who ?? null;
    }
    const readings = [...byKey.values()];
    const present = new Set(byKey.keys());

    for (const reading of readings) {
      const known = seen.get(reading.key);
      const reactions = reading.reactions ?? {};

      // First sighting: remembered, never reported. See `armed` above.
      if (!known) {
        seen.set(reading.key, {
          text: reading.text,
          reactions,
          userId: reading.userId ?? null,
          botId: reading.botId ?? null,
          who: reading.who ?? null,
          channelId: reading.channelId,
          ts: reading.ts,
          armed: false,
          missing: 0,
        });
        continue;
      }

      known.missing = 0;
      // A userId read off an avatar that had not loaded yet is null; take it
      // whenever it turns up rather than only on the first sighting.
      if (!known.userId && reading.userId) known.userId = reading.userId;
      if (!known.botId && reading.botId) known.botId = reading.botId;
      if (!known.who && reading.who) known.who = reading.who;

      const where = {
        channelId: known.channelId,
        ts: known.ts,
        userId: known.userId,
        botId: known.botId ?? null,
        who: known.who,
      };

      if (known.armed) {
        for (const change of reactionChanges(known.reactions, reactions)) {
          /*
           * Two different people, and they were the same field.
           *
           * `userId` is who did the thing; `subjectUser` is who wrote the
           * message it was done to. On screen Slack never says who reacted, so
           * the first is empty here and the row says so -- while the message's
           * own author was being reported as the reactor, which is somebody
           * being told they un-reacted to themselves.
           */
          changes.push({
            ...where,
            ...change,
            userId: null,
            who: null,
            subject: known.text,
            subjectUser: known.userId,
            subjectWho: known.who,
          });
        }
      }
      known.reactions = reactions;

      if (known.text === reading.text) {
        known.armed = true;
        continue;
      }

      if (!known.armed) {
        // Still settling. Take the new text and wait for it to hold still.
        known.text = reading.text;
        continue;
      }

      changes.push({ ...where, kind: 'edited', before: known.text, after: reading.text, subject: reading.text });
      known.text = reading.text;
    }

    /*
     * Deletions, per channel, in the order Slack's own timestamps put them.
     *
     * Not the order the document holds them in. A message's neighbours are
     * what says a gap is a deletion and where the line replacing it goes, and
     * the document's order is only *usually* the conversation's: the message
     * list is virtual, so a node can be moved, re-inserted or drawn on the far
     * side of its neighbours for a frame while Slack rebuilds the window.
     * Believe that for one sweep and the remembered order keeps the mistake
     * for as long as the channel stays open -- which is how a deleted last
     * message came to be filed between two messages from the day before, and
     * had its line drawn there.
     *
     * `ts` cannot be scrambled that way: it is what Slack orders the
     * conversation by, and every one is ten digits, a dot and six, so
     * comparing them as text is exact where comparing them as numbers is at
     * the edge of what a double holds.
     *
     * A channel that is not on screen at all is a channel you navigated away
     * from, and its whole window going missing must never read as everybody
     * deleting everything at once.
     */
    const drawn = new Map();
    for (const reading of readings) {
      if (!drawn.has(reading.channelId)) drawn.set(reading.channelId, new Map());
      // A Map, so a message drawn twice at once -- the conversation and a
      // thread, a jump that leaves the old node in place for a frame -- is one
      // entry rather than two neighbours of itself.
      drawn.get(reading.channelId).set(reading.key, reading.ts);
    }

    for (const [channelId, drawnKeys] of drawn) {
      const keys = [...drawnKeys.keys()]
        .sort((a, b) => String(drawnKeys.get(a)).localeCompare(String(drawnKeys.get(b))));
      const before = order.get(channelId) ?? [];
      /** Gone, surrounded, but not yet gone often enough to be believed. */
      const waiting = [];

      /*
       * Did anything come into the window this sweep?
       *
       * Scrolling always does: it is the same gesture that takes messages out
       * at the other end. A window that lost a message and gained nothing was
       * not scrolled.
       */
      const knew = new Set(before);
      const arrived = keys.some((key) => !knew.has(key));

      for (let i = 0; i < before.length; i += 1) {
        const key = before[i];
        if (present.has(key)) continue;

        const previous = before[i - 1];
        const next = before[i + 1];
        const surrounded = Boolean(previous) && Boolean(next)
          && present.has(previous) && present.has(next);
        // The live end of the list: the last message, deleted, with the one
        // before it still there and nothing having scrolled in behind it.
        const wasLast = !next && Boolean(previous) && present.has(previous) && !arrived;
        if (!surrounded && !wasLast) continue;

        const known = seen.get(key);
        if (!known) continue;
        // Never read once and never confirmed: not enough to claim it existed.
        if (!known.armed) { seen.delete(key); continue; }

        known.missing += 1;
        if (known.missing < MISSING_BEFORE_GONE) {
          waiting.push({ key, previous, next });
          continue;
        }

        changes.push({
          kind: 'deleted',
          channelId: known.channelId,
          ts: known.ts,
          botId: known.botId ?? null,
          before: known.text,
          subject: known.text,
          userId: known.userId,
          who: known.who,
          // The two it sat between, so a headstone can be put back exactly
          // where the message was rather than at the end of the list. The last
          // message in a conversation has nothing after it and hangs off the
          // one before instead, which is the same place.
          previousTs: previous ? (seen.get(previous)?.ts ?? null) : null,
          nextTs: next ? (seen.get(next)?.ts ?? null) : null,
        });
        seen.delete(key);
      }

      /*
       * A gap that is still being judged keeps its place in the order.
       *
       * Written back as simply "what is on screen now", a message that vanished
       * on this sweep is no longer between two neighbours on the next one -- so
       * it is never looked at again and no deletion is ever confirmed. It goes
       * back in front of the message that followed it, which is the only thing
       * that still says where it was.
       */
      const nextOrder = [...keys];
      for (const { key, previous, next } of waiting) {
        // In front of the one that followed it, or behind the one that came
        // before where there was nothing after -- the last message in a
        // conversation is judged over two sweeps like any other, and putting it
        // back only in front of a `next` it never had dropped it on the first.
        const after = next ? nextOrder.indexOf(next) : -1;
        if (after !== -1) { nextOrder.splice(after, 0, key); continue; }
        const behind = previous ? nextOrder.indexOf(previous) : -1;
        if (behind !== -1) nextOrder.splice(behind + 1, 0, key);
      }
      order.set(channelId, nextOrder);
    }

    return changes;
  };

  return {
    sweep,
    /**
     * What Slack's socket said a message contains, kept apart from the screen.
     *
     * Deliberately its own map. The screen gives a message as it is *drawn* --
     * a mention is a name, a link is its label -- and the socket gives it as
     * it was *written*, in Slack's markup. Folded into the same store, the
     * next sweep would compare one against the other, find them different, and
     * report an edit by somebody who wrote nothing.
     *
     * It is only ever a fallback: Slack sends `previous_message` with an edit
     * and with a deletion, so this is for the frames that do not. In memory
     * and capped, because it holds every message in every conversation this
     * client is in and nothing here is worth a slower start tomorrow.
     */
    remember: (key, text, userId, botId) => {
      if (!key) return;
      wire.delete(key);
      wire.set(key, { text: String(text ?? ''), userId: userId ?? null, botId: botId ?? null });
      if (wire.size > WIRE_LIMIT) {
        for (const old of [...wire.keys()].slice(0, wire.size - WIRE_LIMIT)) wire.delete(old);
      }
    },
    textFor: (key) => wire.get(key)?.text ?? null,
    /**
     * Whether an app posted this message, as far as anything has been told.
     *
     * The screen cannot answer it: Slack draws an app's message like anybody
     * else's with a small badge, and a follow-up has no badge at all. The
     * socket and `conversations.history` both say it outright, so what they
     * said is what the screen-reading half asks.
     */
    appFor: (key) => wire.get(key)?.botId ?? null,
    /** How many messages are being watched. The page shows it; tests read it. */
    watching: () => seen.size,
    forget: () => { seen.clear(); order.clear(); wire.clear(); },
  };
}

/**
 * Reactions, as the difference between two tallies.
 *
 * Slack draws one button per emoji with a count on it, and says who reacted
 * only in a tooltip built when you hover -- in the reader's language, with
 * names rather than ids. So this reports the emoji and the count, and never
 * claims to know who: a name parsed out of a localised sentence is a name this
 * mod would be inventing.
 */
export function reactionChanges(before, after) {
  const changes = [];
  // Each side is `{ count, url }`: the picture travels with the tally, because
  // a shortcode is not always something a name can be turned back into.
  const tally = (side, emoji) => side[emoji]?.count ?? 0;
  const picture = (emoji) => after[emoji]?.url ?? before[emoji]?.url ?? null;

  for (const emoji of Object.keys(after)) {
    const was = tally(before, emoji);
    const count = tally(after, emoji);
    if (count > was) {
      changes.push({ kind: 'reaction-added', emoji, emojiUrl: picture(emoji), count, before: String(was), after: String(count) });
    }
  }
  for (const emoji of Object.keys(before)) {
    const was = tally(before, emoji);
    const count = tally(after, emoji);
    if (count < was) {
      changes.push({ kind: 'reaction-removed', emoji, emojiUrl: picture(emoji), count, before: String(was), after: String(count) });
    }
  }
  return changes;
}
