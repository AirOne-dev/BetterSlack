// How much of the week is left, and what today should hold of it.
//
// What is left is shared evenly over the days left -- twelve hours over today
// and two more days is four each -- except that no day can hold more than it
// can: none is counted past its end (18:30, 17:30 on Friday by default), an
// afternoon off holds only a morning, and a day that cannot take its share
// hands the rest to the others. That is today's share.
//
// Leaving is a separate question with a rule of its own: never before 16:30,
// except with the afternoon off. So the share can be reached at 14:10 and the
// departure still be 16:30 -- "today's share done, leave from 16:30" -- and the
// time worked past the share is done: the next plan starts from it, so the
// days after are asked for less. Once the share needs longer, the departure is
// when it will be reached.
//
// If even the most every remaining day can hold is not enough, the answer is
// `insufficientCapacity`, with the shortfall -- never a departure time that
// would break a rule to make the arithmetic work.

import { DEFAULT_RULES, WORKING_DAYS, dayRules } from './rules.js';
import { credit, isFinished, paidIfLeaving, workLeft } from './day.js';

/**
 * The most a whole day yields if every rule is kept: arriving as the counted
 * day starts and leaving as late as that day allows, with an hour for lunch --
 * or, with the afternoon off, the morning alone.
 */
export function dayMost(weekday, rules = DEFAULT_RULES, half = false) {
  const day = dayRules(rules, weekday, half);
  const lunch = day.takesLunch ? [day.lunchFrom, day.lunchFrom + day.lunchMinimum] : [];
  return credit([day.arriveFrom, ...lunch, day.leaveBy], null, day).paid;
}

/**
 * The common amount `level` such that every range clamped to it sums to
 * `total`. Only asked when the total is inside what the ranges can hold, so
 * the answer exists; halving forty times is far finer than a minute.
 */
function evenLevel(ranges, total) {
  const sumAt = (level) => ranges.reduce((sum, r) => sum + Math.min(Math.max(level, r.low), r.high), 0);
  let low = Math.min(...ranges.map((r) => r.low));
  let high = Math.max(...ranges.map((r) => r.high));
  for (let i = 0; i < 40; i++) {
    const middle = (low + high) / 2;
    if (sumAt(middle) < total) low = middle;
    else high = middle;
  }
  return high;
}

/**
 * The first minute from `now` at which today would hold `goal`, if its owner
 * kept working -- or null if it never does before `by`.
 *
 * Leaving before lunch counts as a plan here like any other, which is right
 * for the question asked: what is wanted is how much work stands between now
 * and the share, and that is the same whichever side of lunch it falls.
 */
function reachedAt(badges, now, goal, by, offset, day) {
  for (let minute = now; minute <= by; minute++) {
    if (paidIfLeaving(badges, now, minute, offset, day) >= goal) return minute;
  }
  return null;
}

/**
 * Plan the week from where it stands.
 *
 * - `objective`: the week's minutes, from Quelio.
 * - `weekday`: today, Monday 0 ... Sunday 6. `now`: minutes since midnight.
 * - `days`: Monday to Friday, each `{ paid, badges, off, half }` -- `paid` is
 *   Quelio's count for a day that is over, `badges` today's, `off` a day its
 *   owner marked as not worked, which counts for its share of the week, and
 *   `half` one marked as an afternoon off, which counts for half of it.
 * - `offset`: how far Quelio's count of today is from the local one.
 * - `rules`: `readRules(...).rules`.
 */
export function planWeek({ objective, weekday, now, days, offset = 0, rules = DEFAULT_RULES }) {
  const share = Math.round(objective / WORKING_DAYS);
  const todayIndex = Math.min(weekday, WORKING_DAYS);
  const read = days.map((day, index) => {
    const badges = Array.isArray(day?.badges) ? day.badges : [];
    const reported = typeof day?.paid === 'number' ? day.paid : null;
    // A day with time on it was worked, whatever it was marked as.
    const off = Boolean(day?.off) && badges.length === 0 && !(reported > 0);
    const half = !off && Boolean(day?.half);
    const counting = dayRules(rules, index, half);
    let paid = 0;
    if (off || index > todayIndex) paid = 0;
    else if (index === todayIndex) paid = badges.length ? credit(badges, now, counting).paid + offset : 0;
    else paid = reported ?? credit(badges, null, counting).paid;
    return { index, badges, off, half, paid, reported };
  });

  const daysOff = read.filter((day) => day.off).length;
  const afternoonsOff = read.filter((day) => day.half).length;
  const target = Math.max(0, objective - share * daysOff - Math.round(share / 2) * afternoonsOff);
  const past = read.slice(0, todayIndex).reduce((sum, day) => sum + day.paid, 0);
  const today = read[todayIndex] ?? null;
  const done = past + (today?.paid ?? 0);
  const week = {
    objective,
    target,
    share,
    daysOff,
    afternoonsOff,
    done,
    remaining: Math.max(0, target - done),
    progress: target > 0 ? Math.min(1, done / target) : 1,
  };
  const summary = read.map(({ index, off, half, paid }) => ({ index, off, half, paid, future: index > todayIndex }));

  if (!today) return { ...week, status: done >= target ? 'reached' : 'weekend', days: summary, today: null };

  // What today can still hold: nothing more once it is over or off.
  const day = dayRules(rules, todayIndex, today.half);
  const leaveBy = day.leaveBy;
  const finished = isFinished(today.badges, now, day);
  const closed = today.off || finished || now >= leaveBy;
  const leaveFrom = Math.max(now, day.leaveFrom);
  const high = closed ? today.paid : paidIfLeaving(today.badges, now, leaveBy, offset, day);

  // Days to come, at most what each can hold. Not at least what each must:
  // the 16:30 floor is a reason a day ends up over its share, and that time
  // lightens the days after it once it is worked -- it is not a reason to ask
  // less of today in advance, on the strength of a day nobody has worked yet.
  const ahead = read
    .filter((entry) => entry.index > todayIndex && !entry.off)
    .map((entry) => ({ low: 0, high: dayMost(entry.index, rules, entry.half) }));
  const needed = target - past;
  const capacity = high + ahead.reduce((sum, r) => sum + r.high, 0);

  let status;
  let goal;
  let shortfall = 0;
  if (done >= target) {
    status = 'reached';
    goal = today.paid;
  } else if (needed > capacity) {
    status = 'insufficientCapacity';
    shortfall = needed - capacity;
    goal = high;
  } else {
    status = 'onTrack';
    const level = evenLevel([{ low: today.paid, high }, ...ahead], needed);
    goal = Math.min(high, Math.max(today.paid, Math.round(level)));
  }

  const reached = today.paid >= goal;
  const plan = {
    off: today.off,
    half: today.half,
    finished,
    closed,
    paid: today.paid,
    goal,
    high,
    leaveFrom,
    leaveBy,
    reached,
    progress: goal > 0 ? Math.min(1, Math.max(0, today.paid) / goal) : 1,
    /** When the share is reached, working on. */
    reachedAt: null,
    /** Work, not time: minutes of it between now and the share. */
    toDo: 0,
    departure: null,
  };
  if (!closed) {
    plan.reachedAt = reached ? now : reachedAt(today.badges, now, goal, leaveBy, offset, day) ?? leaveBy;
    plan.toDo = reached ? 0 : workLeft(today.badges, now, plan.reachedAt, day);
    plan.departure = Math.min(leaveBy, Math.max(leaveFrom, plan.reachedAt));
  }
  return { ...week, status, shortfall, days: summary, today: plan };
}
