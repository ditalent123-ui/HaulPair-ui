import { UpstreamError } from '../../../utils/errors.js';

/**
 * openrouteservice geocoding (Pelias-based) autocomplete endpoint.
 * Uses the same server-side ORS_API_KEY as routing and counts against the ORS geocoding quota.
 *
 * API reference: https://openrouteservice.org/dev/#/api-docs/geocode/autocomplete/get
 */
export function createOrsGeocodingProvider({ baseUrl, apiKey, requestJson }) {
  return {
    name: 'openrouteservice',
    supportsAutocomplete: true,
    attribution: 'Search © openrouteservice.org by HeiGIT, data © OpenStreetMap contributors and others',

    async search({ query, limit, bias }) {
      const url = new URL('/geocode/autocomplete', baseUrl);
      url.searchParams.set('text', query);
      url.searchParams.set('size', String(limit));
      url.searchParams.set('layers', 'locality,localadmin,county,region,venue,address,street,neighbourhood');
      if (bias) {
        url.searchParams.set('focus.point.lat', String(bias.lat));
        url.searchParams.set('focus.point.lon', String(bias.lon));
      }
      const { status, body } = await requestJson(url, {
        headers: { Authorization: apiKey },
        providerName: 'openrouteservice geocoding',
      });
      return parseOrsGeocodeResponse(status, body);
    },
  };
}

export function parseOrsGeocodeResponse(status, body) {
  if (status === 401 || status === 403) {
    throw new UpstreamError('openrouteservice rejected the API key. Check ORS_API_KEY on the server.', {
      code: 'UPSTREAM_AUTH',
    });
  }
  if (status === 429) {
    throw new UpstreamError('The openrouteservice geocoding quota or rate limit was reached.', {
      status: 503,
      code: 'UPSTREAM_RATE_LIMITED',
    });
  }
  if (status < 200 || status >= 300 || !Array.isArray(body?.features)) {
    throw new UpstreamError(`openrouteservice geocoding returned an error (HTTP ${status}).`);
  }
  return body.features
    .filter((f) => Array.isArray(f?.geometry?.coordinates) && f.geometry.coordinates.length === 2)
    .map((f) => {
      const p = f.properties ?? {};
      const [lon, lat] = f.geometry.coordinates;
      return {
        label: p.label ?? p.name ?? 'Unnamed place',
        name: p.name ?? p.label ?? 'Unnamed place',
        countryCode: typeof p.country_a === 'string' ? p.country_a.toUpperCase() : null,
        type: p.layer ?? null,
        lat,
        lon,
      };
    });
}
