/**
 * Names that change without Slack ever saying so.
 *
 * A channel renamed, a sidebar section renamed: both happen silently, and the
 * only person who notices is the one looking for a channel that is not called
 * what it was called. Neither costs a request -- both are read off the screen.
 *
 * A person's display name is *not* read off the screen, and that is a
 * measurement rather than a preference: `[data-qa="message_sender"]` holds a
 * second copy of the name for screen readers on some messages and not on
 * others, so its text flips between "Ada Lovelace" and "Ada LovelaceAda
 * Lovelace :" as Slack redraws. Compared, that is a rename every few seconds
 * from somebody who changed nothing. Display names come from `users.info`
 * instead, in the slow sweep that already asks about statuses.
 *
 * Same shape as the message watcher, and for the same reason: a name is only
 * comparable once it has been read twice unchanged, because Slack draws a
 * placeholder first and fills it in a frame later.
 */

/** @typedef {{ scope: string, key: string, name: string }} NameReading */

export function createNameWatcher() {
  const seen = new Map();

  /**
   * @param {NameReading[]} readings every name on screen, with what it names
   * @returns {object[]} the ones that moved
   */
  const sweep = (readings) => {
    const changes = [];
    for (const reading of readings) {
      const id = `${reading.scope}:${reading.key}`;
      const known = seen.get(id);
      const name = (reading.name ?? '').trim();
      if (!name) continue;

      if (!known) {
        seen.set(id, { name, armed: false });
        continue;
      }
      if (known.name === name) { known.armed = true; continue; }
      if (!known.armed) { known.name = name; continue; }

      changes.push({
        kind: KIND_FOR[reading.scope] ?? 'name-changed',
        before: known.name,
        after: name,
        // A channel rename is about a place; a section is about the sidebar.
        ...(reading.scope === 'channel' ? { channelId: reading.key, channelName: name } : {}),
      });
      known.name = name;
    }
    return changes;
  };

  return { sweep, watching: () => seen.size, forget: () => seen.clear() };
}

const KIND_FOR = {
  channel: 'channel-renamed',
  section: 'section-renamed',
};

/**
 * Who is in a conversation, as the difference between two member lists.
 *
 * Slack does draw a notice when somebody joins, and then folds it away and
 * eventually stops showing it at all -- and the wording is in the reader's
 * language, so reading it back means parsing a sentence. The member list is
 * ids, which is the same answer without the guessing.
 */
export function rosterChanges(channelId, channelName, before, after) {
  if (!before) return [];
  const was = new Set(before);
  const now = new Set(after);
  const changes = [];
  for (const id of now) if (!was.has(id)) changes.push({ kind: 'joined', userId: id, channelId, channelName });
  for (const id of was) if (!now.has(id)) changes.push({ kind: 'left', userId: id, channelId, channelName });
  return changes;
}

/**
 * Statuses, as the difference between two readings of the same people.
 *
 * `api.slack.web.users` holds its answers for a minute and then asks again, so
 * a slow poll over the people you have actually seen is enough to catch a
 * status changing without a request per person per minute.
 */
export function statusChanges(before, after) {
  return differences(before, after, 'status-changed');
}

/**
 * Display names, the same way and from the same answer.
 *
 * `users.info` is what Slack's own client believes somebody is called, which
 * is the thing that actually changed. The screen is a rendering of it, and a
 * rendering that is not always the same twice.
 */
export function displayNameChanges(before, after) {
  return differences(before, after, 'name-changed').map((change) => ({ ...change, who: change.after }));
}

/** A change is a value that was known and is now different. */
function differences(before, after, kind) {
  const changes = [];
  for (const [id, value] of after) {
    const was = before.get(id);
    if (was === undefined || was === value) continue;
    changes.push({ kind, userId: id, before: was || '', after: value || '' });
  }
  return changes;
}
