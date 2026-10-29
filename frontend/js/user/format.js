/** Lithuanian number/date formatting helpers. */
const TZ = 'Europe/Vilnius';

export const eur = (n, digits = 0) =>
  new Intl.NumberFormat('lt-LT', { style: 'currency', currency: 'EUR', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
export const num = (n, digits = 0) => new Intl.NumberFormat('lt-LT', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);

export function todayVilnius(ms = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}
export function hourVilnius(ms = Date.now()) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(new Date(ms)));
}
export function longDate(isoDate) {
  return new Intl.DateTimeFormat('lt-LT', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(`${isoDate}T12:00:00Z`));
}
export function shortDateTime(iso) {
  return new Intl.DateTimeFormat('lt-LT', { timeZone: TZ, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

/** "prieš 2 val.", "prieš 3 d." */
export function ago(iso, now = Date.now()) {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 90) return 'ką tik';
  if (s < 3600) return `prieš ${Math.round(s / 60)} min.`;
  if (s < 86400 * 2) return `prieš ${Math.round(s / 3600)} val.`;
  return `prieš ${Math.round(s / 86400)} d.`;
}

/** Countdown text: "2 val. 05 min.", "7 min. 12 s", "31 d. 4 val." */
export function countdown(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d} d. ${h} val.`;
  if (h > 0) return `${h} val. ${String(m).padStart(2, '0')} min.`;
  if (m > 0) return `${m} min. ${String(sec).padStart(2, '0')} s`;
  return `${sec} s`;
}
