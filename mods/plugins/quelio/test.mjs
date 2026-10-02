import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  assertPluginShape, createTestApi, installDom, readModFiles, SLACK_FIXTURE,
} from '../../../tests/harness.mjs';
import plugin from './index.js';
import { STRINGS } from './strings.js';
import { DEFAULT_RULES, DEFAULTS, dayRules, readRules } from './lib/rules.js';
import {
  dayKey, formatClock, isoWeek, parseClock, parseDuration, workingDaysOf,
} from './lib/time.js';
import { anchorOffset, credit, lunchOf, planDay, readBadges, workLeft } from './lib/day.js';
import { dayMost, planWeek } from './lib/planner.js';
import { dayStatus } from './lib/status.js';
import { classify, createClient, normaliseAddress, readAnswer } from './quelio.js';
import { createSession, MANUAL_COOLDOWN } from './session.js';
import { buildView, createFormat } from './view.js';

const FOLDER = path.dirname(fileURLToPath(import.meta.url));
const FILES = readModFiles(FOLDER);

/** "08:42" -> 522, for writing the cases the way a badge reader prints them. */
const m = (text) => parseClock(text);
const badges = (...times) => times.map(m);

/** The week of Monday 28 September 2026. */
const MONDAY = 0;
const WEDNESDAY = 2;
const THURSDAY = 3;
const FRIDAY = 4;
const at = (weekday, time) => {
  const [h, min] = time.split(':').map(Number);
  return new Date(2026, 8, 28 + weekday, h, min);
};

/** A week with `past` minutes on each day before today and `today` badges. */
const weekOf = (weekday, todayBadges, past = []) => Array.from({ length: 5 }, (_, index) => {
  if (index < weekday) return { paid: past[index] ?? 0, badges: [] };
  if (index === weekday) return { paid: null, badges: todayBadges };
  return { paid: null, badges: [] };
});

const plan = (weekday, time, todayBadges, past, extra = {}) =>
  planWeek({ objective: 38 * 60, weekday, now: m(time), days: weekOf(weekday, todayBadges, past), ...extra });

const status = (weekday, time, todayBadges, past = []) => {
  const week = plan(weekday, time, todayBadges, past);
  return dayStatus({ week, badges: todayBadges, weekday, now: m(time) });
};

// -- time ---------------------------------------------------------------------

test('reads and writes the times Quelio speaks in', () => {
  assert.equal(parseClock('08:42'), 522);
  assert.equal(parseClock('8:05'), 485);
  assert.equal(parseClock('24:00'), null);
  assert.equal(parseClock('12h30'), null);
  assert.equal(parseDuration('38:12'), 2292, 'a week runs past 23 hours');
  assert.equal(parseDuration('07:60'), null);
  assert.equal(formatClock(522), '08:42');
  assert.equal(dayKey(new Date(2026, 9, 2)), '02-10-2026');
});

test('knows which week a day belongs to, at both ends of a year', () => {
  assert.equal(isoWeek(new Date(2026, 9, 2)), '2026-W40');
  assert.equal(isoWeek(new Date(2026, 8, 28)), '2026-W40');
  assert.equal(isoWeek(new Date(2027, 0, 1)), '2026-W53', 'a Friday in January can close the old year');
  assert.equal(isoWeek(new Date(2025, 11, 29)), '2026-W01', 'a Monday in December can open the new one');
  assert.deepEqual(workingDaysOf(new Date(2026, 9, 4)).map(dayKey),
    ['28-09-2026', '29-09-2026', '30-09-2026', '01-10-2026', '02-10-2026'], 'Sunday is still that week');
});

// -- counting, as Quelio counts -------------------------------------------------

test('counts a day exactly as quelio-api documents it', () => {
  // quelio-api's own README.
  assert.deepEqual(credit(badges('08:30', '12:00', '13:00', '18:30')),
    { effective: 540, bonus: 14, deduction: 0, paid: 554 });
  // quelio-api's own CLAUDE.md: 47 minutes for lunch, 9h13 effective, 9h14 paid.
  const short = credit(badges('08:30', '12:00', '12:47', '18:30'));
  assert.equal(short.effective, 9 * 60 + 13);
  assert.equal(short.deduction, 13);
  assert.equal(short.paid, 9 * 60 + 14);
});

test('counts nothing before 08:30, and an open badge only up to now', () => {
  assert.equal(credit(badges('08:00', '12:00')).effective, 210);
  assert.equal(credit(badges('08:42'), m('11:00')).paid, 138, 'no morning break credited before 12:00');
  assert.equal(credit(badges('08:42'), m('12:00')).paid, 198 + 7);
  assert.equal(credit(badges('08:42')).paid, 0, 'a past day ignores a badge left open, as Quelio does');
  assert.deepEqual(readBadges(['12:00', '08:42', 'nope', '08:42']), badges('08:42', '08:42', '12:00'),
    'sorted, garbage dropped, a double tap kept so the pairs stay where Quelio puts them');
});

test('a lunch started at 12:17 can end at 13:17', () => {
  const lunch = lunchOf(badges('08:40', '12:17'), m('12:49'));
  assert.equal(lunch.open, true);
  assert.equal(lunch.duration, 32);
  assert.equal(formatClock(lunch.earliestReturn), '13:17');
  assert.equal(lunch.minimumMet, false);
});

test('a lunch too short so far: 40 minutes in, back at 13:25, 20 minutes to go', () => {
  const lunch = lunchOf(badges('08:40', '12:25'), m('13:05'));
  assert.equal(lunch.duration, 40);
  assert.equal(formatClock(lunch.earliestReturn), '13:25');
  assert.equal(lunch.earliestReturn - m('13:05'), 20);
  const said = status(1, '13:05', badges('08:40', '12:25'), [456]);
  assert.equal(said.key, 'lunch');
  assert.deepEqual([said.vars.duration, said.vars.left, formatClock(said.vars.time)], [40, 20, '13:25']);
});

test('a lunch begun before noon is counted from noon, as Quelio counts it', () => {
  const lunch = lunchOf(badges('08:40', '11:50', '12:50'), m('14:00'));
  assert.equal(lunch.duration, 60);
  assert.equal(lunch.credited, 50);
  assert.equal(lunch.minimumMet, false);
  assert.equal(formatClock(lunch.earliestReturn), '13:00');
  assert.equal(lunch.late, false);
});

test('plans the rest of a day by the rules: arrive, take the hour, come back on time', () => {
  assert.deepEqual(planDay([], m('07:50'), m('16:30')), badges('08:30', '12:00', '13:00', '16:30'),
    'nobody arrives before 08:30');
  assert.deepEqual(planDay(badges('08:45'), m('12:20'), m('17:00')), badges('08:45', '12:20', '13:20', '17:00'));
  assert.deepEqual(planDay(badges('08:45', '12:20'), m('12:40'), m('17:00')), badges('08:45', '12:20', '13:20', '17:00'),
    'back no earlier than an hour after leaving for lunch');
  assert.deepEqual(planDay(badges('08:45'), m('13:10'), m('17:00')), badges('08:45', '17:00'),
    'no lunch invented once it can no longer start by 13:00');
  assert.equal(workLeft(badges('08:45'), m('10:00'), m('17:00')), 6 * 60, 'the hour of lunch is not work');
});

