// What the top bar gives up, in what order, as the room shrinks.
//
// Most to least important: how it is going (the icon's colour, or what failed),
// how far (the count), which merge request, which project, the name of the
// stage, and last of all the merge request's branch. So it is taken away the other way round, and the bar stays
// informative instead of vanishing. Measuring is the bar's business (it needs a
// layout); deciding what to try, and in what order, is here.

/**
 * From the richest to the poorest. Every level keeps the icon.
 *
 * What goes first is what a reader needs least: the merge request's branch,
 * which is only there when there is plenty of room, then the stage's name, the
 * row of stages, the project, the merge request, and last the count.
 */
export function levelsFor({ failed }) {
  // A failure is the news: what failed outlives the project's name.
  if (failed) {
    return [
      ['icon', 'project', 'mr', 'branch', 'note', 'progress', 'dots'],
      ['icon', 'project', 'mr', 'note', 'progress', 'dots'],
      ['icon', 'project', 'mr', 'note', 'progress'],
      ['icon', 'mr', 'note', 'progress'],
      ['icon', 'mr', 'progress'],
      ['icon', 'progress'],
      ['icon'],
    ];
  }
  return [
    ['icon', 'project', 'mr', 'branch', 'note', 'progress', 'dots'],
    ['icon', 'project', 'mr', 'note', 'progress', 'dots'],
    ['icon', 'project', 'mr', 'progress', 'dots'],
    ['icon', 'project', 'mr', 'progress'],
    ['icon', 'mr', 'progress'],
    ['icon', 'progress'],
    ['icon'],
  ];
}

/**
 * The first level that fits, else the last: a bar that fits nothing still
 * shows its icon.
 */
export function chooseLevel(levels, fits) {
  return levels.find((level) => fits(level)) ?? levels.at(-1);
}
