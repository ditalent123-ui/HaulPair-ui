/**
 * Shared enums, JSDoc types and the validation error for the logistics module.
 * The project uses plain JavaScript (ES modules); these JSDoc typedefs give
 * editors type information and document the public contracts.
 *
 * Units are explicit in every field name: Km, Kg, M3, Eur, LPer100Km, Minutes, C.
 */

export const CARGO_CATEGORIES = Object.freeze(['grain_oilseed', 'vegetable', 'other_agricultural']);
export const PACKAGING_TYPES = Object.freeze(['bulk', 'palletized', 'bagged', 'boxed', 'baled', 'other_specialized']);
export const TRAILER_CATEGORIES = Object.freeze(['curtainsider', 'agricultural_tipper', 'refrigerated', 'flatbed']);
export const TEMPERATURE_STATUSES = Object.freeze(['not_required', 'required', 'unknown']);

/** How much a value can be trusted. Ordered from strongest to weakest. */
export const CONFIDENCE_LEVELS = Object.freeze([
  'verified_official_source',
  'official_source_search_extract',
  'third_party_source',
  'user_provided',
  'demo_assumption',
  'unverified_general_knowledge',
  'unknown',
]);

export const COMPATIBILITY_STATUS = Object.freeze({
  COMPATIBLE: 'compatible',
  INCOMPATIBLE: 'incompatible',
  NEEDS_REVIEW: 'needs_review',
});

/**
 * Thrown for invalid inputs to any logistics function. `problems` lists every
 * invalid field so callers (API, UI) can show all errors at once.
 */
export class LogisticsValidationError extends Error {
  /** @param {{ field: string, code: string, message: string }[]} problems */
  constructor(problems) {
    super(problems.map((p) => `${p.field}: ${p.message}`).join('; '));
    this.name = 'LogisticsValidationError';
    this.problems = problems;
  }
}

/** Collects validation problems and throws once at the end. */
export function createValidator() {
  const problems = [];
  const v = {
    problems,
    add(field, code, message) {
      problems.push({ field, code, message });
    },
    finiteNumber(field, value, { min, minExclusive, max, required = true } = {}) {
      if (value === undefined || value === null) {
        if (required) v.add(field, 'required', 'is required');
        return;
      }
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        v.add(field, 'not_a_number', 'must be a finite number');
        return;
      }
      if (minExclusive !== undefined && !(value > minExclusive)) v.add(field, 'too_small', `must be greater than ${minExclusive}`);
      if (min !== undefined && value < min) v.add(field, 'too_small', `must be ${min} or greater`);
      if (max !== undefined && value > max) v.add(field, 'too_large', `must not exceed ${max}`);
    },
    throwIfInvalid() {
      if (problems.length) throw new LogisticsValidationError(problems);
    },
  };
  return v;
}

/**
 * @typedef {{ lt: string, en: string, [locale: string]: string }} LocalizedNames
 *
 * @typedef {object} CargoType
 * @property {string} id                      Stable, language-independent id (e.g. "wheat").
 * @property {LocalizedNames} names
 * @property {'grain_oilseed'|'vegetable'|'other_agricultural'} category
 * @property {{ packaging: string, trailerCategories: string[] }[]} transportOptions
 * @property {{ status: 'not_required'|'required'|'unknown', minC: number|null, maxC: number|null, confidence: string, note?: string }} temperature
 * @property {{ group: string, requiresCleanBody: boolean, notes: string, confidence: string }} hygiene
 * @property {{ minTPerM3: number|null, maxTPerM3: number|null, confidence: string, sources: object[] }|null} bulkDensity
 * @property {string[]} specialConditions
 * @property {{ noBulkMixing: boolean }} compatibilityRestrictions
 * @property {boolean} hazardous
 * @property {string} dataConfidence
 *
 * @typedef {object} TractorModel
 * @property {string} id
 * @property {string} manufacturer
 * @property {string} model
 * @property {'diesel'} fuelType
 * @property {{ valueLPer100Km: number, testId: string, confidence: string }} referenceConsumption
 * @property {number|null} estimatedConsumptionLPer100Km  Null → catalog default demo assumption applies.
 *
 * @typedef {object} Trailer
 * @property {string} id
 * @property {'curtainsider'|'agricultural_tipper'|'refrigerated'|'flatbed'} category
 * @property {number|null} maxPayloadKg
 * @property {number|null} internalVolumeM3
 * @property {{ euroPallets: number|null }|null} palletCapacity
 * @property {boolean} palletsApplicable
 * @property {{ available: boolean, minC: number|null, maxC: number|null }} temperatureControl
 * @property {boolean} undividedBody
 * @property {string[]} supportedPackaging
 * @property {string[]} permittedCargoCategories
 *
 * @typedef {object} Shipment
 * @property {string} shipmentId
 * @property {string} [ownerId]
 * @property {string} cargoTypeId
 * @property {string} packaging                       One of PACKAGING_TYPES.
 * @property {number|null} [weightKg]
 * @property {number|null} [volumeM3]                  Optional; derived from bulk density for bulk cargo if missing.
 * @property {number|null} [palletPositions]           Required for palletized cargo.
 * @property {{ minC: number, maxC: number }|null} [temperatureRequirementC]  Shipper-specified range, if any.
 *
 * @typedef {object} RouteInput  Provider-independent route data (see routeInput.js).
 * @property {string} routeId
 * @property {number} distanceKm
 * @property {number|null} durationMinutes
 * @property {number} additionalDistanceKm
 * @property {number} additionalDurationMinutes
 * @property {{ stopId: string, type: 'pickup'|'delivery'|'other', durationMinutes: number|null }[]} stops
 * @property {string} source                            e.g. "sygic", "openrouteservice", "osrm", "sample".
 * @property {'provider'|'manual_estimate'|'demo_sample'} dataStatus
 */
