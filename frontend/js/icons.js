/**
 * One consistent outline icon set (single stroke weight, currentColor).
 * No emoji, no mixed styles. Paths are drawn on a 24×24 grid.
 */
const SVG_NS = 'http://www.w3.org/2000/svg';

const PATHS = {
  route: '<path d="M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm0 0h7a3 3 0 0 0 3-3V9m0 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/>',
  pin: '<path d="M12 21s7-6.3 7-11a7 7 0 0 0-14 0c0 4.7 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/>',
  swap: '<path d="M7 7h11m0 0-3-3m3 3-3 3M17 17H6m0 0 3-3m-3 3 3 3"/>',
  cargo: '<path d="M12 3 4 7v10l8 4 8-4V7l-8-4Z"/><path d="M4 7l8 4 8-4M12 11v10"/>',
  truck: '<path d="M3 6h11v9H3zM14 9h4l3 3v3h-7zM7 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm10 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/>',
  fuel: '<path d="M5 20V5a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v15M4 20h12M14 9h2.5A1.5 1.5 0 0 1 18 10.5V16a2 2 0 0 0 2 2 2 2 0 0 0 2-2V8l-3-3"/>',
  costs: '<path d="M12 3v18M8 7h5a2.5 2.5 0 0 1 0 5H9a2.5 2.5 0 0 0 0 5h6"/>',
  calculate: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h2m3 0h3M8 15h2m3 0h3"/>',
  save: '<path d="M6 4h10l4 4v12H6zM8 4v5h7V4M8 20v-6h8v6"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4M12 8v4l3 2"/>',
  activity: '<path d="M4 12h3l2 6 4-14 2 8h5"/>',
  delete: '<path d="M5 7h14M9 7V5h6v2m-1 0v12H10V7M10 11v6m4-6v6"/>',
  chevron: '<path d="m7 10 5 5 5-5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  map: '<path d="m9 4 6 2 6-2v14l-6 2-6-2-6 2V6l6-2Zm0 0v14m6-12v14"/>',
  sparkle: '<path d="M12 3l1.8 4.9L19 10l-5.2 2.1L12 17l-1.8-4.9L5 10l5.2-2.1L12 3Z"/>',
  check: '<path d="m5 13 4 4 10-11"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4ZM14 6l4 4"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  warning: '<path d="M12 4 3 20h18L12 4Z"/><path d="M12 10v5M12 18h.01"/>',
  plus: '<path d="M12 6v12M6 12h12"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  logout: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4m6-4v4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  building: '<path d="M5 21V5l7-2v18M12 8h7v13M8 8h1m-1 4h1m-1 4h1m6-4h1m-1 4h1M3 21h18"/>',
  message: '<path d="M5 5h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4 3V6a1 1 0 0 1 1-1Z"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
  exchange: '<path d="M4 8h13l-3-3m6 11H7l3 3"/>',
  chart: '<path d="M4 20V4m0 16h16M8 16l3-4 3 2 5-7"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
};

export function createIcon(name, { size = 18, className = '' } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `icon ${className}`.trim());
  svg.innerHTML = PATHS[name] ?? PATHS.info;
  return svg;
}

export const ICON_NAMES = Object.keys(PATHS);
