/**
 * Public entry point of the logistics module (cargo catalog, compatibility,
 * fuel, transport cost, savings). Import from here rather than from internal files.
 * No UI, database or navigation-provider dependencies.
 */
export * from './types.js';
export { loadCatalog, validateCatalog, getCargoType, getTractor, getTrailer, CATALOG_DIR } from './catalog.js';
export { checkCompatibility, suggestTrailerCategories } from './cargoCompatibility.js';
export {
  calculateFuelLiters,
  calculateFuelCostEur,
  estimateFuel,
  estimateRouteDeviationFuel,
  resolveConsumption,
  DEFAULT_ESTIMATED_CONSUMPTION_L_PER_100KM,
} from './fuelCalculator.js';
export { normalizeRouteInput, routeInputFromPlannerLeg, ROUTE_DATA_STATUSES } from './routeInput.js';
export { estimateTransportOperatingCost } from './transportCosts.js';
export { calculateSavings, allocateSharedTransport, ALLOCATION_METHODS, DEFAULT_COMMISSION_RATE } from './savingsCalculator.js';
export { localize, localizedName, DEFAULT_LOCALE, SUPPORTED_LOCALES } from './i18n.js';
export { roundEur, toCents, fromCents, allocateCents } from './money.js';