test('keeps Quelio\'s own count when it differs from the local one', () => {
  const day = badges('08:42');
  assert.equal(anchorOffset(day, credit(day, m('10:00')).paid, m('10:00'), m('10:01')), 0);
  assert.equal(anchorOffset(day, credit(day, m('10:00')).paid + 3, m('10:00'), m('10:00')), 3);
  assert.equal(anchorOffset(day, null, m('10:00'), m('10:00')), 0);
});

// -- the suggestion ---------------------------------------------------------------

/** Every suggestion, whatever the week, inside the hours the company allows. */
const assertAllowed = (week, weekday) => {
  const { departure } = week.today;
  assert.ok(departure >= DEFAULT_RULES.leaveFrom, `${formatClock(departure)} is before 16:30`);
  assert.ok(departure <= DEFAULT_RULES.countTo[weekday], `${formatClock(departure)} is after the latest`);
};

test('a normal day: 08:45, lunch 12:20 to 13:20, an even share of the week', () => {
  const week = plan(MONDAY, '14:00', badges('08:45', '12:20', '13:20'));
  assert.equal(week.status, 'onTrack');
  assert.equal(week.today.goal, 456, '38h over five days is 7h36');
  assert.equal(formatClock(week.today.departure), '17:07');
  assertAllowed(week, MONDAY);
  assert.equal(week.today.toDo, m('17:07') - m('14:00'), 'all of it work: lunch is behind');
});

test('twelve hours over today and two more days is four hours each', () => {
  // Wednesday 08:40, 26 hours already done: 12 left, three days to do them in.
  const week = plan(WEDNESDAY, '08:40', badges('08:35'), [13 * 60, 13 * 60]);
  assert.equal(week.status, 'onTrack');
  assert.equal(week.today.goal, 4 * 60);
  // Four hours of work from 08:35 is 12:28 straight through, an hour later
  // with lunch in it -- and either way, nobody leaves before 16:30.
  assert.equal(formatClock(week.today.reachedAt), '12:28');
  assert.equal(week.today.toDo, 4 * 60 - (m('08:40') - m('08:35')) - 7, 'the morning bonus is earned, not worked');
  assert.equal(formatClock(week.today.departure), '16:30');
  const later = dayStatus({ week: plan(WEDNESDAY, '14:00', badges('08:35', '12:10', '13:10'), [13 * 60, 13 * 60]),
    badges: badges('08:35', '12:10', '13:10'), weekday: WEDNESDAY, now: m('14:00') });
  assert.equal(later.key, 'dayReached', 'today\'s share is done, and leaving waits for 16:30');
  assert.equal(formatClock(later.vars.from), '16:30');
});

test('a day that cannot hold its share hands the rest to the others', () => {
  // Wednesday, 13 hours done: 25 left over three days is 8h20 each, and
  // Friday cannot hold 8h20 -- it ends at 17:30 -- so Wednesday carries more.
  const week = plan(WEDNESDAY, '08:40', badges('08:35'), [6 * 60 + 30, 6 * 60 + 30]);
  const friday = dayMost(FRIDAY);
  assert.ok(friday < dayMost(THURSDAY), 'Friday ends an hour earlier');
  assert.ok(friday < 25 * 60 / 3);
  assert.equal(week.status, 'onTrack');
  assert.equal(week.today.goal, Math.round((25 * 60 - friday) / 2));
  assertAllowed(week, WEDNESDAY);
});

test('thirty-eight hours from Wednesday morning is more than three days hold, and it says so', () => {
  const week = plan(WEDNESDAY, '08:40', badges('08:35'), [0, 0]);
  assert.equal(week.status, 'insufficientCapacity');
  assert.equal(week.shortfall, 38 * 60 - week.today.high - dayMost(THURSDAY) - dayMost(FRIDAY));
});

test('never suggests leaving before 16:30, however little is owed', () => {
  // Arithmetic alone would send this person home around 15:50.
  const week = plan(THURSDAY, '09:00', badges('08:40'), [9 * 60, 9 * 60, 9 * 60]);
  assert.equal(week.status, 'onTrack');
  assert.equal(formatClock(week.today.departure), '16:30');
  const said = dayStatus({ week, badges: badges('08:40'), weekday: THURSDAY, now: m('15:55') });
  assert.notEqual(said.key, 'canLeave', 'not free to leave at 15:55');
});

test('never suggests leaving after 18:30 on a Monday or 17:30 on a Friday', () => {
  for (const [weekday, latest] of [[MONDAY, '18:30'], [FRIDAY, '17:30']]) {
    for (const arrival of ['08:30', '08:45', '09:00']) {
      for (const owed of [0, 300, 900, 1800]) {
        const past = Array(weekday).fill(0).map(() => Math.max(0, 2280 - owed - 456 * (4 - weekday)) / Math.max(1, weekday));
        const week = plan(weekday, '09:05', badges(arrival), past);
        assertAllowed(week, weekday);
        assert.ok(week.today.departure <= m(latest));
      }
    }
  }
});

test('a late arrival at 09:00 with a lot left still takes its hour and stops at the latest', () => {
  const week = plan(MONDAY, '09:05', badges('09:00'), []);
  assertAllowed(week, MONDAY);
  const day = planDay(badges('09:00'), m('09:05'), week.today.departure);
  assert.deepEqual(day.slice(1, 3), badges('12:00', '13:00'), 'a full hour, inside the window');
  assert.equal(formatClock(week.today.departure), '17:22');
});

test('an objective already reached asks for nothing more', () => {
  const week = plan(FRIDAY, '10:00', badges('08:40'), [554, 554, 554, 554]);
  assert.equal(week.status, 'reached');
  assert.equal(week.remaining, 0);
  assert.equal(week.today.goal, week.today.paid, 'no extra hours invented');
  assert.equal(formatClock(week.today.departure), '16:30', 'and still nobody leaves before 16:30');
  assert.equal(dayStatus({ week, badges: badges('08:40'), weekday: FRIDAY, now: m('10:00') }).key, 'weekReached');
});

test('a Friday morning that cannot make the week says so instead of inventing a time', () => {
  const week = plan(FRIDAY, '09:00', badges('08:55'), [360, 360, 360, 360]);
  assert.equal(week.status, 'insufficientCapacity');
  assert.ok(week.shortfall > 0);
  assert.equal(formatClock(week.today.departure), '17:30', 'the most it can do, and no later');
  const said = dayStatus({ week, badges: badges('08:55'), weekday: FRIDAY, now: m('09:00') });
  assert.equal(said.key, 'insufficient');
  assert.equal(said.tone, 'danger');
});

test('a day off counts for a fifth of the week and takes no hours', () => {
  const days = weekOf(WEDNESDAY, badges('08:40'), [456, 456]);
  days[FRIDAY].off = true;
  const week = planWeek({ objective: 2280, weekday: WEDNESDAY, now: m('09:00'), days });
  assert.equal(week.target, 2280 - 456);
  assert.equal(week.daysOff, 1);
  assert.equal(week.today.goal, 456);
  // A day with time on it was worked, whatever it was marked as.
  days[MONDAY].off = true;
  assert.equal(planWeek({ objective: 2280, weekday: WEDNESDAY, now: m('09:00'), days }).daysOff, 1);
});

test('the weekend shows the week, and plans nothing', () => {
  const week = planWeek({ objective: 2280, weekday: 5, now: m('11:00'), days: weekOf(5, [], [456, 456, 456, 456, 456]) });
  assert.equal(week.today, null);
  assert.equal(week.status, 'reached');
  assert.equal(dayStatus({ week, badges: [], weekday: 5, now: m('11:00') }).key, 'weekendReached');
});

