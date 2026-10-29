import { createValidator } from './types.js';

/**
 * Provider-independent route contract consumed by the cost calculators.
 * Any navigation provider (Sygic, openrouteservice, OSRM, manual entry) maps
 * its response to this shape; calculators never see provider-specific data.
 */

export const ROUTE_DATA_STATUSES = Object.freeze(['provider', 'manual_estimate', 'demo_sample']);
const STOP_TYPES = ['pickup', 'delivery', 'other'];

/**
 * Validate and normalise a RouteInput. Throws LogisticsValidationError.
 * @returns {import('./types.js').RouteInput & { totalDistanceKm: number, totalDurationMinutes: number|null }}
 */
export function normalizeRouteInput(raw) {
  const v = createValidator();
  if (!raw || typeof raw !== 'object') {
    v.add('route', 'required', 'is required');
    v.throwIfInvalid();
  }
  if (typeof raw.routeId !== 'string' || raw.routeId.trim() === '') v.add('route.routeId', 'required', 'is required');
  v.finiteNumber('route.distanceKm', raw.distanceKm, { minExclusive: 0, max: 20_000 });
  v.finiteNumber('route.durationMinutes', raw.durationMinutes, { min: 0, required: false });
  v.finiteNumber('route.additionalDistanceKm', raw.additionalDistanceKm, { min: 0, required: false });
  v.finiteNumber('route.additionalDurationMinutes', raw.additionalDurationMinutes, { min: 0, required: false });
  if (typeof raw.source !== 'string' || raw.source.trim() === '') v.add('route.source', 'required', 'is required');
  if (!ROUTE_DATA_STATUSES.includes(raw.dataStatus)) {
    v.add('route.dataStatus', 'invalid', `must be one of ${ROUTE_DATA_STATUSES.join(', ')}`);
  }
  const stops = Array.isArray(raw.stops) ? raw.stops : [];
  stops.forEach((s, i) => {
    if (!STOP_TYPES.includes(s?.type)) v.add(`route.stops.${i}.type`, 'invalid', `must be one of ${STOP_TYPES.join(', ')}`);
    v.finiteNumber(`route.stops.${i}.durationMinutes`, s?.durationMinutes, { min: 0, required: false });
  });
  v.throwIfInvalid();

  const additionalDistanceKm = raw.additionalDistanceKm ?? 0;
  const additionalDurationMinutes = raw.additionalDurationMinutes ?? 0;
  const durationMinutes = raw.durationMinutes ?? null;
  return {
    routeId: raw.routeId,
    distanceKm: raw.distanceKm,
    durationMinutes,
    additionalDistanceKm,
    additionalDurationMinutes,
    stops: stops.map((s, i) => ({ stopId: s.stopId ?? `stop_${i + 1}`, type: s.type, durationMinutes: s.durationMinutes ?? null })),
    source: raw.source,
    dataStatus: raw.dataStatus,
    totalDistanceKm: raw.distanceKm + additionalDistanceKm,
    totalDurationMinutes: durationMinutes === null ? null : durationMinutes + additionalDurationMinutes,
  };
}

/** Adapter: route leg from this app's routing service (POST /api/routes) → RouteInput. */
export function routeInputFromPlannerLeg(leg, { routeId, providerName }) {
  return normalizeRouteInput({
    routeId,
    distanceKm: leg.distanceKm,
    durationMinutes: leg.durationS === null || leg.durationS === undefined ? null : leg.durationS / 60,
    source: providerName,
    dataStatus: 'provider',
  });
}
