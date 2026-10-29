import { vilniusDate, vilniusWallTimeToUtc } from '../../utils/vilniusTime.js';

/** Pickup time windows (Vilnius local time). 'asap' is only offered for today. */
export const TIME_WINDOWS = Object.freeze([
  { id: 'asap', label: 'Kuo greičiau', todayOnly: true },
  { id: '08-10', label: '08:00–10:00', from: 8, to: 10 },
  { id: '10-12', label: '10:00–12:00', from: 10, to: 12 },
  { id: '12-14', label: '12:00–14:00', from: 12, to: 14 },
  { id: '14-16', label: '14:00–16:00', from: 14, to: 16 },
  { id: '16-18', label: '16:00–18:00', from: 16, to: 18 },
]);

export const MAX_DAYS_AHEAD = 120;

/** Resolve a window on a date to UTC instants, or explain why it is not bookable. */
export function resolveWindow({ date, windowId, now = Date.now() }) {
  const w = TIME_WINDOWS.find((x) => x.id === windowId);
  if (!w) return { error: 'UNKNOWN_WINDOW' };
  const today = vilniusDate(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return { error: 'INVALID_DATE' };
  if (date < today) return { error: 'PAST_DATE' };
  const daysAhead = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;
  if (daysAhead > MAX_DAYS_AHEAD) return { error: 'TOO_FAR_AHEAD' };
  if (w.todayOnly) {
    if (date !== today) return { error: 'ASAP_ONLY_TODAY' };
    return { window: w, startAt: now, endAt: now + 2 * 3_600_000, asap: true };
  }
  const startAt = vilniusWallTimeToUtc(date, w.from);
  const endAt = vilniusWallTimeToUtc(date, w.to);
  if (endAt <= now) return { error: 'WINDOW_PASSED' };
  return { window: w, startAt, endAt, asap: false };
}
