import {
  allocateSharedTransport,
  calculateSavings,
  checkCompatibility,
  estimateFuel,
  estimateRouteDeviationFuel,
  estimateTransportOperatingCost,
  loadCatalog,
  localizedName,
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  suggestTrailerCategories,
} from '../lib/logistics/index.js';
import { ValidationError } from '../utils/errors.js';

/**
 * HTTP adapter for the logistics module. Business rules and input validation
 * live in backend/src/lib/logistics; this layer only maps HTTP ↔ function calls.
 */

function localeOf(req) {
  const requested = req.query.locale ?? req.body?.locale;
  return SUPPORTED_LOCALES.includes(requested) ? requested : DEFAULT_LOCALE;
}

function body(req) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    throw new ValidationError('Request body must be a JSON object.');
  }
  return req.body;
}

export function createLogisticsController({ catalog = loadCatalog() } = {}) {
  return {
    catalog(req, res) {
      const locale = localeOf(req);
      const withName = (item) => ({ ...item, displayName: localizedName(item.names, locale, item.id) });
      res.json({
        data: {
          locale,
          categories: catalog.cargo.categories,
          packagingTypes: catalog.cargo.packagingTypes,
          trailerCategories: catalog.trailers.trailerCategories,
          cargoTypes: catalog.cargo.cargoTypes.map(withName),
          tractors: catalog.trucks.tractors,
          trucksDefaults: catalog.trucks.defaults,
          referenceTests: catalog.trucks.referenceTests,
          trailers: catalog.trailers.trailers,
          demoPayloadProfile: catalog.trailers.demoPayloadProfile,
          legalReference: catalog.trailers.legalReference,
        },
      });
    },

    compatibility(req, res) {
      const input = body(req);
      const result = checkCompatibility({ ...input, locale: localeOf(req) }, catalog);
      res.json({ data: { ...result, suggestedTrailerCategories: suggestTrailerCategories(input.shipments, catalog) } });
    },

    fuel(req, res) {
      const input = body(req);
      const result =
        input.additionalDistanceKm !== undefined
          ? estimateRouteDeviationFuel(input)
          : estimateFuel(input);
      res.json({ data: result });
    },

    transportCost(req, res) {
      res.json({ data: estimateTransportOperatingCost(body(req)) });
    },

    savings(req, res) {
      const input = { ...body(req), locale: localeOf(req) };
      const result = Array.isArray(input.participants) ? allocateSharedTransport(input) : calculateSavings(input);
      res.json({ data: result });
    },
  };
}
