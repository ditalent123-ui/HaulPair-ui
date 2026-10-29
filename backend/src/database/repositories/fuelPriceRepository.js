import { query } from '../query.js';

function map(r) {
  return {
    fuelType: r.fuel_type,
    priceEurPerL: r.price_eur_per_l,
    priceDate: r.price_date instanceof Date ? r.price_date.toISOString().slice(0, 10) : r.price_date,
    geography: r.geography,
    priceBasis: r.price_basis,
    sourceName: r.source_name,
    sourceUrl: r.source_url,
    method: r.method,
    fetchedAt: r.fetched_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

export function createFuelPriceRepository(db) {
  return {
    async get(fuelType) {
      const { rows } = await query(db, 'SELECT * FROM fuel_prices WHERE fuel_type = $1', [fuelType]);
      return rows[0] ? map(rows[0]) : null;
    },

    async list() {
      const { rows } = await query(db, 'SELECT * FROM fuel_prices ORDER BY fuel_type');
      return rows.map(map);
    },

    /** Accepted-price history (newest first) for the trend chart. */
    async listHistory(fuelType, limit = 30) {
      const { rows } = await query(
        db,
        `SELECT DISTINCT ON (price_date) price_date, price_eur_per_l, source_name, method, recorded_at
           FROM fuel_price_history WHERE fuel_type = $1
          ORDER BY price_date DESC, recorded_at DESC LIMIT $2`,
        [fuelType, limit],
      );
      return rows
        .map((r) => ({
          priceDate: r.price_date instanceof Date ? r.price_date.toISOString().slice(0, 10) : r.price_date,
          priceEurPerL: r.price_eur_per_l,
          sourceName: r.source_name,
          method: r.method,
        }))
        .reverse();
    },

    /** Atomically replace the verified record for one fuel type, and append it to the history. */
    async upsert(record) {
      const { rows } = await query(
        db,
        `INSERT INTO fuel_prices (fuel_type, price_eur_per_l, price_date, geography, price_basis, source_name, source_url, method, fetched_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())
         ON CONFLICT (fuel_type) DO UPDATE SET
           price_eur_per_l = EXCLUDED.price_eur_per_l,
           price_date = EXCLUDED.price_date,
           geography = EXCLUDED.geography,
           price_basis = EXCLUDED.price_basis,
           source_name = EXCLUDED.source_name,
           source_url = EXCLUDED.source_url,
           method = EXCLUDED.method,
           fetched_at = now(),
           updated_at = now()
         RETURNING *`,
        [
          record.fuelType,
          record.priceEurPerL,
          record.priceDate,
          record.geography ?? 'LT',
          record.priceBasis,
          record.sourceName,
          record.sourceUrl,
          record.method ?? 'manual_import',
        ],
      );
      const saved = map(rows[0]);
      await query(
        db,
        `INSERT INTO fuel_price_history (fuel_type, price_eur_per_l, price_date, source_name, source_url, method)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [saved.fuelType, saved.priceEurPerL, saved.priceDate, saved.sourceName, saved.sourceUrl, saved.method],
      );
      return saved;
    },
  };
}
