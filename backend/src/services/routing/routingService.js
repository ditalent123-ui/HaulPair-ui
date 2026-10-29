import { TtlCache } from '../../utils/ttlCache.js';
import { signRouteToken } from '../../utils/routeToken.js';
import { createOsrmProvider } from './providers/osrm.js';
import { createOpenRouteServiceProvider } from './providers/openrouteservice.js';

/**
 * Provider-agnostic routing service.
 *
 * Each provider adapter implements:
 *   { name, displayName, profile, profileDescription, supportsTruckRestrictions,
 *     attribution, route({ origin, destination, vehicle }) -> { distanceM, durationS, coordinates } }
 * where coordinates are GeoJSON [lon, lat] pairs. Adding HERE, TomTom or a
 * self-hosted engine means adding one adapter file and one case below.
 */
export function createRoutingProvider(routingConfig, requestJson) {
  switch (routingConfig.provider) {
    case 'osrm':
      return createOsrmProvider({ baseUrl: routingConfig.osrmBaseUrl, requestJson });
    case 'openrouteservice':
      return createOpenRouteServiceProvider({
        baseUrl: routingConfig.orsBaseUrl,
        apiKey: routingConfig.orsApiKey,
        requestJson,
      });
    default:
      throw new Error(`Unknown routing provider: ${routingConfig.provider}`);
  }
}

const VEHICLE_KEYS = ['heightM', 'widthM', 'lengthM', 'grossWeightT', 'axleLoadT'];

function pickVehicle(vehicle) {
  const out = {};
  for (const key of VEHICLE_KEYS) {
    if (typeof vehicle?.[key] === 'number' && vehicle[key] > 0) out[key] = vehicle[key];
  }
  return out;
}

/** Round to 5 decimals (~1 m) to keep payloads small, and convert to Leaflet's [lat, lon] order. */
function toLatLngs(coordinates) {
  return coordinates.map(([lon, lat]) => [Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5]);
}

function bboxOf(latLngs) {
  let minLat = Infinity;
  let minLon = Infinity;
  let maxLat = -Infinity;
  let maxLon = -Infinity;
  for (const [lat, lon] of latLngs) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }
  return [minLat, minLon, maxLat, maxLon];
}

function leg(raw) {
  const geometry = toLatLngs(raw.coordinates);
  return {
    distanceKm: raw.distanceM / 1000,
    durationS: raw.durationS,
    geometry,
    bbox: bboxOf(geometry),
  };
}

export function createRoutingService({ provider, tokenSecret, tokenTtlS, cacheTtlMs = 15 * 60_000 }) {
  const cache = new TtlCache({ ttlMs: cacheTtlMs, maxEntries: 300 });

  async function fetchLeg(origin, destination, vehicle) {
    const key = [
      provider.name,
      provider.profile,
      origin.lat.toFixed(5),
      origin.lon.toFixed(5),
      destination.lat.toFixed(5),
      destination.lon.toFixed(5),
      provider.supportsTruckRestrictions ? JSON.stringify(vehicle) : '',
    ].join('|');
    const cached = cache.get(key);
    if (cached) return { ...cached, cached: true };
    const result = await provider.route({ origin, destination, vehicle });
    cache.set(key, result);
    return { ...result, cached: false };
  }

  function describe() {
    return {
      name: provider.name,
      displayName: provider.displayName,
      profile: provider.profile,
      profileDescription: provider.profileDescription,
      supportsTruckRestrictions: provider.supportsTruckRestrictions,
      attribution: provider.attribution,
    };
  }

  async function getRoute({ origin, destination, includeReturn = false, vehicle }) {
    const requestedVehicle = pickVehicle(vehicle);
    const appliedVehicle = provider.supportsTruckRestrictions ? requestedVehicle : {};
    const warnings = [];

    if (provider.supportsTruckRestrictions) {
      warnings.push(
        'Truck (HGV) routing: restrictions are evaluated against OpenStreetMap tagging, which can be incomplete. Verify bridges, weight limits and local bans against official sources before dispatch.',
      );
      if (Object.keys(appliedVehicle).length === 0) {
        warnings.push('No vehicle dimensions or weights were supplied, so only general HGV access rules were applied.');
      }
    } else {
      warnings.push(
        `Car routing profile (${provider.displayName}). This route is NOT checked against truck height, weight, width, length or HGV access restrictions, and the driving time is a car estimate — heavy trucks are usually slower. Do not use it as a truck-compliant route.`,
      );
      if (Object.keys(requestedVehicle).length > 0) {
        warnings.push('Vehicle dimensions were ignored because the configured routing provider cannot apply them.');
      }
    }

    const outboundRaw = await fetchLeg(origin, destination, appliedVehicle);
    const returnRaw = includeReturn ? await fetchLeg(destination, origin, appliedVehicle) : null;

    const outbound = leg(outboundRaw);
    const ret = returnRaw ? leg(returnRaw) : null;

    const tokenPayload = {
      provider: provider.name,
      profile: provider.profile,
      truckRestrictionsApplied: provider.supportsTruckRestrictions,
      vehicle: appliedVehicle,
      origin,
      destination,
      outbound: { distanceKm: outbound.distanceKm, durationS: outbound.durationS },
      return: ret ? { distanceKm: ret.distanceKm, durationS: ret.durationS } : null,
    };
    const { token, expiresAt } = signRouteToken(tokenPayload, tokenSecret, { ttlS: tokenTtlS });

    return {
      provider: describe(),
      truckRestrictionsApplied: provider.supportsTruckRestrictions,
      vehicleRestrictions: appliedVehicle,
      origin,
      destination,
      outbound,
      return: ret,
      warnings,
      cached: outboundRaw.cached && (returnRaw ? returnRaw.cached : true),
      routeToken: token,
      routeTokenExpiresAt: expiresAt,
    };
  }

  return { getRoute, describe };
}
