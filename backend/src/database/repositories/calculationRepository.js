import { query } from '../query.js';

/**
 * Column ↔ record mapping for transport_calculations.
 * `toRow` keys are column names; values come from the record built by calculationService.
 */
const INSERT_COLUMNS = [
  'label',
  'calculation_version',
  'currency',
  'origin_label',
  'origin_lat',
  'origin_lon',
  'destination_label',
  'destination_lat',
  'destination_lon',
  'routing_provider',
  'routing_profile',
  'truck_restrictions_applied',
  'outbound_distance_km',
  'outbound_duration_s',
  'return_mode',
  'return_distance_km',
  'return_duration_s',
  'route_metadata',
  'truck_configuration_id',
  'truck_snapshot',
  'truck_capacity_t',
  'fuel_type',
  'fuel_consumption_l_100km',
  'empty_fuel_consumption_l_100km',
  'fuel_price_eur_l',
  'fuel_price_origin',
  'fuel_price_date',
  'fuel_price_source',
  'cargo_type_id',
  'cargo_type_code',
  'cargo_quantity_t',
  'return_cargo_quantity_t',
  'cargo_density_t_m3',
  'fuel_litres',
  'fuel_cost_eur',
  'tolls_eur',
  'return_tolls_eur',
  'loading_unloading_eur',
  'other_cost_eur',
  'total_cost_eur',
  'cost_per_tonne_eur',
  'cost_per_tonne_km_eur',
  'capacity_utilization_pct',
  'inputs',
  'results',
];

const JSON_COLUMNS = new Set(['route_metadata', 'truck_snapshot', 'inputs', 'results']);

const SUMMARY_COLUMNS = `
  c.id, c.created_at, c.label, c.origin_label, c.destination_label, c.routing_provider,
  c.routing_profile, c.truck_restrictions_applied, c.outbound_distance_km, c.outbound_duration_s,
  c.return_mode, c.return_distance_km, c.cargo_type_code, ct.name AS cargo_type_name, ct.names AS cargo_type_names,
  c.cargo_quantity_t, c.truck_snapshot->>'name' AS truck_name, c.total_cost_eur,
  c.cost_per_tonne_eur, c.currency`;

function mapSummary(r) {
  return {
    id: r.id,
    createdAt: r.created_at.toISOString(),
    label: r.label,
    originLabel: r.origin_label,
    destinationLabel: r.destination_label,
    routingProvider: r.routing_provider,
    routingProfile: r.routing_profile,
    truckRestrictionsApplied: r.truck_restrictions_applied,
    outboundDistanceKm: r.outbound_distance_km,
    outboundDurationS: r.outbound_duration_s,
    returnMode: r.return_mode,
    returnDistanceKm: r.return_distance_km,
    cargoTypeCode: r.cargo_type_code,
    cargoTypeName: r.cargo_type_name,
    cargoTypeNames: r.cargo_type_names ?? null,
    cargoQuantityT: r.cargo_quantity_t,
    truckName: r.truck_name,
    totalCostEur: r.total_cost_eur,
    costPerTonneEur: r.cost_per_tonne_eur,
    currency: r.currency,
  };
}

function mapFull(r) {
  return {
    ...mapSummary(r),
    calculationVersion: r.calculation_version,
    origin: { label: r.origin_label, lat: r.origin_lat, lon: r.origin_lon },
    destination: { label: r.destination_label, lat: r.destination_lat, lon: r.destination_lon },
    returnDurationS: r.return_duration_s,
    routeMetadata: r.route_metadata,
    truckConfigurationId: r.truck_configuration_id,
    truckSnapshot: r.truck_snapshot,
    fuelPriceEurPerL: r.fuel_price_eur_l,
    fuelPrice: {
      eurPerL: r.fuel_price_eur_l,
      origin: r.fuel_price_origin ?? 'manual',
      date: r.fuel_price_date instanceof Date ? r.fuel_price_date.toISOString().slice(0, 10) : r.fuel_price_date,
      source: r.fuel_price_source ?? null,
    },
    costs: {
      fuelLitres: r.fuel_litres,
      fuelCostEur: r.fuel_cost_eur,
      tollsEur: r.tolls_eur,
      returnTollsEur: r.return_tolls_eur,
      loadingUnloadingEur: r.loading_unloading_eur,
      otherEur: r.other_cost_eur,
      totalCostEur: r.total_cost_eur,
      costPerTonneEur: r.cost_per_tonne_eur,
      costPerTonneKmEur: r.cost_per_tonne_km_eur,
      capacityUtilizationPct: r.capacity_utilization_pct,
    },
    inputs: r.inputs,
    results: r.results,
  };
}

export function createCalculationRepository(db) {
  return {
    async create(row) {
      const missing = INSERT_COLUMNS.filter((c) => !(c in row));
      if (missing.length) throw new Error(`calculationRepository.create: missing columns ${missing.join(', ')}`);
      const values = INSERT_COLUMNS.map((c) => (JSON_COLUMNS.has(c) ? JSON.stringify(row[c]) : row[c]));
      const placeholders = INSERT_COLUMNS.map((c, i) => (JSON_COLUMNS.has(c) ? `$${i + 1}::jsonb` : `$${i + 1}`));
      const { rows } = await query(
        db,
        `INSERT INTO transport_calculations (${INSERT_COLUMNS.join(', ')})
         VALUES (${placeholders.join(', ')})
         RETURNING id`,
        values,
      );
      return this.getById(rows[0].id);
    },

    async list({ limit, offset }) {
      const [items, count] = await Promise.all([
        query(
          db,
          `SELECT ${SUMMARY_COLUMNS}
             FROM transport_calculations c
             JOIN cargo_types ct ON ct.id = c.cargo_type_id
            ORDER BY c.created_at DESC, c.id
            LIMIT $1 OFFSET $2`,
          [limit, offset],
        ),
        query(db, 'SELECT count(*)::int AS total FROM transport_calculations'),
      ]);
      return { items: items.rows.map(mapSummary), total: count.rows[0].total };
    },

    async getById(id) {
      const { rows } = await query(
        db,
        `SELECT c.*, ct.name AS cargo_type_name, ct.names AS cargo_type_names, c.truck_snapshot->>'name' AS truck_name
           FROM transport_calculations c
           JOIN cargo_types ct ON ct.id = c.cargo_type_id
          WHERE c.id = $1`,
        [id],
      );
      return rows[0] ? mapFull(rows[0]) : null;
    },

    async deleteById(id) {
      const { rowCount } = await query(db, 'DELETE FROM transport_calculations WHERE id = $1', [id]);
      return rowCount > 0;
    },
  };
}
