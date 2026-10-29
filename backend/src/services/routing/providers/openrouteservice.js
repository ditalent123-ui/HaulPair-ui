import { NoRouteError, UpstreamError } from '../../../utils/errors.js';

/**
 * openrouteservice adapter using the "driving-hgv" (heavy goods vehicle) profile.
 *
 * Vehicle restrictions are passed as options.profile_params.restrictions and
 * evaluated against OpenStreetMap tags (maxheight, maxweight, maxwidth,
 * maxlength, maxaxleload, hgv=no, ...). Their quality therefore depends on the
 * completeness of OSM tagging; they are not an official road-authority permit check.
 *
 * API reference: https://openrouteservice.org/dev/#/api-docs/v2/directions/{profile}/geojson/post
 * Requires an API key (https://openrouteservice.org/dev/#/signup). The key is
 * only ever used here on the server.
 */
export function createOpenRouteServiceProvider({ baseUrl, apiKey, requestJson }) {
  const profile = 'driving-hgv';

  return {
    name: 'openrouteservice',
    displayName: 'openrouteservice',
    profile,
    profileDescription: 'heavy goods vehicle (HGV)',
    supportsTruckRestrictions: true,
    attribution: 'Routing © openrouteservice.org by HeiGIT, data © OpenStreetMap contributors (ODbL)',

    async route({ origin, destination, vehicle }) {
      const url = new URL(`/v2/directions/${profile}/geojson`, baseUrl);
      const body = {
        coordinates: [
          [origin.lon, origin.lat],
          [destination.lon, destination.lat],
        ],
        instructions: false,
        units: 'm',
        options: buildOrsOptions(vehicle),
      };
      const { status, body: res } = await requestJson(url, {
        method: 'POST',
        headers: { Authorization: apiKey },
        body,
        providerName: 'openrouteservice routing',
      });
      return parseOrsResponse(status, res);
    },
  };
}

/** Map our vehicle model (metres, tonnes) to ORS restriction parameters. */
export function buildOrsOptions(vehicle = {}) {
  const restrictions = {};
  if (vehicle.heightM) restrictions.height = vehicle.heightM;
  if (vehicle.widthM) restrictions.width = vehicle.widthM;
  if (vehicle.lengthM) restrictions.length = vehicle.lengthM;
  if (vehicle.grossWeightT) restrictions.weight = vehicle.grossWeightT;
  if (vehicle.axleLoadT) restrictions.axleload = vehicle.axleLoadT;
  const options = { vehicle_type: 'hgv' };
  if (Object.keys(restrictions).length > 0) options.profile_params = { restrictions };
  return options;
}

export function parseOrsResponse(status, body) {
  // ORS error codes: 2004 = route distance exceeds limit, 2009/2010 = no route / point not found.
  const orsCode = body?.error?.code;
  if (status === 404 || orsCode === 2009 || orsCode === 2010) {
    throw new NoRouteError(
      orsCode === 2010
        ? 'One of the locations could not be matched to a road usable by heavy goods vehicles.'
        : 'No route usable by heavy goods vehicles with these restrictions was found.',
    );
  }
  if (status === 401 || status === 403) {
    throw new UpstreamError('openrouteservice rejected the API key. Check ORS_API_KEY on the server.', {
      status: 502,
      code: 'UPSTREAM_AUTH',
    });
  }
  if (status === 429) {
    throw new UpstreamError('The openrouteservice quota or rate limit was reached. Try again later.', {
      status: 503,
      code: 'UPSTREAM_RATE_LIMITED',
    });
  }
  if (status < 200 || status >= 300) {
    const message = typeof body?.error?.message === 'string' ? body.error.message : `HTTP ${status}`;
    throw new UpstreamError(`openrouteservice returned an error: ${message}`);
  }
  const feature = body?.features?.[0];
  const summary = feature?.properties?.summary;
  const coordinates = feature?.geometry?.coordinates;
  if (!summary || !Number.isFinite(summary.distance) || !Array.isArray(coordinates) || coordinates.length < 2) {
    throw new UpstreamError('openrouteservice returned an incomplete route.');
  }
  return {
    distanceM: summary.distance,
    durationS: Number.isFinite(summary.duration) ? summary.duration : null,
    coordinates,
  };
}
