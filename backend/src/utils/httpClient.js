import { UpstreamError } from './errors.js';

/**
 * Thin fetch wrapper for calls to external providers: timeout, identifying
 * User-Agent (required by OSM-community services) and JSON parsing.
 *
 * Returns { status, body } and leaves status interpretation to the provider
 * adapter, because each provider encodes errors differently.
 */
export function createHttpClient({ userAgent, timeoutMs, fetchImpl = globalThis.fetch }) {
  return async function requestJson(url, { method = 'GET', headers = {}, body, providerName = 'provider' } = {}) {
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: {
          Accept: 'application/json',
          'User-Agent': userAgent,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      throw new UpstreamError(
        timedOut
          ? `The ${providerName} service did not respond within ${Math.round(timeoutMs / 1000)} s.`
          : `The ${providerName} service could not be reached.`,
        { status: timedOut ? 504 : 502, code: timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNREACHABLE', cause: err },
      );
    }

    const text = await response.text();
    let parsed = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    return { status: response.status, ok: response.ok, body: parsed };
  };
}