// -- the day, through its hours -----------------------------------------------------

test('says something different at every turn of the day', () => {
  const tuesday = 1;
  const past = [456];
  const cases = [
    ['08:10', [], 'beforeArrival'],
    ['08:40', [], 'arrivalWindow'],
    ['09:30', [], 'noBadge'],
    ['10:00', ['08:42'], 'started'],
    ['11:42', ['08:42'], 'lunchSoon'],
    ['12:10', ['08:42'], 'lunchOpen'],
    ['12:50', ['08:42'], 'lunchDeadline'],
    ['13:10', ['08:42'], 'lunchMissed'],
    ['12:49', ['08:42', '12:17'], 'lunch'],
    ['13:20', ['08:42', '12:17'], 'lunchDone'],
    ['13:50', ['08:42', '12:17'], 'lunchEndSoon'],
    ['14:05', ['08:42', '12:17'], 'lunchOverrun'],
    ['13:25', ['08:42', '12:17', '13:21'], 'lunchBack'],
    ['13:00', ['08:42', '12:17', '12:55'], 'lunchShort'],
    ['15:00', ['08:42', '12:17', '13:21'], 'working'],
    ['15:10', ['08:42', '12:17', '13:21', '15:02'], 'away'],
    ['18:05', ['08:42', '12:17', '13:21'], 'canLeave'],
    ['18:35', ['08:42', '12:17', '13:21'], 'pastLatest'],
    ['18:40', ['08:42', '12:17', '13:21', '17:40'], 'dayDone'],
  ];
  for (const [time, times, expected] of cases) {
    assert.equal(status(tuesday, time, badges(...times), past).key, expected, `${time} ${times.join(' ')}`);
  }
});

test('free to leave from 16:30 once today\'s share is done, and only then', () => {
  const past = [554, 554, 554];
  const early = status(THURSDAY, '16:10', badges('08:30', '12:00', '13:00'), past);
  assert.equal(early.key, 'dayReached');
  assert.equal(formatClock(early.vars.from), '16:30');
  assert.equal(status(THURSDAY, '16:31', badges('08:30', '12:00', '13:00'), past).key, 'canLeave');
});

test('the latest departure is called out before it passes', () => {
  // Friday, 8h10 still owed: it can be done, just, by 17:26 -- so at 17:05
  // the thing to say is that 17:30 is close.
  const said = status(FRIDAY, '17:05', badges('08:30', '12:00', '13:00'), [448, 448, 447, 447]);
  assert.equal(said.key, 'latestSoon');
  assert.equal(formatClock(said.vars.time), '17:30');
  assert.equal(said.tone, 'warning');
});

test('lunch is not owed by somebody who arrived after it had to start', () => {
  assert.equal(status(1, '13:40', badges('13:30'), [456]).key, 'working');
});

// -- the rules, as settings --------------------------------------------------------

test('the defaults are the company\'s rules', () => {
  const { rules, invalid } = readRules();
  assert.deepEqual(invalid, []);
  assert.deepEqual(rules, DEFAULT_RULES);
  assert.deepEqual(
    [rules.countFrom, ...rules.countTo, rules.leaveFrom, rules.arriveBy].map(formatClock),
    ['08:30', '18:30', '18:30', '18:30', '18:30', '17:30', '16:30', '09:00']);
  assert.deepEqual([rules.morningBreakFrom, rules.afternoonBreakFrom, rules.lunchFrom, rules.lunchStartBy, rules.lunchEndBy]
    .map(formatClock), ['12:00', '16:00', '12:00', '13:00', '14:00']);
  assert.deepEqual([rules.breakMinutes, rules.lunchMinimum], [7, 60]);
});

test('every rule in the code is a setting in the manifest, with the same default', () => {
  const manifest = JSON.parse(readFileSync(path.join(FOLDER, 'mod.json'), 'utf8'));
  for (const [key, value] of Object.entries(DEFAULTS)) {
    const field = manifest.settings.find((entry) => entry.key === key);
    assert.ok(field, `${key} is a setting`);
    assert.equal(field.default, value, `${key} defaults to ${value}`);
    assert.ok(field.labels?.fr && field.hints?.fr, `${key} speaks French`);
  }
});

test('a setting that cannot be read is its default, and nothing throws', () => {
  const read = (values) => readRules((key, fallback) => (key in values ? values[key] : fallback));
  const typo = read({ countTo: '18h30', breakMinutes: -3, lunchMinimum: '45', leaveFrom: '16:00' });
  assert.deepEqual(typo.invalid.sort(), ['breakMinutes', 'countTo']);
  assert.equal(typo.rules.countTo[0], m('18:30'));
  assert.equal(typo.rules.breakMinutes, 7);
  assert.equal(typo.rules.lunchMinimum, 45, 'a number written as text is still the number');
  assert.equal(typo.rules.leaveFrom, m('16:00'));
  const backwards = read({ countFrom: '19:00' });
  assert.deepEqual(backwards.invalid, ['order'], 'a day that ends before it starts is not used');
  assert.deepEqual(backwards.rules, DEFAULT_RULES);
  assert.deepEqual(readRules(() => { throw new Error('boom'); }).rules, DEFAULT_RULES);
  assert.deepEqual(read({ countFrom: null, lunchFrom: { nope: 1 } }).rules.lunchFrom, m('12:00'));
});

test('another deployment\'s rules change the count and the plan', () => {
  const { rules } = readRules((key, fallback) => ({
    countToFriday: '18:30', morningBreakFrom: '11:00', breakMinutes: 10, leaveFrom: '16:00',
  })[key] ?? fallback);
  assert.equal(dayMost(FRIDAY, rules), dayMost(MONDAY, rules), 'Friday as long as Monday');
  assert.equal(credit(badges('08:42'), m('11:00'), dayRules(rules, MONDAY)).paid, 138 + 10);
  const week = planWeek({ objective: 2280, weekday: THURSDAY, now: m('09:00'), days: weekOf(THURSDAY, badges('08:40'), [540, 540, 540]), rules });
  assert.equal(formatClock(week.today.departure), '16:00');
});

test('the morning break is credited only once 12:00 has passed, the afternoon one from 16:00', () => {
  assert.equal(credit(badges('08:30', '11:59')).paid, 209, 'leaving just before noon loses the 7 minutes');
  assert.equal(credit(badges('08:30', '12:00')).paid, 210 + 7);
  assert.equal(credit(badges('08:30', '12:00', '13:00', '15:59')).paid, 210 + 179 + 7);
  assert.equal(credit(badges('08:30', '12:00', '13:00', '16:00')).paid, 210 + 180 + 14);
});

test('a lunch shorter than the hour is deducted, up to the breaks; one ending after 14:00 is not', () => {
  assert.equal(credit(badges('08:30', '12:00', '12:50', '17:00')).deduction, 10);
  assert.equal(credit(badges('08:30', '12:00', '12:30', '17:00')).deduction, 14, 'never more than the breaks gave');
  assert.equal(credit(badges('08:30', '12:30', '14:10', '17:00')).deduction, 0, 'back after 14:00: nothing');
  assert.equal(credit(badges('08:30', '12:00', '13:00', '17:30'), null, dayRules(DEFAULT_RULES, FRIDAY)).effective,
    210 + 270, 'nothing counted after 17:30 on a Friday');
});

