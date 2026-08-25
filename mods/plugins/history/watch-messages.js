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

/**
 * @typedef {object} Reading
 * @property {string} key        `<channel>:<ts>`, which is what Slack puts on the element
 * @property {string} channelId
 * @property {string} ts
 * @property {string} text
 * @property {string|null} [userId]
 * @property {string|null} [who]                 the sender's name as drawn
 * @property {Record<string, number>} [reactions] emoji shortcode to count
 */

export function createMessageWatcher() {
  /** What each message said last time it was read, keyed by `<channel>:<ts>`. */
  const seen = new Map();
  /** The order Slack drew them in, per channel, so a gap has neighbours. */
  const order = new Map();

  /**
   * @param {Reading[]} readings everything on screen, in the order it is drawn
   * @returns {object[]} what changed, oldest first
   */
  const sweep = (readings) => {
    const changes = [];
    const present = new Set(readings.map((r) => r.key));

    for (const reading of readings) {
      const known = seen.get(reading.key);
      const reactions = reading.reactions ?? {};

      // First sighting: remembered, never reported. See `armed` above.
      if (!known) {
        seen.set(reading.key, {
          text: reading.text,
          reactions,
          userId: reading.userId ?? null,
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
      if (!known.who && reading.who) known.who = reading.who;

      const where = {
        channelId: known.channelId,
        ts: known.ts,
        userId: known.userId,
        who: known.who,
      };

      if (known.armed) {
        for (const change of reactionChanges(known.reactions, reactions)) {
          changes.push({ ...where, ...change });
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

      changes.push({ ...where, kind: 'edited', before: known.text, after: reading.text });
      known.text = reading.text;
    }

    // Deletions, per channel: a channel that is not on screen at all is a
    // channel you navigated away from, and its whole window going missing must
    // never read as everybody deleting everything at once.
    const drawn = new Map();
    for (const reading of readings) {
      if (!drawn.has(reading.channelId)) drawn.set(reading.channelId, []);
      drawn.get(reading.channelId).push(reading.key);
    }

    for (const [channelId, keys] of drawn) {
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
          before: known.text,
          userId: known.userId,
          who: known.who,
          // The two it sat between, so a headstone can be put back exactly
          // where the message was rather than at the end of the list. The last
          // message in a conversation has nothing after it, and there is
          // nothing to anchor a headstone to -- it is recorded all the same.
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
    /** How many messages are being watched. The page shows it; tests read it. */
    watching: () => seen.size,
    forget: () => { seen.clear(); order.clear(); },
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
