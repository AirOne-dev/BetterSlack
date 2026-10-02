// Numbers and times, in the reader's words.

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function createFormat(t, locale) {
  const clock = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
  const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
  return {
    /** "just now", "5 min ago", "3 h ago", "2 d ago", then the date. */
    ago(iso, now = Date.now()) {
      const then = typeof iso === 'number' ? iso : Date.parse(iso);
      if (!Number.isFinite(then)) return '';
      const age = Math.max(0, now - then);
      if (age < MINUTE) return t('justNow');
      if (age < HOUR) return t('minutesAgo', { count: Math.floor(age / MINUTE) });
      if (age < DAY) return t('hoursAgo', { count: Math.floor(age / HOUR) });
      if (age < 14 * DAY) return t('daysAgo', { count: Math.floor(age / DAY) });
      return date.format(new Date(then));
    },
    /** The time of day, for "updated at". */
    clock: (ms) => clock.format(new Date(ms)),
    /** A job's length: "42s", "3m 05s". */
    duration(seconds) {
      if (!Number.isFinite(seconds)) return '';
      if (seconds < 60) return t('seconds', { s: seconds });
      return t('minutesSeconds', { m: Math.floor(seconds / 60), s: String(seconds % 60).padStart(2, '0') });
    },
    count: (n) => t(n === 1 ? 'mrCount_one' : 'mrCount_many', { count: n }),
  };
}
