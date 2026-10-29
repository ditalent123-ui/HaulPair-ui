import { h } from '../dom.js';
import { createIcon } from '../icons.js';

/**
 * Month calendar for choosing a pickup day. Past days and days beyond maxDate
 * are disabled. Dates are plain YYYY-MM-DD strings (Vilnius calendar days).
 */
const DOW = ['Pr', 'An', 'Tr', 'Kt', 'Pn', 'Št', 'Sk'];

function addDays(date, n) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function createCalendar({ container, minDate, maxDate, value = null, onChange }) {
  let selected = value;
  let month = (value ?? minDate).slice(0, 7); // YYYY-MM

  function render() {
    const first = `${month}-01`;
    const firstDow = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
    const monthName = new Intl.DateTimeFormat('lt-LT', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${first}T12:00:00Z`));
    const prevMonth = addDays(first, -1).slice(0, 7);
    const nextMonth = addDays(first, 31).slice(0, 7); // day 1 + 31 days always lands in the next month

    const prev = h('button', { type: 'button', class: 'hp-cal-nav', 'aria-label': 'Ankstesnis mėnuo', disabled: prevMonth < minDate.slice(0, 7) }, createIcon('back', { size: 20 }));
    const next = h('button', { type: 'button', class: 'hp-cal-nav', 'aria-label': 'Kitas mėnuo', disabled: nextMonth > maxDate.slice(0, 7) }, createIcon('back', { size: 20, className: 'hp-flip' }));
    prev.addEventListener('click', () => { month = prevMonth; render(); });
    next.addEventListener('click', () => { month = nextMonth; render(); });

    const grid = h('div', { class: 'hp-cal-grid', role: 'group', 'aria-label': monthName });
    DOW.forEach((d) => grid.append(h('div', { class: 'hp-cal-dow', 'aria-hidden': 'true' }, d)));
    for (let i = 0; i < firstDow; i += 1) grid.append(h('div', { 'aria-hidden': 'true' }));
    for (let day = first; day.slice(0, 7) === month; day = addDays(day, 1)) {
      const disabled = day < minDate || day > maxDate;
      const label = new Intl.DateTimeFormat('lt-LT', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(`${day}T12:00:00Z`));
      const btn = h(
        'button',
        { type: 'button', class: `hp-cal-day${day === minDate ? ' is-today' : ''}`, 'aria-pressed': String(day === selected), 'aria-label': label, disabled, dataset: { date: day } },
        String(Number(day.slice(8))),
      );
      btn.addEventListener('click', () => {
        selected = day;
        render();
        onChange(day);
      });
      grid.append(btn);
    }
    container.replaceChildren(h('div', { class: 'hp-cal-head' }, prev, h('span', { class: 'hp-cal-month', 'aria-live': 'polite' }, monthName), next), grid);
  }

  render();
  return { get value() { return selected; } };
}
