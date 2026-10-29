import { roundEur } from './money.js';
import { createValidator } from './types.js';

/**
 * Deterministic fuel calculations.
 *   Formula A: fuelLiters   = distanceKm × consumptionLPer100Km / 100
 *   Formula B: fuelCostEur  = fuelLiters × fuelPriceEurPerLiter
 * Exact values are returned alongside cent-rounded euro amounts.
 */

/** Demonstration default (l/100 km) for loaded agricultural haulage. Not a measured value. */
export const DEFAULT_ESTIMATED_CONSUMPTION_L_PER_100KM = 30;

const MAX_DISTANCE_KM = 20_000;
const MAX_CONSUMPTION = 100;
const MAX_FUEL_PRICE = 10;

/** Formula A. Distance may be 0 (e.g. no detour); negative values are rejected. */
export function calculateFuelLiters({ distanceKm, consumptionLPer100Km }) {
  const v = createValidator();
  v.finiteNumber('distanceKm', distanceKm, { min: 0, max: MAX_DISTANCE_KM });
  v.finiteNumber('consumptionLPer100Km', consumptionLPer100Km, { minExclusive: 0, max: MAX_CONSUMPTION });
  v.throwIfInvalid();
  return (distanceKm * consumptionLPer100Km) / 100;
}

/** Formula B. */
export function calculateFuelCostEur({ fuelLiters, fuelPriceEurPerLiter }) {
  const v = createValidator();
  v.finiteNumber('fuelLiters', fuelLiters, { min: 0 });
  v.finiteNumber('fuelPriceEurPerLiter', fuelPriceEurPerLiter, { minExclusive: 0, max: MAX_FUEL_PRICE });
  v.throwIfInvalid();
  return fuelLiters * fuelPriceEurPerLiter;
}

/**
 * Fuel use and cost for a distance.
 * @returns {{ distanceKm, consumptionLPer100Km, fuelPriceEurPerLiter, fuelLiters, fuelCostEur, fuelCostEurRounded }}
 */
export function estimateFuel({ distanceKm, consumptionLPer100Km, fuelPriceEurPerLiter }) {
  const v = createValidator();
  v.finiteNumber('distanceKm', distanceKm, { min: 0, max: MAX_DISTANCE_KM });
  v.finiteNumber('consumptionLPer100Km', consumptionLPer100Km, { minExclusive: 0, max: MAX_CONSUMPTION });
  v.finiteNumber('fuelPriceEurPerLiter', fuelPriceEurPerLiter, { minExclusive: 0, max: MAX_FUEL_PRICE });
  v.throwIfInvalid();
  const fuelLiters = calculateFuelLiters({ distanceKm, consumptionLPer100Km });
  const fuelCostEur = calculateFuelCostEur({ fuelLiters, fuelPriceEurPerLiter });
  return {
    distanceKm,
    consumptionLPer100Km,
    fuelPriceEurPerLiter,
    fuelLiters,
    fuelCostEur,
    fuelCostEurRounded: roundEur(fuelCostEur),
  };
}

/** Extra fuel caused by a detour (pickup/delivery deviation). */
export function estimateRouteDeviationFuel({ additionalDistanceKm, consumptionLPer100Km, fuelPriceEurPerLiter }) {
  const r = estimateFuel({ distanceKm: additionalDistanceKm, consumptionLPer100Km, fuelPriceEurPerLiter });
  return { ...r, additionalDistanceKm };
}

/**
 * Choose the consumption figure to calculate with, and say where it came from.
 * Order: explicit user override → model's configured estimate → catalog demo default.
 * The test-cycle reference value is reported for context but never used silently.
 *
 * @param {{ overrideLPer100Km?: number|null, tractor?: object|null, defaultLPer100Km?: number }} p
 * @returns {{ valueLPer100Km: number, source: 'user_override'|'model_estimate'|'demo_assumption', referenceLPer100Km: number|null }}
 */
export function resolveConsumption({ overrideLPer100Km = null, tractor = null, defaultLPer100Km = DEFAULT_ESTIMATED_CONSUMPTION_L_PER_100KM } = {}) {
  const referenceLPer100Km = tractor?.referenceConsumption?.valueLPer100Km ?? null;
  if (overrideLPer100Km !== null && overrideLPer100Km !== undefined) {
    const v = createValidator();
    v.finiteNumber('overrideLPer100Km', overrideLPer100Km, { minExclusive: 0, max: MAX_CONSUMPTION });
    v.throwIfInvalid();
    return { valueLPer100Km: overrideLPer100Km, source: 'user_override', referenceLPer100Km };
  }
  if (typeof tractor?.estimatedConsumptionLPer100Km === 'number') {
    return { valueLPer100Km: tractor.estimatedConsumptionLPer100Km, source: 'model_estimate', referenceLPer100Km };
  }
  return { valueLPer100Km: defaultLPer100Km, source: 'demo_assumption', referenceLPer100Km };
}
