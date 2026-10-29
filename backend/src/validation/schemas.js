import { z } from 'zod';
import { RETURN_MODES } from '../services/calculation/transportCost.js';

/**
 * Request schemas. These check shape and basic ranges at the API boundary;
 * business rules (e.g. cargo ≤ capacity) are enforced again in the calculation
 * engine so they hold regardless of the caller.
 */

const finite = (label) => z.number({ error: `${label} must be a number.` }).finite();
const positive = (label, max) =>
  finite(label)
    .gt(0, { error: `${label} must be greater than 0.` })
    .max(max, { error: `${label} must not exceed ${max}.` });
const nonNegativeMoney = (label) =>
  finite(label)
    .min(0, { error: `${label} must be 0 or greater.` })
    .max(1_000_000, { error: `${label} must not exceed 1,000,000 EUR.` });

const optionalPositive = (label, max) => positive(label, max).nullish();
// Optional and 0-allowed (e.g. bulk density): null/absent = not provided, 0 = explicitly not applicable.
const optionalNonNegative = (label, max) =>
  finite(label)
    .min(0, { error: `${label} must be 0 or greater.` })
    .max(max, { error: `${label} must not exceed ${max}.` })
    .nullish();

export const locationSchema = z.object({
  lat: finite('Latitude').min(-90).max(90),
  lon: finite('Longitude').min(-180).max(180),
  label: z.string().trim().min(1, { error: 'Location label is required.' }).max(200),
});

export const vehicleSchema = z
  .object({
    heightM: optionalPositive('Vehicle height', 5),
    widthM: optionalPositive('Vehicle width', 3.5),
    lengthM: optionalPositive('Vehicle length', 30),
    grossWeightT: optionalPositive('Gross vehicle weight', 80),
    axleLoadT: optionalPositive('Axle load', 20),
  })
  .strict();

export const routeRequestSchema = z
  .object({
    origin: locationSchema,
    destination: locationSchema,
    includeReturn: z.boolean().default(false),
    vehicle: vehicleSchema.optional(),
  })
  .strict()
  .refine((v) => v.origin.lat !== v.destination.lat || v.origin.lon !== v.destination.lon, {
    error: 'Origin and destination must be different locations.',
    path: ['destination'],
  });

export const geocodeQuerySchema = z.object({
  q: z.string().trim().min(2, { error: 'Search text must have at least 2 characters.' }).max(120),
  limit: z.coerce.number().int().min(1).max(10).default(6),
});

export const FUEL_TYPES = ['diesel', 'hvo', 'biodiesel', 'lng', 'cng'];

export const calculationRequestSchema = z
  .object({
    routeToken: z.string({ error: 'Route data is missing. Calculate a route first.' }).min(10).max(8192),
    label: z.string().trim().max(120).optional(),
    truckConfigurationId: z.number().int().positive().nullish(),
    truck: z
      .object({
        name: z.string().trim().max(120).optional(),
        truckType: z.enum(['rigid', 'rigid_drawbar', 'tractor_semitrailer']).optional(),
        capacityT: positive('Truck capacity', 60),
        cargoVolumeM3: optionalPositive('Cargo body volume', 200),
        fuelType: z.enum(FUEL_TYPES, { error: `Fuel type must be one of: ${FUEL_TYPES.join(', ')}.` }),
        fuelConsumptionLPer100Km: positive('Fuel consumption', 100),
        emptyFuelConsumptionLPer100Km: optionalPositive('Empty-run fuel consumption', 100),
      })
      .strict(),
    cargo: z
      .object({
        typeCode: z.string().trim().min(1).max(40),
        quantityT: positive('Cargo quantity', 60),
        densityTPerM3: optionalNonNegative('Bulk density', 2),
      })
      .strict(),
    fuelPriceEurPerL: positive('Fuel price', 10),
    // Optional snapshot of where the fuel price came from (manual vs a source suggestion).
    fuelPriceMeta: z
      .object({
        origin: z.enum(['manual', 'lea', 'suggested']).default('manual'),
        priceDate: z.string().trim().max(32).nullish(),
        source: z.string().trim().max(200).nullish(),
      })
      .strict()
      .optional(),
    returnTrip: z
      .object({
        mode: z.enum(RETURN_MODES).default('none'),
        cargoQuantityT: optionalPositive('Return cargo quantity', 60),
      })
      .strict()
      .default({ mode: 'none' }),
    costs: z
      .object({
        tollsEur: nonNegativeMoney('Tolls').default(0),
        returnTollsEur: nonNegativeMoney('Return tolls').default(0),
        loadingUnloadingEur: nonNegativeMoney('Loading/unloading cost').default(0),
        otherEur: nonNegativeMoney('Other costs').default(0),
      })
      .strict()
      .default({}),
  })
  .strict();

export const aiParseSchema = z
  .object({
    text: z
      .string({ error: 'A shipment description is required.' })
      .trim()
      .min(1, { error: 'Enter a short shipment description.' })
      .max(20000, { error: 'The description is too long.' }),
    locale: z.enum(['lt', 'en']).optional(),
  })
  .strict();

export const fuelPriceQuerySchema = z.object({
  fuelType: z.string().trim().min(1).max(40).default('diesel'),
});

export const fuelPriceImportSchema = z
  .object({
    fuelType: z.string().trim().min(1).max(40),
    price: z.union([z.number(), z.string()]).optional(),
    priceEurPerL: z.union([z.number(), z.string()]).optional(),
    unit: z.enum(['eur_per_l', 'eur_per_1000l', 'ct_per_l']).optional(),
    priceDate: z.string().trim().min(1).max(32),
    geography: z.string().trim().max(8).optional(),
    priceBasis: z.string().trim().min(1).max(200),
    sourceName: z.string().trim().min(1).max(200),
    sourceUrl: z.url().max(500),
    method: z.enum(['manual_import', 'lea_adapter', 'ai_assisted']).optional(),
  })
  .strict();

export const idParamSchema = z.object({
  id: z.uuid({ error: 'Calculation id must be a valid UUID.' }),
});

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

/** Convert zod issues into the API's error detail format. */
export function formatIssues(issues) {
  return issues.map((issue) => ({
    field: issue.path.join('.') || null,
    message: issue.message,
  }));
}
