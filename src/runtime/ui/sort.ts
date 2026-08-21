// How the panel orders a shelf.
//
// Its own file so it can be tested against the real thing rather than through
// assertions on the source of a 1500-line panel. Pure: it is handed the two
// things it cannot work out for itself -- the order mods were installed in, and
// whether one is on -- and returns a new array.

import type { ModRecord } from '../../shared/protocol.js';

/**
 * `recent` is install order, newest first.
 *
 * There is no timestamp behind it and none was needed: the settings file lists
 * installed ids in the order they were installed, because that is how they are
 * appended, so the record already existed and nothing had to be migrated for
 * mods somebody installed months ago.
 */
export type SortId = 'recent' | 'az' | 'za' | 'enabled';

export interface ShelfContext {
  /** `settings.installed`, in its own order. */
  installedOrder: readonly string[];
  isEnabled: (id: string) => boolean;
}

export function sortMods(
  mods: readonly ModRecord[],
  sort: SortId,
  { installedOrder, isEnabled }: ShelfContext,
): ModRecord[] {
  /*
   * `localeCompare`, not `<`.
   *
   * The catalogue has accented names in it and a code-point comparison files
   * every one of them after Z -- which reads as a list that is nearly sorted,
   * and therefore as a list that is broken.
   */
  const byName = (a: ModRecord, b: ModRecord) => a.name.localeCompare(b.name);
  const list = [...mods];

  switch (sort) {
    case 'az':
      return list.sort(byName);
    case 'za':
      return list.sort((a, b) => byName(b, a));
    case 'enabled':
      // By name inside each half, so both halves are readable rather than each
      // being in whatever order the catalogue happened to hand over.
      return list.sort((a, b) =>
        Number(isEnabled(b.id)) - Number(isEnabled(a.id)) || byName(a, b));
    default: {
      /*
       * Anything the list does not name sorts to the end rather than to the
       * front: `indexOf` answers -1, and a Browse shelf is entirely made of
       * mods that are not installed, so the naive comparison would order it by
       * nothing at all while looking deliberate.
       */
      const at = (id: string) => {
        const index = installedOrder.indexOf(id);
        // Newest first: the last id in the list is the one just installed.
        return index === -1 ? Infinity : installedOrder.length - index;
      };
      return list.sort((a, b) => at(a.id) - at(b.id) || byName(a, b));
    }
  }
}