test('a day that reaches its share before 16:30 lightens the days after it', () => {
  // Thursday morning, the same week with Wednesday left at 15:00 or at 16:30.
  const left = (wednesday) => plan(THURSDAY, '09:00', badges('08:40'), [456, 456, wednesday]).today.goal;
  assert.ok(left(456 + 90) < left(456), 'an hour and a half more on Wednesday is less asked on Thursday');
  assert.equal(left(456) - left(456 + 90), 45, 'shared over the two days left');
});

// -- an afternoon off ------------------------------------------------------------------

test('an afternoon off counts for half a day, holds a morning, and has no 16:30 floor', () => {
  const days = weekOf(WEDNESDAY, badges('08:30'), [456, 456]);
  days[WEDNESDAY].half = true;
  const week = planWeek({ objective: 2280, weekday: WEDNESDAY, now: m('09:00'), days });
  assert.equal(week.afternoonsOff, 1);
  assert.equal(week.target, 2280 - 228);
  assert.equal(week.today.half, true);
  assert.equal(formatClock(week.today.leaveBy), '13:00', 'the morning ends where lunch would have to start');
  assert.ok(week.today.high <= credit(badges('08:30', '13:00')).paid);
  assert.ok(week.today.departure < DEFAULT_RULES.leaveFrom, `${formatClock(week.today.departure)}: before 16:30 is allowed`);
  assert.deepEqual(planDay(badges('08:30'), m('09:00'), m('12:30'), dayRules(DEFAULT_RULES, WEDNESDAY, true)),
    badges('08:30', '12:30'), 'no lunch planned');
});

test('on an afternoon off, the morning\'s share reached is free to leave, at noon', () => {
  // 3h37 a day left over Wednesday morning, Thursday and Friday: 08:30 to noon, break included.
  const days = weekOf(WEDNESDAY, badges('08:30'), [700, 700]);
  days[WEDNESDAY].half = true;
  const week = planWeek({ objective: 2280, weekday: WEDNESDAY, now: m('12:05'), days });
  const said = dayStatus({ week, badges: badges('08:30'), weekday: WEDNESDAY, now: m('12:05') });
  assert.equal(said.key, 'canLeave');
  assert.equal(formatClock(week.today.departure), '12:05');
  const gone = badges('08:30', '12:10');
  const after = planWeek({ objective: 2280, weekday: WEDNESDAY, now: m('12:20'), days: weekOf(WEDNESDAY, gone, [700, 700]).map((d, i) => (i === WEDNESDAY ? { ...d, half: true } : d)) });
  assert.equal(dayStatus({ week: after, badges: gone, weekday: WEDNESDAY, now: m('12:20') }).key, 'dayDone',
    'the badge out at noon is the end of the day, not a lunch');
});

test('an afternoon off ahead holds only its morning', () => {
  const days = weekOf(WEDNESDAY, badges('08:35'), [6 * 60 + 30, 6 * 60 + 30]);
  days[FRIDAY].half = true;
  const week = planWeek({ objective: 2280, weekday: WEDNESDAY, now: m('08:40'), days });
  assert.equal(dayMost(FRIDAY, DEFAULT_RULES, true), credit(badges('08:30', '13:00')).paid);
  assert.equal(week.target, 2280 - 228);
});

// -- a lunch started late --------------------------------------------------------------

test('a lunch started after 13:00 says when to be back, and plans the return then', () => {
  const day = badges('08:42', '13:30');
  const lunch = lunchOf(day, m('13:40'));
  assert.equal(lunch.late, true);
  assert.equal(formatClock(lunch.earliestReturn), '14:00', 'nothing after 14:00 is credited, so no later');
  const said = status(1, '13:40', day, [456]);
  assert.equal(said.key, 'lunchLate');
  assert.equal(said.tone, 'warning');
  const t = (table) => (key, vars = {}) => table[key].replace(/\{(\w+)\}/g, (_, name) => String(vars[name]));
  const en = createFormat(t(STRINGS.en), 'en-GB').sentence(said);
  assert.equal(en, 'Lunch started after 13:00 · 10 min · back by 14:00');
  assert.ok(!en.includes('14:30'));
  assert.equal(createFormat(t(STRINGS.fr), 'fr-FR').sentence(said),
    'Pause commencée après 13:00 · 10 min · reprise avant 14:00');
  assert.deepEqual(planDay(day, m('13:40'), m('17:00')), badges('08:42', '13:30', '14:00', '17:00'));
  assert.equal(status(1, '13:50', day, [456]).key, 'lunchEndSoon');
});

// -- the server ---------------------------------------------------------------------

test('makes the address one a POST can use', () => {
  assert.equal(normaliseAddress(' https://example.com/projects/quelio/api '), 'https://example.com/projects/quelio/api/');
  assert.equal(normaliseAddress('https://example.com/quelio/index.php'), 'https://example.com/quelio/index.php');
  assert.equal(normaliseAddress('https://example.com'), 'https://example.com/');
  assert.equal(normaliseAddress('http://example.com/api/'), null, 'a password never crosses plain http');
  assert.equal(normaliseAddress('https://user:secret@example.com/api/'), null);
  assert.equal(normaliseAddress('not an address'), null);
});

const clockText = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Quelio's answer, shaped like quelio-api's README, for the week holding `date`. */
function answerFor(date, { today = ['08:42', '12:18', '13:22'], past = '07:36', objective = 2280, token = 'tok-1' } = {}) {
  const days = {};
  const keys = workingDaysOf(date).map(dayKey);
  const index = keys.indexOf(dayKey(date));
  keys.forEach((key, i) => {
    if (i < index) days[key] = { hours: ['08:30', '12:00', '13:00', '16:22'], breaks: {}, effective: past, paid: past };
    // Today as quelio-api counts it at the moment it answers.
    if (i === index) days[key] = { hours: today, breaks: {}, effective: '', paid: clockText(credit(readBadges(today), date.getHours() * 60 + date.getMinutes()).paid) };
  });
  return {
    preferences: { theme: 'ocean', minutes_objective: objective },
    token,
    weeks: {
      '2026-w-39': { days: { '25-09-2026': { hours: ['08:30', '18:30'], paid: '10:00' } } },
      [isoWeek(date).replace('W', 'w-')]: { days, total_effective: '00:00', total_paid: '00:00' },
    },
  };
}

test('keeps this week of the answer and nothing else', () => {
  const data = readAnswer(answerFor(at(WEDNESDAY, '14:00')), at(WEDNESDAY, '14:00'));
  assert.equal(data.objective, 2280);
  assert.equal(data.token, 'tok-1');
  assert.deepEqual(Object.keys(data.days).sort(), ['28-09-2026', '29-09-2026', '30-09-2026']);
  assert.deepEqual(data.days['30-09-2026'].badges, badges('08:42', '12:18', '13:22'));
  assert.equal(data.days['28-09-2026'].paid, 456);
});

test('reads an answer that is short of something without falling over', () => {
  assert.equal(readAnswer(null), null);
  assert.equal(readAnswer({ error: 'nope' }), null);
  assert.equal(readAnswer({ weeks: 'garbage' }), null);
  const empty = readAnswer({ preferences: [], token: 't', weeks: [] }, at(MONDAY, '09:00'));
  assert.deepEqual(empty.days, {}, 'PHP writes an empty map as []');
  assert.equal(empty.objective, 2280, 'no objective from Quelio is 38 hours');
  assert.equal(empty.objectiveReported, false);
  assert.equal(readAnswer({ preferences: { minutes_objective: '1824' }, weeks: [] }, at(MONDAY, '09:00')).objective, 1824,
    'an objective written as text is still the objective');
  assert.equal(readAnswer({ preferences: { minutes_objective: 'lots' }, weeks: [] }, at(MONDAY, '09:00')).objectiveReported, false);
  const odd = readAnswer({ weeks: { x: { days: { '28-09-2026': { hours: 'nope', paid: 7 } } } } }, at(MONDAY, '09:00'));
  assert.deepEqual(odd.days['28-09-2026'], { badges: [], paid: null });
});

