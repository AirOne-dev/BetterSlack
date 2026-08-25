/**
 * What Slack's socket said a message contains.
 *
 * The mod used to work out edits and deletions by reading the screen every
 * second and a half and comparing: a message whose text had moved was an edit,
 * a message that had left the window with both neighbours still there was a
 * deletion. It was careful -- a first sighting was never a change, a gap had to
 * survive two sweeps -- and it was still a guess about a virtual list, and the
 * guess had a failure that showed up daily.
 *
 * **Editing a message takes it out of the document.** Slack replaces the
 * message with an editor while you type, and typing takes longer than two
 * sweeps, so your own edit was written down as your own deletion -- with the
 * words you were in the middle of changing. Which is the bug that settled it:
 * Slack's socket says outright which of the two happened, for every
 * conversation you are in, and `conversations.history` catches the rest when
 * you next open the channel. There is nothing left for a heuristic to add.
 *
 * What is kept from the screen is what the socket does not carry: the sidebar's
 * section names, the emoji Slack has drawn, and who has been on screen.
 *
 * This is the one thing the message half still needs: what a message said, for
 * the frames that do not carry it. Slack sends `previous_message` with an edit
 * and with a deletion, so it is only ever a fallback -- for a message this
 * client heard about and then lost, which is an app restarted in between.
 */

/** How many messages are held. Every conversation you are in feeds this. */
export const WIRE_LIMIT = 3000;

export function createMessageStore() {
  const wire = new Map();

  return {
    remember(key, text, userId, botId) {
      if (!key) return;
      // Deleted first so a message heard again moves to the end: insertion
      // order is what the cap reads.
      wire.delete(key);
      wire.set(key, { text: String(text ?? ''), userId: userId ?? null, botId: botId ?? null });
      if (wire.size > WIRE_LIMIT) {
        for (const old of [...wire.keys()].slice(0, wire.size - WIRE_LIMIT)) wire.delete(old);
      }
    },
    textFor: (key) => wire.get(key)?.text ?? null,
    /**
     * Which app posted a message, as far as anything has been told.
     *
     * The screen cannot answer it: Slack draws an app's message like anybody
     * else's with a small badge, and a follow-up carries no badge at all. The
     * socket and `conversations.history` both say it outright.
     */
    appFor: (key) => wire.get(key)?.botId ?? null,
    /** How many messages are held. The page shows it; tests read it. */
    watching: () => wire.size,
    forget: () => wire.clear(),
  };
}
