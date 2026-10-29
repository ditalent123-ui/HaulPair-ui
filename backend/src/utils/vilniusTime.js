/** Small Europe/Vilnius calendar helpers (Lithuania observes EET/EEST). */

export const TZ = 'Europe/Vilnius';

/** YYYY-MM-DD of `ms` in Vilnius. */
export function vilniusDate(ms = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

/** UTC offset in minutes of Vilnius at the given UTC instant. */
function offsetMinutesAt(ms) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'shortOffset' })
    .formatToParts(new Date(ms))
    .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+2';
  const m = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return 120;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

/** UTC epoch ms of a Vilnius wall-clock time (date YYYY-MM-DD, hour 0-23). */
export function vilniusWallTimeToUtc(date, hour, minute = 0) {
  const guess = Date.parse(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`);
  const offset = offsetMinutesAt(guess - 120 * 60_000);
  return guess - offset * 60_000;
}

export function addDays(date, days) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