test('tells every kind of failure apart', () => {
  const today = at(MONDAY, '10:00');
  const ask = (answer, signingIn = false) => classify(answer, { signingIn, today });
  assert.deepEqual(ask({ status: 401, json: { error: 'Invalid username or password: x (3 attempts remaining)', token_invalidated: true } }, true),
    { ok: false, reason: 'credentials', attemptsLeft: 3 });
  assert.equal(ask({ status: 401, json: { error: 'Invalid or expired token' } }).reason, 'expired',
    'a 401 without the flag still ends the session');
  assert.equal(ask({ status: 401, json: { error: 'Failed to fetch data from Kelio. Please login again.', token_invalidated: true } }).reason, 'expired');
  assert.deepEqual(ask({ status: 429, json: { retry_after: 120 } }), { ok: false, reason: 'rateLimited', retryAfter: 120 });
  assert.equal(ask({ status: 301, json: null }).reason, 'redirect');
  assert.equal(ask({ status: 404, json: null }).reason, 'notFound');
  assert.equal(ask({ status: 500, json: { error: 'boom' } }).reason, 'server');
  assert.equal(ask({ status: 200, json: { nope: true } }).reason, 'malformed');
  assert.equal(ask({ error: 'timeout' }).reason, 'timeout');
  assert.equal(ask({ error: 'network' }).reason, 'unreachable');
  assert.equal(ask({ error: 'blocked' }).reason, 'address');
  assert.equal(ask({ status: 200, json: answerFor(today) }).ok, true);
});

// -- the session --------------------------------------------------------------------

const ADDRESS = 'https://quelio.example.com/api/';
const PASSWORD = 'correct horse battery staple';

const SESSION = { server: ADDRESS, username: 'robin', token: 'tok-1' };

/** A file the plugin kept through api.data, read back the way it reads it. */
const keptFile = (recorded, name) => {
  const entry = recorded.data.get(name);
  return entry ? JSON.parse(new TextDecoder().decode(entry.bytes)) : null;
};

/** Everything the plugin keeps anywhere -- its settings and its own files -- as one string. */
const everything = (store, recorded) => JSON.stringify(store)
  + [...recorded.data.values()].map((entry) => new TextDecoder().decode(entry.bytes)).join('');

/**
 * A session against an imitated quelio-api, on a clock the test moves, with
 * `kept` -- files by name -- already on disk from an earlier launch.
 */
async function rig({ settings = { apiUrl: ADDRESS }, kept = {}, answer, now = at(WEDNESDAY, '14:00') } = {}) {
  const clock = { now };
  const server = answer ?? ((url, options) => {
    const form = options.form ?? {};
    if (form.password && form.password !== PASSWORD) {
      return { status: 401, json: { error: 'Invalid username or password: refused (4 attempts remaining)', token_invalidated: true } };
    }
    if (!form.password && form.token !== 'tok-1') return { status: 401, json: { error: 'Invalid or expired token' } };
    return { status: 200, json: answerFor(clock.now) };
  });
  const { api, recorded, store } = createTestApi({ settings, net: async (url, options) => server(url, options) });
  for (const [name, value] of Object.entries(kept)) await api.data.write(name, JSON.stringify(value));
  const session = createSession({ api, client: createClient(api, () => clock.now), clock: () => clock.now });
  await session.load();
  return { api, recorded, store, session, clock };
}

test('signs in with the password once, then keeps only the token, in its own files', async () => {
  const { session, recorded, store } = await rig({ settings: { apiUrl: ADDRESS } });
  const outcome = await session.signIn('robin', PASSWORD);
  assert.deepEqual(outcome, { ok: true });
  assert.deepEqual(recorded.requests, [{
    url: ADDRESS,
    method: 'POST',
    form: { action: 'login', username: 'robin', password: PASSWORD },
  }]);
  assert.deepEqual(keptFile(recorded, 'session.json'), SESSION);
  assert.ok(keptFile(recorded, 'hours.json')?.days?.['30-09-2026'], 'this week is kept for the next launch');
  assert.equal(store.lastUser, 'robin');
  assert.ok(!JSON.stringify(store).includes('tok-1'),
    'the token is not in the settings, which go into every backup and every page');
  assert.ok(!everything(store, recorded).includes(PASSWORD), 'the password is stored nowhere');
});

test('a refused sign-in keeps nothing and says how many tries are left', async () => {
  const { session, store, recorded } = await rig();
  const outcome = await session.signIn('robin', 'wrong');
  assert.deepEqual(outcome, { ok: false, reason: 'credentials', attemptsLeft: 4 });
  assert.equal(keptFile(recorded, 'session.json'), null);
  assert.ok(!everything(store, recorded).includes('wrong'));
  assert.equal(recorded.requests.length, 1, 'and it is not tried again behind the reader');
});

test('refreshes with the username and the token, never the password', async () => {
  const { session, recorded } = await rig();
  await session.signIn('robin', PASSWORD);
  recorded.requests.length = 0;
  assert.equal(await session.refresh(), true);
  assert.deepEqual(recorded.requests[0].form, { action: 'login', username: 'robin', token: 'tok-1' });
});

test('a token Quelio no longer accepts signs out, and nothing asks again', async () => {
  const { session, recorded, store, clock } = await rig({
    settings: { apiUrl: ADDRESS, lastUser: 'robin' },
    kept: { 'session.json': { ...SESSION, token: 'stale' } },
  });
  assert.equal(session.due(), true);
  session.tick();
  await session.refresh();
  assert.equal(session.state.session, null);
  assert.equal(session.state.expired, true);
  assert.equal(keptFile(recorded, 'session.json'), null);
  assert.equal(keptFile(recorded, 'hours.json'), null);
  assert.equal(store.lastUser, 'robin', 'the name stays, to sign back in');
  const asked = recorded.requests.length;
  clock.now = new Date(clock.now.getTime() + 3 * 3600_000);
  session.tick();
  await session.refresh();
  assert.equal(recorded.requests.length, asked, 'no request goes out with a token known to be dead');
});

test('signing out forgets the token, the hours and the name', async () => {
  const { session, store, recorded } = await rig();
  await session.signIn('robin', PASSWORD);
  await session.signOut();
  assert.equal(keptFile(recorded, 'session.json'), null);
  assert.equal(keptFile(recorded, 'hours.json'), null);
  assert.equal(store.lastUser, '');
  assert.equal(session.state.session, null);
});

test('a session from another server is not used', async () => {
  const { session } = await rig({
    settings: { apiUrl: 'https://elsewhere.example.com/api/' },
    kept: { 'session.json': SESSION },
  });
  assert.equal(session.state.session, null);
});

test('nothing is drawn as signed out before what was kept has been read', async () => {
  const { api } = createTestApi({ settings: { apiUrl: ADDRESS } });
  await api.data.write('session.json', JSON.stringify(SESSION));
  const session = createSession({ api, client: createClient(api) });
  assert.equal(buildView(session.state, new Date()).phase, 'loading');
  assert.equal(session.due(), false, 'nor is anything asked of the server');
  await session.load();
  assert.notEqual(buildView(session.state, new Date()).phase, 'signedOut');
});

