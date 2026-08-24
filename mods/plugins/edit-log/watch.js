/**
 * Telling a change apart from a re-render.
 *
 * This is the whole of the mod's judgement, kept away from the DOM so it can be
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
 */

/**
 * @typedef {object} Change
 * @property {'edited'|'deleted'} kind
 * @property {string} channelId
 * @property {string} ts
 * @property {string} before
 * @property {string} [after]
 * @property {string|null} userId
 * @property {string|null} [previousTs] the message above it, for a deletion
 * @property {string|null} [nextTs]     the message below it, for a deletion
 */

export function createWatcher() {
  /** What each message said last time it was read, keyed by `<channel>:<ts>`. */
  const seen = new Map();
  /** The order Slack drew them in, per channel, so a gap has neighbours. */
  const order = new Map();

  /**
   * @param {Reading[]} readings everything on screen, in the order it is drawn
   * @returns {Change[]} what changed, oldest first
   */
  const sweep = (readings) => {
    const changes = [];
    const present = new Set(readings.map((r) => r.key));

    for (const reading of readings) {
      const known = seen.get(reading.key);

      // First sighting: remembered, never reported. See `armed` above.
      if (!known) {
        seen.set(reading.key, {
          text: reading.text,
          userId: reading.userId ?? null,
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

      if (known.text === reading.text) {
        known.armed = true;
        continue;
      }

      if (!known.armed) {
        // Still settling. Take the new text and wait for it to hold still.
        known.text = reading.text;
        continue;
      }

      changes.push({
        kind: 'edited',
        channelId: known.channelId,
        ts: known.ts,
        before: known.text,
        after: reading.text,
        userId: known.userId,
      });
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

      for (let i = 0; i < before.length; i += 1) {
        const key = before[i];
        if (present.has(key)) continue;

        // An end of the loaded window has no neighbour on one side, which is
        // exactly what scrolling looks like.
        const previous = before[i - 1];
        const next = before[i + 1];
        if (!previous || !next) continue;
        if (!present.has(previous) || !present.has(next)) continue;

        const known = seen.get(key);
        if (!known) continue;
        // Never read once and never confirmed: not enough to claim it existed.
        if (!known.armed) { seen.delete(key); continue; }

        known.missing += 1;
        if (known.missing < MISSING_BEFORE_GONE) {
          waiting.push({ key, next });
          continue;
        }

        changes.push({
          kind: 'deleted',
          channelId: known.channelId,
          ts: known.ts,
          before: known.text,
          userId: known.userId,
          // The two it sat between, so a headstone can be put back exactly
          // where the message was rather than at the end of the list.
          previousTs: seen.get(previous)?.ts ?? null,
          nextTs: seen.get(next)?.ts ?? null,
        });
        seen.delete(key);
      }

      /*
       * A gap that is still being judged keeps its place in the order.
       *
       * Written back as simply "what is on screen now", a message that vanished
       * on this sweep is no longer between two neighbours on the next one --
       * so it is never looked at again and no deletion is ever confirmed. It
       * goes back in front of the message that followed it, which is the only
       * thing that still says where it was.
       */
      const nextOrder = [...keys];
      for (const { key, next } of waiting) {
        const at = nextOrder.indexOf(next);
        if (at !== -1) nextOrder.splice(at, 0, key);
      }
      order.set(channelId, nextOrder);
    }

    return changes;
  };

  return {
    sweep,
    /** How many messages are being watched. The panel shows it; tests read it. */
    watching: () => seen.size,
    forget: () => { seen.clear(); order.clear(); },
  };
}

/**
 * Add changes to the log, newest first, and never past the cap.
 *
 * The log is written through `api.settings`, which is the loader's own file and
 * is read at every launch, so a log that grows without limit is a slower start
 * for everybody. Kept here rather than in `index.js` because the cap is the
 * part worth a test.
 */
export function addToLog(log, changes, keep, now) {
  const next = [...changes].reverse().map((change) => ({ ...change, at: now })).concat(log);
  return next.slice(0, Math.max(1, keep));
}
