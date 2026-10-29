import crypto from 'node:crypto';
import { AppError } from '../utils/errors.js';

function timingSafeEqualStr(a, b) {
  const ah = crypto.createHash('sha256').update(String(a), 'utf8').digest();
  const bh = crypto.createHash('sha256').update(String(b), 'utf8').digest();
  return crypto.timingSafeEqual(ah, bh);
}

/**
 * Fuel-price endpoints.
 *   GET  /api/fuel-price?fuelType=diesel  — read the shared suggestion (no external call).
 *   POST /api/fuel-price/import           — admin import of a verified record (admin token).
 * Both sit behind the app's shared access protection; import adds a separate admin token.
 */
export function createFuelPriceController({ fuelPriceService, fuelPriceRepository, activityService, adminToken, onImported = () => {} }) {
  function requireAdmin(req) {
    if (!adminToken) throw new AppError('Fuel-price import is not configured (FUEL_PRICE_ADMIN_TOKEN unset).', { status: 503, code: 'FUEL_ADMIN_DISABLED' });
    const provided = req.headers['x-admin-token'];
    if (typeof provided !== 'string' || !timingSafeEqualStr(provided, adminToken)) {
      throw new AppError('Invalid admin token.', { status: 403, code: 'FUEL_ADMIN_FORBIDDEN' });
    }
  }

  return {
    async suggestion(req, res) {
      res.json({ data: await fuelPriceService.getSuggestion(req.validated.query.fuelType) });
    },

    async import(req, res) {
      requireAdmin(req);
      const record = fuelPriceService.buildImportRecord(req.validated.body);
      const saved = await fuelPriceRepository.upsert(record);
      onImported(saved); // drop the cached diesel price so quotes and the tracker use the new value
      await activityService.record({
        eventType: 'fuel_price.imported',
        entityType: 'fuel_price',
        entityId: saved.fuelType,
        requestId: req.id,
        details: { fuelType: saved.fuelType, priceDate: saved.priceDate, method: saved.method },
      });
      res.status(201).json({ data: saved });
    },
  };
}