test('the first sign-in can bring the address, which is saved before anything is sent', async () => {
  const order = [];
  // Read when the request arrives, which is after the rig is built.
  const rigged = await rig({
    settings: {},
    answer: () => {
      order.push(`request with apiUrl=${rigged.store.apiUrl}`);
      return { status: 200, json: answerFor(at(WEDNESDAY, '14:00')) };
    },
  });
  assert.equal(rigged.session.state.address, null);
  assert.deepEqual(await rigged.session.signIn('robin', PASSWORD, 'http://quelio.example.com/api'), { ok: false, reason: 'address' });
  assert.deepEqual(await rigged.session.signIn('robin', PASSWORD, 'https://quelio.example.com/api'), { ok: true });
  assert.deepEqual(order, [`request with apiUrl=${ADDRESS}`]);
});

test('asks at most once an hour, and never twice at the same time', async () => {
  const { session, recorded, clock } = await rig();
  await session.signIn('robin', PASSWORD);
  recorded.requests.length = 0;
  assert.equal(session.due(), false, 'just read');
  clock.now = new Date(clock.now.getTime() + 59 * 60_000);
  assert.equal(session.due(), false);
  clock.now = new Date(clock.now.getTime() + 60_000);
  assert.equal(session.due(), true);
  const first = session.refresh();
  const second = session.refresh();
  assert.equal(first, second, 'a second caller gets the request already travelling');
  await first;
  assert.equal(recorded.requests.length, 1);
});

test('a cache read today is used at once after a restart, without asking', async () => {
  const now = at(WEDNESDAY, '14:00');
  const hours = {
    week: isoWeek(now),
    fetchedAt: now.getTime() - 10 * 60_000,
    objective: 2280,
    days: { '30-09-2026': { badges: badges('08:42'), paid: 300 } },
    offset: { day: '30-09-2026', minutes: 0 },
  };
  const { session } = await rig({ kept: { 'session.json': SESSION, 'hours.json': hours }, now });
  assert.equal(session.due(), false);
  assert.equal(buildView(session.state, now).phase, 'ready');
});

test('waits out a server that is down, and longer each time', async () => {
  let up = false;
  const { session, recorded, clock } = await rig({
    kept: { 'session.json': SESSION },
    answer: () => (up ? { status: 200, json: answerFor(clock.now) } : { error: 'network' }),
  });
  await session.refresh();
  assert.equal(session.state.failure.reason, 'unreachable');
  const firstWait = session.state.failure.retryAt - clock.now.getTime();
  assert.equal(session.due(), false);
  clock.now = new Date(session.state.failure.retryAt);
  assert.equal(session.due(), true);
  await session.refresh();
  assert.ok(session.state.failure.retryAt - clock.now.getTime() > firstWait, 'the second wait is longer');
  up = true;
  clock.now = new Date(session.state.failure.retryAt);
  await session.refresh();
  assert.equal(session.state.failure, null);
  assert.equal(recorded.requests.length, 3);
});

test('a 429 is waited out for as long as Quelio says', async () => {
  const { session, clock } = await rig({
    kept: { 'session.json': SESSION },
    answer: () => ({ status: 429, json: { error: 'Too many login attempts.', retry_after: 240 } }),
  });
  await session.refresh();
  assert.equal(session.state.failure.reason, 'rateLimited');
  assert.equal(session.state.failure.retryAt - clock.now.getTime(), 240_000);
  assert.ok(session.manualWait() > 0, 'not even by hand');
});

test('a refresh by hand waits five minutes after the last one', async () => {
  const { session, recorded, clock } = await rig();
  await session.signIn('robin', PASSWORD);
  recorded.requests.length = 0;
  assert.ok(session.manualWait() > 0);
  assert.equal(await session.refreshNow(), false);
  clock.now = new Date(clock.now.getTime() + MANUAL_COOLDOWN);
  assert.equal(session.manualWait(), 0);
  assert.equal(await session.refreshNow(), true);
  assert.equal(recorded.requests.length, 1);
});

test('stops asking once the day is over, and at the weekend', async () => {
  const { session, clock } = await rig({ now: at(WEDNESDAY, '18:45') });
  await session.signIn('robin', PASSWORD);
  clock.now = at(WEDNESDAY, '21:00');
  assert.equal(session.due(), false, 'nothing can change after the latest departure');
  clock.now = at(THURSDAY, '07:30');
  assert.equal(session.due(), false, 'not before the day can have started');
  clock.now = at(THURSDAY, '08:00');
  assert.equal(session.due(), true, 'a new day is a new set of badges, from half an hour before it is counted');

  const weekend = await rig({ now: at(5, '10:00') });
  await weekend.session.signIn('robin', PASSWORD);
  weekend.clock.now = at(5, '15:00');
  assert.equal(weekend.session.due(), false);
});

test('a day marked off is kept for this week only', async () => {
  const { session, store } = await rig();
  session.toggleDayOff(FRIDAY);
  assert.deepEqual(store.daysOff, { week: '2026-W40', days: [FRIDAY], afternoons: [] });
  session.toggleDayOff(FRIDAY);
  assert.deepEqual(store.daysOff.days, []);
  const later = await rig({ settings: { apiUrl: ADDRESS, daysOff: { week: '2026-W39', days: [FRIDAY] } } });
  assert.deepEqual(later.session.state.daysOff, [], 'last week\'s days off are not this week\'s');
});

/** Every minute from `from` to `to`, as the plugin's 60-second check does; the requests sent in between. */
async function runClock(rigged, from, to) {
  const before = rigged.recorded.requests.length;
  const sent = [];
  for (let t = from.getTime(); t < to.getTime(); t += 60_000) {
    rigged.clock.now = new Date(t);
    const count = rigged.recorded.requests.length;
    await rigged.session.tick();
    await new Promise((resolve) => setImmediate(resolve));
    if (rigged.recorded.requests.length > count) sent.push(formatClock(rigged.clock.now.getHours() * 60 + rigged.clock.now.getMinutes()));
  }
  return { count: rigged.recorded.requests.length - before, sent };
}

test('asks nothing overnight once the day is settled', async () => {
  const rigged = await rig({ now: at(1, '17:00') });
  await rigged.session.signIn('robin', PASSWORD);
  const evening = await runClock(rigged, at(1, '17:00'), at(1, '19:00'));
  assert.deepEqual(evening.sent, ['18:00', '18:30'], 'the hour, then once at the end to see the departure');
  assert.equal((await runClock(rigged, at(1, '19:00'), at(WEDNESDAY, '08:00'))).count, 0);
  assert.deepEqual((await runClock(rigged, at(WEDNESDAY, '08:00'), at(WEDNESDAY, '08:01'))).sent, ['08:00'],
    'and again half an hour before the day is counted');
});

test('asks nothing at the weekend once the week is held', async () => {
  const rigged = await rig({ now: at(FRIDAY, '16:00') });
  await rigged.session.signIn('robin', PASSWORD);
  assert.deepEqual((await runClock(rigged, at(FRIDAY, '16:00'), at(FRIDAY, '19:00'))).sent, ['17:00', '17:30']);
  assert.equal((await runClock(rigged, at(FRIDAY, '19:00'), at(7, '08:00'))).count, 0,
    'Friday night to Monday 08:00, a new week included');
});

