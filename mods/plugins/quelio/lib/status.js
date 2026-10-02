// What to say about today, right now.
//
// One function, one answer: a key the strings table translates, a tone the bar
// is tinted with, and the values the sentence needs. The day moves through a
// couple of dozen situations -- not arrived, lunch soon, at lunch, the hour is
// up, back, free to leave, past the latest -- and they differ in what they say
// rather than in what they draw, so they are states of one reading and not
// components of their own.
//
// The order of the checks is the order of importance: a rule about to be
// broken outranks progress, and progress outranks a pleasantry.

import { DEFAULT_RULES, dayRules } from './rules.js';
import { lunchOf } from './day.js';

/** From when lunch is announced, and how long "lunch soon" lasts. */
export const LUNCH_SOON = 30;
/** How long before a deadline -- the latest lunch start, the latest return -- it is called out. */
export const DEADLINE = 15;
/** How long before the latest departure it is called out. */
export const LATEST_SOON = 30;
/** How long the length of lunch is shown after coming back from it. */
export const BACK_FOR = 10;

/**
 * - `week`: what `planWeek` answered.
 * - `badges`: today's, as minutes. `now`: minutes since midnight.
 * - `rules`: `readRules(...).rules`; today's are derived from them, with the
 *   afternoon off when the plan says so.
 *
 * Tones: `normal`, `success`, `warning`, `danger`, and `muted` for a state
 * with nothing to act on.
 */
export function dayStatus({ week, badges, weekday, now, rules: weekRules = DEFAULT_RULES }) {
  const plan = week.today;
  if (!plan) {
    return week.status === 'reached'
      ? { key: 'weekendReached', tone: 'success', vars: { done: week.done } }
      : { key: 'weekend', tone: 'muted', vars: { done: week.done, target: week.target } };
  }
  if (plan.off) return { key: 'dayOff', tone: 'muted', vars: {} };
  const rules = dayRules(weekRules, weekday, plan.half);

  if (badges.length === 0) {
    if (now < rules.arriveFrom) return { key: 'beforeArrival', tone: 'muted', vars: { time: rules.arriveFrom } };
    if (now < rules.arriveBy) return { key: 'arrivalWindow', tone: 'normal', vars: { time: rules.arriveBy } };
    return { key: 'noBadge', tone: 'muted', vars: {} };
  }

  const lunch = lunchOf(badges, now, rules);
  if (plan.finished) {
    return {
      key: 'dayDone',
      tone: plan.reached || week.status === 'reached' ? 'success' : 'muted',
      vars: { paid: plan.paid },
    };
  }

  // Out: at lunch, or on a break that is not lunch.
  if (badges.length % 2 === 0) {
    if (!lunch?.open) return { key: 'away', tone: 'muted', vars: { time: badges[badges.length - 1] } };
    const vars = {
      duration: lunch.duration,
      minimum: rules.lunchMinimum,
      time: lunch.earliestReturn,
      left: Math.max(0, lunch.earliestReturn - now),
      by: rules.lunchEndBy,
    };
    const progress = rules.lunchMinimum > 0 ? Math.min(1, lunch.credited / rules.lunchMinimum) : 1;
    if (now >= rules.lunchEndBy) return { key: 'lunchOverrun', tone: 'danger', vars, progress };
    if (now >= rules.lunchEndBy - DEADLINE) return { key: 'lunchEndSoon', tone: 'warning', vars, progress };
    // Started after the latest start: its hour cannot fit before the window
    // closes, and nothing after it is credited, so what there is to say is
    // when to be back -- not an hour after it began.
    if (lunch.late) return { key: 'lunchLate', tone: 'warning', vars: { ...vars, start: rules.lunchStartBy }, progress };
    if (now >= lunch.earliestReturn) return { key: 'lunchDone', tone: 'success', vars, progress };
    return { key: 'lunch', tone: 'normal', vars, progress };
  }

  // Working.
  if (now >= plan.leaveBy) return { key: 'pastLatest', tone: 'danger', vars: { time: plan.leaveBy } };

  // Lunch is owed only by somebody who was here before it had to start, and
  // not on an afternoon off, which ends where lunch would begin.
  if (!lunch && rules.takesLunch && badges[0] < rules.lunchStartBy) {
    if (now >= rules.lunchFrom - LUNCH_SOON && now < rules.lunchFrom) {
      return { key: 'lunchSoon', tone: 'normal', vars: { left: rules.lunchFrom - now, time: rules.lunchFrom } };
    }
    if (now >= rules.lunchFrom && now < rules.lunchStartBy - DEADLINE) {
      return { key: 'lunchOpen', tone: 'normal', vars: { time: rules.lunchStartBy } };
    }
    if (now >= rules.lunchStartBy - DEADLINE && now < rules.lunchStartBy) {
      return { key: 'lunchDeadline', tone: 'warning', vars: { time: rules.lunchStartBy, left: rules.lunchStartBy - now } };
    }
    if (now >= rules.lunchStartBy && now < rules.lunchEndBy) {
      return { key: 'lunchMissed', tone: 'warning', vars: { time: rules.lunchStartBy } };
    }
  }

  if (lunch && !lunch.open && now - lunch.to < BACK_FOR) {
    return {
      key: lunch.minimumMet ? 'lunchBack' : 'lunchShort',
      tone: lunch.minimumMet ? 'normal' : 'warning',
      vars: { duration: lunch.duration, minimum: rules.lunchMinimum },
    };
  }

  const leave = { time: plan.departure, left: plan.toDo, from: rules.leaveFrom };
  if (week.status === 'reached') {
    return now >= rules.leaveFrom
      ? { key: 'weekReachedLeave', tone: 'success', vars: leave }
      : { key: 'weekReached', tone: 'success', vars: leave };
  }
  if (week.status === 'insufficientCapacity') {
    return { key: 'insufficient', tone: 'danger', vars: { ...leave, time: plan.leaveBy, shortfall: week.shortfall } };
  }
  if (plan.reached) {
    return now >= rules.leaveFrom
      ? { key: 'canLeave', tone: 'success', vars: leave }
      : { key: 'dayReached', tone: 'success', vars: leave };
  }
  if (now >= plan.leaveBy - LATEST_SOON) {
    return { key: 'latestSoon', tone: 'warning', vars: { ...leave, time: plan.leaveBy } };
  }
  if (!lunch && rules.takesLunch && now < rules.lunchFrom) {
    return { key: 'started', tone: 'normal', vars: { ...leave, arrival: badges[0] }, progress: plan.progress };
  }
  return { key: 'working', tone: 'normal', vars: leave, progress: plan.progress };
}

/** The tint of the week's bar: whether the week is on course, done, or cannot be. */
export function weekTone(week) {
  if (week.status === 'reached') return 'success';
  if (week.status === 'insufficientCapacity') return 'danger';
  return 'normal';
}
