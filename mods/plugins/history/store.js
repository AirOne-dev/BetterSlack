/**
 * The log itself: what goes in, what comes out, and in what order.
 *
 * Kept away from the DOM and from `api` so the rules that matter -- the cap,
 * the ordering, the search -- can be driven by a test rather than by a live
 * Slack. Everything here is a plain function over plain objects.
 */

/** Every kind of event the watchers can produce, in the order the page lists them. */
export const KINDS = [
  'edited', 'deleted',
  'reaction-added', 'reaction-removed',
  'channel-renamed', 'section-renamed', 'name-changed',
  'joined', 'left',
  'status-changed',
];

/** The families the page offers as filters, since ten chips is not a filter. */
export const GROUPS = {
  messages: ['edited', 'deleted'],
  reactions: ['reaction-added', 'reaction-removed'],
  names: ['channel-renamed', 'section-renamed', 'name-changed'],
  people: ['joined', 'left', 'status-changed'],
};

/**
 * Add events to the log, newest first, and never past the cap.
 *
 * The log is written through `api.settings`, which is the loader's own file and
 * is read at every launch, so one that grows without limit is a slower start
 * for everybody. The cap is a setting, and this is where it is enforced.
 */
export function add(log, events, keep, now) {
  if (events.length === 0) return log;

  /*
   * The same thing, seen twice.
   *
   * A reaction taken back while you are looking is caught by the screen; open
   * the channel again and the catch-up compares against a snapshot from before
   * it happened and finds it a second time. The pair is the same event, so it
   * is written once -- matched on what it is rather than on when it was
   * noticed, because the two halves notice at different moments by design.
   */
  const seen = new Set(log.map(fingerprint));
  const fresh = events.filter((event) => !seen.has(fingerprint(event)));
  if (fresh.length === 0) return log;

  const stamped = [...fresh].reverse().map((event, index) => ({
    ...event,
    at: event.at ?? now,
    // Unique enough to key a row and to survive a redraw: two events of the
    // same kind on the same message in the same millisecond do not happen, and
    // the index settles it if they ever do.
    id: `${now}-${index}-${event.kind}`,
  }));
  return stamped.concat(log).slice(0, Math.max(1, keep));
}

/**
 * What the page shows: the log, narrowed and ordered.
 *
 * The search runs over everything a row draws rather than over a chosen field.
 * Looking for a name should find it whether it was the person who edited
 * something, the channel it happened in, or the word that changed.
 */
export function view(log, { query = '', groups = null, sort = 'newest' } = {}) {
  const wanted = groups && groups.length > 0
    ? new Set(groups.flatMap((group) => GROUPS[group] ?? []))
    : null;

  const needle = query.trim().toLowerCase();
  const rows = log.filter((entry) => {
    if (wanted && !wanted.has(entry.kind)) return false;
    if (!needle) return true;
    return searchable(entry).includes(needle);
  });

  return sortRows(rows, sort);
}

/** What makes two events the same event, whichever half saw it. */
function fingerprint(event) {
  return [event.kind, event.channelId, event.ts, event.emoji, event.userId, event.after]
    .map((part) => part ?? '')
    .join('\u0000');
}

/** Everything a row draws, as one lowercase line, for the search to run over. */
export function searchable(entry) {
  return [
    entry.kind, entry.who, entry.channelName, entry.channelId,
    entry.before, entry.after, entry.emoji,
  ].filter(Boolean).join(' ').toLowerCase();
}

/**
 * `localeCompare`, never `<`.
 *
 * A code-point compare files every accented name after Z, which reads as a list
 * that is nearly sorted and therefore as one that is broken. The same rule the
 * Mods panel's own sort follows.
 */
export function sortRows(rows, sort) {
  const copy = [...rows];
  if (sort === 'oldest') return copy.sort((a, b) => a.at - b.at);
  if (sort === 'kind') {
    return copy.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || b.at - a.at);
  }
  if (sort === 'who') {
    return copy.sort((a, b) => (a.who ?? '').localeCompare(b.who ?? '') || b.at - a.at);
  }
  if (sort === 'where') {
    return copy.sort((a, b) => (a.channelName ?? a.channelId ?? '')
      .localeCompare(b.channelName ?? b.channelId ?? '') || b.at - a.at);
  }
  return copy.sort((a, b) => b.at - a.at);
}

/** How many of each family are in the log, for the counts on the chips. */
export function tally(log) {
  const counts = { all: log.length };
  for (const [group, kinds] of Object.entries(GROUPS)) {
    counts[group] = log.filter((entry) => kinds.includes(entry.kind)).length;
  }
  return counts;
}
