import { NoRouteError, UpstreamError } from '../../../utils/errors.js';

/**
 * OSRM adapter (HTTP API v5, /route/v1/{profile}/...).
 *
 * The public demo server (router.project-osrm.org) only exposes the "driving"
 * (car) profile and is intended for light, non-production use. It does NOT
 * model truck height, weight, width or length restrictions. A self-hosted OSRM
 * with a custom truck .lua profile is possible, but OSM truck-restriction
 * tagging would still need to be validated.
 *
 * API reference: https://project-osrm.org/docs/v5.24.0/api/#route-service
 */
export function createOsrmProvider({ baseUrl, requestJson }) {
  const profile = 'driving';

  return {
    name: 'osrm',
    displayName: 'OSRM (public demo server)',
    profile,
    profileDescription: 'car',
    supportsTruckRestrictions: false,
    attribution: 'Routing © OSRM, data © OpenStreetMap contributors (ODbL)',

    async route({ origin, destination }) {
      const coords = `${origin.lon},${origin.lat};${destination.lon},${destination.lat}`;
      const url = new URL(`/route/v1/${profile}/${coords}`, baseUrl);
      url.searchParams.set('overview', 'simplified');
      url.searchParams.set('geometries', 'geojson');
      url.searchParams.set('alternatives', 'false');
      url.searchParams.set('steps', 'false');

      const { status, body } = await requestJson(url, { providerName: 'OSRM routing' });
      return parseOsrmResponse(status, body);
    },
  };
}

export function parseOsrmResponse(status, body) {
  if (body?.code === 'NoRoute' || body?.code === 'NoSegment') {
    throw new NoRouteError(
      body.code === 'NoSegment'
        ? 'One of the locations is too far from any road known to the routing service.'
        : undefined,
    );
  }
  if (status === 429) {
    throw new UpstreamError('The OSRM demo server is rate-limiting requests. Wait a moment and try again.', {
      status: 503,
      code: 'UPSTREAM_RATE_LIMITED',
    });
  }
  if (status < 200 || status >= 300 || body?.code !== 'Ok') {
    throw new UpstreamError(`The OSRM routing service returned an error (${body?.code ?? `HTTP ${status}`}).`);
  }
  const route = body.routes?.[0];
  const coordinates = route?.geometry?.coordinates;
  if (!route || !Number.isFinite(route.distance) || !Array.isArray(coordinates) || coordinates.length < 2) {
    throw new UpstreamError('The OSRM routing service returned an incomplete route.');
  }
  return {
    distanceM: route.distance,
    durationS: Number.isFinite(route.duration) ? route.duration : null,
    coordinates,
  };
}
