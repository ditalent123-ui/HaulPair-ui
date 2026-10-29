import { AppError, ValidationError } from '../../utils/errors.js';

/**
 * Fuel-price suggestion service.
 *
 * Owner's chosen source: LEA (Lietuvos energetikos agentūra),
 * https://www.ena.lt/degalu-kainos-degalinese/ — the Lithuania average DIESEL
 * retail price (EUR/l). This is a market reference, NOT a carrier contract price
 * or the final haulage price charged to a customer.
 *
 * What is implemented and verified here:
 *   - a shared store read by every visitor (no per-visitor external call),
 *   - an admin import that validates and unit-normalises a verified record,
 *   - honest staleness reporting.
 * What is NOT presented as working: automatic LEA ingestion. LEA's public API /
 * exact annual-file URL / schema were not confirmed, and this environment cannot
 * reach ena.lt, so `refreshFromSource` is a disabled, SSRF-guarded stub. Manual
 * fuel-price entry always works regardless.
 */

const ALLOWED_UNITS = new Set(['eur_per_l', 'eur_per_1000l', 'ct_per_l']);
// Sanity bounds for a plausible EUR/l pump price; an out-of-range value is a verification problem.
const MIN_EUR_PER_L = 0.3;
const MAX_EUR_PER_L = 5;
// Only hosts explicitly allowed for the (currently disabled) automatic fetch.
const ALLOWED_SOURCE_HOSTS = new Set(['www.ena.lt', 'ena.lt']);

function parseDecimal(value, field) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = Number(value.trim().replace(/\s/g, '').replace(',', '.'));
    if (Number.isFinite(n)) return n;
  }
  throw new ValidationError(`${field} must be a number.`, [{ field, message: 'must be a number' }]);
}

/** Convert a source-reported price + unit into EUR/l and validate the result. */
export function normalizePriceToEurPerL(priceRaw, unit, field = 'price') {
  if (!ALLOWED_UNITS.has(unit)) {
    throw new ValidationError(`Unsupported price unit "${unit}".`, [{ field: 'unit', message: `must be one of ${[...ALLOWED_UNITS].join(', ')}` }]);
  }
  const n = parseDecimal(priceRaw, field);
  const eurPerL = unit === 'eur_per_1000l' ? n / 1000 : unit === 'ct_per_l' ? n / 100 : n;
  const rounded = Math.round(eurPerL * 1000) / 1000;
  if (!(rounded > 0) || rounded < MIN_EUR_PER_L || rounded > MAX_EUR_PER_L) {
    throw new ValidationError('The converted price is outside a plausible EUR/l range; verify units and value.', [
      { field, message: `must be between ${MIN_EUR_PER_L} and ${MAX_EUR_PER_L} EUR/l after conversion` },
    ]);
  }
  return rounded;
}

function isIsoDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

export function createFuelPriceService({ config, fuelPriceRepository, supportedFuelTypes = ['diesel'], now = () => Date.now() }) {
  function ageHours(priceDate) {
    const ms = now() - Date.parse(`${priceDate}T00:00:00Z`);
    return Math.max(0, Math.round(ms / 3_600_000));
  }

  return {
    autoRefreshAvailable() {
      return false; // automatic LEA ingestion not verified/connected
    },

    /** Read the shared suggestion for one fuel type. No external call. */
    async getSuggestion(fuelType) {
      if (!supportedFuelTypes.includes(fuelType)) {
        return { available: false, reason: 'unsupported_fuel', fuelType };
      }
      const rec = await fuelPriceRepository.get(fuelType);
      if (!rec) return { available: false, reason: 'no_data', fuelType };
      const hrs = ageHours(rec.priceDate);
      const stale = hrs > config.maxAgeHours;
      return {
        available: true,
        fuelType,
        priceEurPerL: rec.priceEurPerL,
        priceDate: rec.priceDate,
        geography: rec.geography,
        priceBasis: rec.priceBasis,
        sourceName: rec.sourceName,
        sourceUrl: rec.sourceUrl,
        method: rec.method,
        fetchedAt: rec.fetchedAt,
        ageHours: hrs,
        stale,
        // Honest label: a plain adapter/import is "LEA suggested", not an AI action.
        label: rec.method === 'ai_assisted' ? 'ai_suggested' : 'source_suggested',
      };
    },

    /**
     * Admin import of a verified record. Validates and unit-normalises, then the
     * caller upserts it atomically. Throws ValidationError on bad input.
     */
    buildImportRecord(input) {
      const fuelType = String(input.fuelType ?? '').trim();
      if (!supportedFuelTypes.includes(fuelType)) {
        throw new ValidationError('Unsupported fuel type.', [{ field: 'fuelType', message: `must be one of ${supportedFuelTypes.join(', ')}` }]);
      }
      const priceEurPerL = normalizePriceToEurPerL(input.price ?? input.priceEurPerL, input.unit ?? 'eur_per_l', 'price');
      if (!isIsoDate(input.priceDate)) {
        throw new ValidationError('A valid price date (YYYY-MM-DD) is required.', [{ field: 'priceDate', message: 'must be YYYY-MM-DD' }]);
      }
      if (Date.parse(`${input.priceDate}T00:00:00Z`) > now() + 86_400_000) {
        throw new ValidationError('The price date is in the future.', [{ field: 'priceDate', message: 'must not be in the future' }]);
      }
      const req = (field) => {
        const v = String(input[field] ?? '').trim();
        if (!v) throw new ValidationError(`${field} is required.`, [{ field, message: 'is required' }]);
        return v;
      };
      return {
        fuelType,
        priceEurPerL,
        priceDate: input.priceDate,
        geography: String(input.geography ?? 'LT').trim() || 'LT',
        priceBasis: req('priceBasis'),
        sourceName: req('sourceName'),
        sourceUrl: req('sourceUrl'),
        method: input.method === 'ai_assisted' ? 'ai_assisted' : input.method === 'lea_adapter' ? 'lea_adapter' : 'manual_import',
      };
    },

    /**
     * Disabled automatic LEA fetch. Kept as a documented, SSRF-guarded stub so the
     * interface exists without pretending the ingestion works.
     */
    async refreshFromSource() {
      if (!config.enabled) {
        throw new AppError('Automatic LEA fetch is disabled (FUEL_PRICE_ENABLED=false).', { status: 503, code: 'FUEL_SOURCE_DISABLED' });
      }
      assertAllowedSourceUrl(config.sourceUrl);
      throw new AppError(
        'The LEA ingestion path is not verified yet. Use admin import, or confirm LEA\'s official structured feed first.',
        { status: 501, code: 'FUEL_SOURCE_UNVERIFIED' },
      );
    },
  };
}

/** SSRF guard for the (disabled) automatic fetch: https only, host allowlist. */
export function assertAllowedSourceUrl(rawUrl) {
  let u;
  try {
    u = new URL(String(rawUrl));
  } catch {
    throw new AppError('FUEL_PRICE_SOURCE_URL is not a valid URL.', { status: 500, code: 'FUEL_SOURCE_CONFIG' });
  }
  if (u.protocol !== 'https:' || !ALLOWED_SOURCE_HOSTS.has(u.hostname)) {
    throw new AppError('The configured fuel-price source host is not allowed.', { status: 500, code: 'FUEL_SOURCE_CONFIG' });
  }
  return u;
}
