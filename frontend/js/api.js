/**
 * Backend API client. All requests go to the same origin; provider keys never reach the browser.
 */

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'NETWORK_ERROR', details = [], requestId = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details ?? [];
    this.requestId = requestId;
  }
}

export async function request(method, path, { body, signal, headers = {} } = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        // Same-origin marker used by the server's CSRF guard for state-changing requests.
        'X-Requested-With': 'XMLHttpRequest',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('Network error', { code: 'NETWORK_ERROR' });
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const e = payload?.error ?? {};
    throw new ApiError(e.message ?? `HTTP ${response.status}`, {
      status: response.status,
      code: e.code ?? 'HTTP_ERROR',
      details: e.details,
      requestId: e.requestId,
    });
  }
  return payload;
}

export const api = {
  health: () => request('GET', '/health'),
  config: () => request('GET', '/config').then((r) => r.data),
  trucks: () => request('GET', '/trucks').then((r) => r.data),
  cargoTypes: () => request('GET', '/cargo-types').then((r) => r.data),
  geocode: (q, { signal } = {}) => request('GET', `/geocode?q=${encodeURIComponent(q)}&limit=6`, { signal }).then((r) => r.data),
  route: (body) => request('POST', '/routes', { body }).then((r) => r.data),
  estimate: (body) => request('POST', '/calculations/estimate', { body }).then((r) => r.data),
  saveCalculation: (body) => request('POST', '/calculations', { body }).then((r) => r.data),
  listCalculations: ({ limit = 10, offset = 0 } = {}) => request('GET', `/calculations?limit=${limit}&offset=${offset}`),
  getCalculation: (id) => request('GET', `/calculations/${encodeURIComponent(id)}`).then((r) => r.data),
  deleteCalculation: (id) => request('DELETE', `/calculations/${encodeURIComponent(id)}`).then((r) => r.data),
  activity: (limit = 30) => request('GET', `/activity?limit=${limit}`).then((r) => r.data),
  parseShipment: (text, { signal } = {}) => request('POST', '/ai/parse-shipment', { body: { text }, signal }).then((r) => r.data),
  fuelPrice: (fuelType) => request('GET', `/fuel-price?fuelType=${encodeURIComponent(fuelType)}`).then((r) => r.data),
};
