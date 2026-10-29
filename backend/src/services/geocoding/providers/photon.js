import { UpstreamError } from '../../../utils/errors.js';

/**
 * Photon geocoder (komoot). Designed for search-as-you-type over OpenStreetMap data.
 * The public instance (photon.komoot.io) is free for reasonable use only and may
 * throttle or ban heavy users; production deployments should self-host Photon
 * or use a commercial geocoder.
 *
 * API reference: https://github.com/komoot/photon#search-api
 */
export function createPhotonProvider({ baseUrl, requestJson }) {
  return {
    name: 'photon',
    supportsAutocomplete: true,
    attribution: 'Search © Photon by komoot, data © OpenStreetMap contributors (ODbL)',

    async search({ query, limit, bias }) {
      const url = new URL('/api/', baseUrl);
      url.searchParams.set('q', query);
      url.searchParams.set('limit', String(limit));
      // Photon has no Lithuanian UI language; "default" returns local names (e.g. "Klaipėda").
      url.searchParams.set('lang', 'default');
      if (bias) {
        url.searchParams.set('lat', String(bias.lat));
        url.searchParams.set('lon', String(bias.lon));
      }
      const { status, body } = await requestJson(url, { providerName: 'Photon geocoding' });
      return parsePhotonResponse(status, body);
    },
  };
}

export function parsePhotonResponse(status, body) {
  if (status === 429) {
    throw new UpstreamError('The geocoding service is rate-limiting requests. Slow down and try again.', {
      status: 503,
      code: 'UPSTREAM_RATE_LIMITED',
    });
  }
  if (status < 200 || status >= 300 || !Array.isArray(body?.features)) {
    throw new UpstreamError(`The Photon geocoding service returned an error (HTTP ${status}).`);
  }
  return body.features
    .filter((f) => Array.isArray(f?.geometry?.coordinates) && f.geometry.coordinates.length === 2)
    .map((f) => {
      const p = f.properties ?? {};
      const [lon, lat] = f.geometry.coordinates;
      const primary = p.name ?? p.street ?? p.city ?? 'Unnamed place';
      const context = [p.city && p.city !== primary ? p.city : null, p.county, p.state, p.country]
        .filter(Boolean)
        .filter((v, i, arr) => arr.indexOf(v) === i);
      return {
        label: [primary, ...context].join(', '),
        name: primary,
        countryCode: typeof p.countrycode === 'string' ? p.countrycode.toUpperCase() : null,
        type: p.osm_value ?? p.type ?? null,
        lat,
        lon,
      };
    });
}