test('with nothing held, the weekend asks once', async () => {
  const rigged = await rig({ kept: { 'session.json': SESSION }, now: at(5, '10:00') });
  assert.equal((await runClock(rigged, at(5, '10:00'), at(7, '07:00'))).count, 1);
});

test('a reload remembers a 429 and the last attempt', async () => {
  const first = await rig({
    kept: { 'session.json': SESSION },
    answer: () => ({ status: 429, json: { error: 'Too many login attempts.', retry_after: 240 } }),
  });
  await first.session.refresh();
  assert.equal(first.recorded.requests.length, 1);
  // The same files, a new instance: a settings change, a hot reload, a toggle.
  const again = createSession({ api: first.api, client: createClient(first.api, () => first.clock.now), clock: () => first.clock.now });
  await again.load();
  assert.equal(again.state.failure?.reason, 'rateLimited');
  assert.equal(again.due(), false);
  assert.ok(again.manualWait() > 0);
  first.clock.now = new Date(first.clock.now.getTime() + MANUAL_COOLDOWN);
  assert.equal(again.manualWait(), 0);
  assert.ok(!JSON.stringify(keptFile(first.recorded, 'throttle.json')).includes('tok-1'), 'no token in it');
});

test('a reload keeps the five minutes between refreshes by hand', async () => {
  const { api, session, clock } = await rig();
  await session.signIn('robin', PASSWORD);
  const again = createSession({ api, client: createClient(api, () => clock.now), clock: () => clock.now });
  await again.load();
  assert.ok(again.manualWait() > 0);
  assert.equal(await again.refreshNow(), false);
});

test('a request still travelling from the instance a reload replaced is not sent again', async () => {
  let release;
  let hold = false;
  const rigged = await rig({
    answer: () => (hold
      ? new Promise((resolve) => { release = () => resolve({ status: 200, json: answerFor(rigged.clock.now) }); })
      : { status: 200, json: answerFor(rigged.clock.now) }),
  });
  await rigged.session.signIn('robin', PASSWORD);
  rigged.clock.now = new Date(rigged.clock.now.getTime() + 61 * 60_000);
  hold = true;
  const travelling = rigged.session.refresh();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(rigged.recorded.requests.length, 2);

  const next = createSession({ api: rigged.api, client: createClient(rigged.api, () => rigged.clock.now), clock: () => rigged.clock.now });
  await next.load();
  await next.tick();
  assert.equal(rigged.recorded.requests.length, 2, 'not asked again while the first is out');
  release();
  await travelling;
  rigged.clock.now = new Date(rigged.clock.now.getTime() + 6 * 60_000);
  await next.tick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(rigged.recorded.requests.length, 2, 'and its answer is read off the disk instead');
  assert.equal(next.state.hours.fetchedAt, keptFile(rigged.recorded, 'hours.json').fetchedAt);
});

test('an afternoon off is kept for this week, and replaces a day off', async () => {
  const { session, store } = await rig();
  session.toggleDayOff(FRIDAY);
  session.toggleAfternoonOff(FRIDAY);
  assert.deepEqual(store.daysOff, { week: '2026-W40', days: [], afternoons: [FRIDAY] });
  const later = await rig({ settings: { apiUrl: ADDRESS, daysOff: store.daysOff } });
  assert.deepEqual(later.session.state.afternoonsOff, [FRIDAY]);
});

// -- the words ------------------------------------------------------------------------

test('every situation has words, in English and in French', () => {
  const keys = [
    'weekend', 'weekendReached', 'dayOff', 'beforeArrival', 'arrivalWindow', 'noBadge', 'dayDone', 'away',
    'lunch', 'lunchDone', 'lunchEndSoon', 'lunchLate', 'lunchOverrun', 'pastLatest', 'lunchSoon', 'lunchOpen',
    'lunchDeadline', 'lunchMissed', 'lunchBack', 'lunchShort', 'weekReached', 'weekReachedLeave',
    'insufficient', 'canLeave', 'dayReached', 'latestSoon', 'started', 'working',
  ];
  for (const language of ['en', 'fr']) {
    for (const key of keys) assert.ok(STRINGS[language][`status_${key}`], `${language}: status_${key}`);
  }
  for (const reason of ['credentials', 'expired', 'rateLimited', 'unreachable', 'timeout', 'address',
    'redirect', 'notFound', 'refused', 'server', 'malformed', 'empty', 'busy']) {
    assert.ok(STRINGS.en[`error_${reason}`] && STRINGS.fr[`error_${reason}`], `error_${reason}`);
  }
});

test('writes durations and times the way each language does', () => {
  const t = (table) => (key, vars = {}) => table[key].replace(/\{(\w+)\}/g, (_, name) => String(vars[name]));
  const fr = createFormat(t(STRINGS.fr), 'fr-FR');
  const en = createFormat(t(STRINGS.en), 'en-GB');
  assert.equal(fr.duration(29 * 60 + 42), '29h42');
  assert.equal(fr.duration(38 * 60), '38h');
  assert.equal(fr.duration(18), '18 min');
  assert.equal(en.duration(29 * 60 + 42), '29h 42m');
  assert.equal(fr.percent(0.784), '78 %');
  assert.equal(fr.sentence({ key: 'lunch', vars: { duration: 32, minimum: 60, time: m('13:17') } }),
    'Pause · 32 min / 1h · reprise à 13:17');
  assert.equal(fr.sentence({ key: 'working', vars: { left: 128, time: m('17:24') } }), 'Encore 2h08 · départ 17:24');
});

// -- in the client ----------------------------------------------------------------------

/** The top bar's right-hand side as Slack 4.51 draws it: its own first item, then its buttons. */
const TOP_NAV = `
  <div class="p-ia4_top_nav" data-qa="top-nav">
    <div class="p-ia4_top_nav__right_container">
      <div class="p-ia4_top_nav__right_container--start margin_left_50"></div>
      <div class="align_items_center display_flex"></div>
    </div>
  </div>`;

/**
 * The plugin reads the computer's clock, and what it asks depends on the hour:
 * nothing at night or at the weekend. Its tests run on a Wednesday afternoon
 * whenever they are run.
 */
const RealDate = globalThis.Date;
function fixClock(fixed) {
  class FixedDate extends RealDate {
    constructor(...args) {
      if (args.length) super(...args);
      else super(fixed.getTime());
    }
    static now() { return fixed.getTime(); }
  }
  globalThis.Date = FixedDate;
  return () => { globalThis.Date = RealDate; };
}

