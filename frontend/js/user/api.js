import { request } from '../api.js';

export { ApiError } from '../api.js';

/** End-user API (same origin; no keys or technical data reach the browser). */
export const api = {
  options: () => request('GET', '/booking/options').then((r) => r.data),
  places: (q, { signal } = {}) => request('GET', `/places?q=${encodeURIComponent(q)}`, { signal }).then((r) => r.data),
  quote: (body) => request('POST', '/quote', { body }).then((r) => r.data),
  createOrder: (body) => request('POST', '/orders', { body }).then((r) => r.data),
  prices: () => request('GET', '/prices').then((r) => r.data),
  planner: (body) => request('POST', '/planner/compare', { body }).then((r) => r.data),
  exchange: () => request('GET', '/exchange').then((r) => r.data),
};
