import { z } from 'zod';

/** Booking-flow request schemas (user-facing; messages stay short and plain). */

// Rough Lithuania bounding box (with a small margin) — the booking flow is Lithuania-only.
const LT_BOX = { minLat: 53.85, maxLat: 56.48, minLon: 20.9, maxLon: 26.9 };

const num = (label) => z.number({ error: `${label} must be a number.` }).finite();

export const ltPointSchema = z
  .object({
    lat: num('Latitude').min(-90).max(90),
    lon: num('Longitude').min(-180).max(180),
    label: z.string().trim().min(1).max(200),
  })
  .strict()
  .refine((p) => p.lat >= LT_BOX.minLat && p.lat <= LT_BOX.maxLat && p.lon >= LT_BOX.minLon && p.lon <= LT_BOX.maxLon, {
    error: 'The location must be in Lithuania.',
  });

const destinationSchema = z.union([
  z.object({ dropoffId: z.string().trim().min(1).max(64) }).strict(),
  ltPointSchema,
]);

const amountSchema = num('Cargo amount')
  .gt(0, { error: 'Cargo amount must be greater than 0.' })
  .max(500, { error: 'Cargo amount must not exceed 500 t.' });

const cargoTypeSchema = z.string().trim().min(1).max(32);

export const quoteRequestSchema = z
  .object({ pickup: ltPointSchema, destination: destinationSchema, cargoType: cargoTypeSchema, amountT: amountSchema })
  .strict();

export const orderRequestSchema = z
  .object({
    quoteToken: z.string().min(10).max(16384),
    pickupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'Pickup date must be YYYY-MM-DD.' }),
    timeWindow: z.string().trim().min(1).max(16),
    asCompany: z.boolean().default(false),
  })
  .strict();

export const plannerRequestSchema = z
  .object({ pickup: ltPointSchema, cargoType: cargoTypeSchema, amountT: amountSchema })
  .strict();

export const placesQuerySchema = z.object({
  q: z.string().trim().min(2, { error: 'Type at least 2 characters.' }).max(120),
  limit: z.coerce.number().int().min(1).max(10).default(6),
});