/** The plugin in a Slack-shaped page, against an imitated quelio-api. */
async function startPlugin({ settings = { apiUrl: ADDRESS }, kept = {} } = {}) {
  const unfix = fixClock(at(WEDNESDAY, '14:00'));
  const dom = installDom(TOP_NAV + SLACK_FIXTURE);
  const server = (url, options) => {
    const form = options.form ?? {};
    if (form.password && form.password !== PASSWORD) {
      return { status: 401, json: { error: 'Invalid username or password: no (4 attempts remaining)', token_invalidated: true } };
    }
    return { status: 200, json: answerFor(new Date()) };
  };
  const rigged = createTestApi({ settings, files: FILES, locale: 'fr-FR', net: async (url, options) => server(url, options) });
  for (const [name, value] of Object.entries(kept)) await rigged.api.data.write(name, JSON.stringify(value));
  await plugin.start(rigged.api);
  const stop = () => {
    for (const dispose of rigged.recorded.disposers.splice(0)) dispose();
    dom.cleanup();
    unfix();
  };
  return { ...rigged, dom, stop };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('has the shape the runtime loads', () => assertPluginShape(assert, plugin));

test('declares where it talks, and the panel draws that address', () => {
  const manifest = JSON.parse(readFileSync(path.join(FOLDER, 'mod.json'), 'utf8'));
  assert.deepEqual(manifest.network, { settings: ['apiUrl'] });
  assert.equal(manifest.settings.find((field) => field.key === 'apiUrl').type, 'text');
  assert.equal(manifest.settings.some((field) => /password|token/i.test(field.key)), false,
    'a password is not a setting');
});

test('puts its bar in the top bar, and asks to sign in when nobody has', async () => {
  const { recorded, stop } = await startPlugin();
  try {
    const bar = document.getElementById('betterslack-quelio');
    assert.ok(bar, 'mounted');
    assert.ok(bar.closest('.p-ia4_top_nav__right_container'), 'in the top bar');
    assert.ok(bar.previousElementSibling.matches('.p-ia4_top_nav__right_container--start'),
      'after Slack\'s own first item, which stays where Slack put it');
    assert.ok(bar.nextElementSibling.matches('.display_flex.align_items_center'), 'and before its buttons');
    assert.equal(bar.dataset.phase, 'signedOut');
    assert.match(bar.textContent, /Se connecter/);
    assert.equal(recorded.requests.length, 0, 'nothing is asked of a server before signing in');
    assert.ok(recorded.css.some((css) => css.includes('#betterslack-quelio')), 'its stylesheet is in');
  } finally {
    stop();
  }
});

test('stays out of a top bar holding a coachmark, which freezes Slack', async () => {
  const dom = installDom(`
    <div class="p-ia4_top_nav" data-qa="top-nav">
      <div class="p-ia4_top_nav__right_container">
        <div class="c-coachmark-anchor"></div>
        <div class="align_items_center display_flex"></div>
      </div>
    </div>${SLACK_FIXTURE}`);
  const { api, recorded } = createTestApi({ settings: { apiUrl: ADDRESS }, files: FILES });
  try {
    await plugin.start(api);
    assert.equal(document.getElementById('betterslack-quelio'), null);
  } finally {
    for (const dispose of recorded.disposers.splice(0)) dispose();
    dom.cleanup();
  }
});

test('signs in through its own form and leaves no password behind', async () => {
  const { recorded, store, stop } = await startPlugin();
  try {
    document.getElementById('betterslack-quelio').click();
    const modal = recorded.modals.at(-1);
    assert.ok(modal, 'a sign-in dialog');
    const form = modal.body.querySelector('form');
    form.querySelector('[name="username"]').value = 'robin';
    const password = form.querySelector('[name="password"]');
    password.value = PASSWORD;
    form.dispatchEvent(new window.Event('submit', { cancelable: true }));
    assert.equal(password.value, '', 'out of the field before the request leaves');
    await settle();
    await settle();

    assert.equal(modal.closed, true);
    assert.ok(recorded.toasts.some((toast) => toast.variant === 'success'));
    assert.equal(keptFile(recorded, 'session.json').token, 'tok-1');
    assert.equal(document.getElementById('betterslack-quelio').dataset.phase, 'ready');
    assert.ok(!document.documentElement.outerHTML.includes(PASSWORD), 'not in the page');
    assert.ok(!everything(store, recorded).includes(PASSWORD), 'not in anything kept');
    assert.ok(!JSON.stringify(recorded.logs).includes(PASSWORD), 'not in the logs');
  } finally {
    stop();
  }
});

test('a refused password is said in the form, and the field is emptied', async () => {
  const { recorded, store, stop } = await startPlugin();
  try {
    document.getElementById('betterslack-quelio').click();
    const form = recorded.modals.at(-1).body.querySelector('form');
    form.querySelector('[name="username"]').value = 'robin';
    form.querySelector('[name="password"]').value = 'wrong';
    form.dispatchEvent(new window.Event('submit', { cancelable: true }));
    await settle();
    await settle();
    assert.match(form.querySelector('[role="alert"]').textContent, /refusé.*4 essais/s);
    assert.equal(form.querySelector('[name="password"]').value, '');
    assert.equal(keptFile(recorded, 'session.json'), null);
    assert.ok(!everything(store, recorded).includes('wrong'));
  } finally {
    stop();
  }
});

test('sends Quelio nothing but the sign-in, and only to its address', async () => {
  const { recorded, stop } = await startPlugin({ kept: { 'session.json': SESSION } });
  try {
    await settle();
    await settle();
    assert.ok(recorded.requests.length >= 1, 'a session with nothing read asks at once');
    for (const request of recorded.requests) {
      assert.equal(request.url, ADDRESS);
      assert.deepEqual(Object.keys(request.form).sort(), ['action', 'token', 'username']);
      assert.ok(!JSON.stringify(request).match(/T0EXAMPLE|C0BFQ|U0EXAMPLE|xox/), 'nothing of Slack\'s');
    }
  } finally {
    stop();
  }
});

test('opens its details on a click, and signing out from them asks to sign in again', async () => {
  const { recorded, stop } = await startPlugin({ kept: { 'session.json': SESSION } });
  try {
    await settle();
    await settle();
    const bar = document.getElementById('betterslack-quelio');
    bar.click();
    const details = document.getElementById('betterslack-quelio-details');
    assert.ok(details, 'the details are open');
    assert.equal(bar.getAttribute('aria-expanded'), 'true');
    assert.match(details.textContent, /Cette semaine/);
    assert.match(details.textContent, /robin/);

    details.querySelector('[data-action="sign-out"]').click();
    await settle();
    assert.equal(document.getElementById('betterslack-quelio-details'), null);
    assert.equal(keptFile(recorded, 'session.json'), null);
    assert.equal(bar.dataset.phase, 'signedOut');
    assert.ok(recorded.toasts.length > 0);
  } finally {
    stop();
  }
});

test('an afternoon can be marked off from the details, on a day already worked', async () => {
  const { store, stop } = await startPlugin({ kept: { 'session.json': SESSION } });
  try {
    await settle();
    await settle();
    document.getElementById('betterslack-quelio').click();
    const details = document.getElementById('betterslack-quelio-details');
    const monday = details.querySelector('[data-action="half-0"]');
    assert.ok(monday, 'offered on Monday, which has badges');
    monday.click();
    assert.deepEqual(store.daysOff.afternoons, [0]);
    assert.match(document.getElementById('betterslack-quelio-details').textContent, /après-midi de congé/);
  } finally {
    stop();
  }
});

test('a rule that cannot be read is said in the log, and the bar still draws', async () => {
  const { recorded, stop } = await startPlugin({ settings: { apiUrl: ADDRESS, countTo: '18h30' } });
  try {
    assert.ok(recorded.logs.some(([level, text]) => level === 'warn' && /countTo/.test(text)));
    assert.ok(document.getElementById('betterslack-quelio'));
  } finally {
    stop();
  }
});

test('switching it off stops its clocks and takes its details down', async () => {
  const { recorded, stop } = await startPlugin({ kept: { 'session.json': SESSION } });
  await settle();
  document.getElementById('betterslack-quelio').click();
  assert.ok(document.getElementById('betterslack-quelio-details'));
  const asked = recorded.requests.length;
  for (const dispose of recorded.disposers.splice(0)) dispose();
  assert.equal(document.getElementById('betterslack-quelio-details'), null);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(recorded.requests.length, asked, 'nothing more is asked once it is off');
  stop();
});
