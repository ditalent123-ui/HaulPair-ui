import { query } from '../query.js';

const TRUCK_COLUMNS = `
  id, code, name, names, tractor_model_id, trailer_model_id, truck_type, max_payload_t, cargo_volume_m3, fuel_type,
  fuel_consumption_l_100km, empty_fuel_consumption_l_100km,
  height_m, width_m, length_m, gross_weight_t, axle_load_t, is_demo_assumption`;

function mapTruck(r) {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    names: r.names,
    tractorModelId: r.tractor_model_id,
    trailerModelId: r.trailer_model_id,
    truckType: r.truck_type,
    capacityT: r.max_payload_t,
    cargoVolumeM3: r.cargo_volume_m3,
    fuelType: r.fuel_type,
    fuelConsumptionLPer100Km: r.fuel_consumption_l_100km,
    emptyFuelConsumptionLPer100Km: r.empty_fuel_consumption_l_100km,
    vehicle: {
      heightM: r.height_m,
      widthM: r.width_m,
      lengthM: r.length_m,
      grossWeightT: r.gross_weight_t,
      axleLoadT: r.axle_load_t,
    },
    isDemoAssumption: r.is_demo_assumption,
  };
}

function mapCargo(r) {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    names: r.names,
    typicalDensityTPerM3: r.typical_density_t_m3,
    notes: r.notes,
  };
}

export function createReferenceDataRepository(db) {
  return {
    async listTrucks() {
      const { rows } = await query(
        db,
        `SELECT ${TRUCK_COLUMNS} FROM truck_configurations WHERE is_active ORDER BY sort_order, id`,
      );
      return rows.map(mapTruck);
    },

    async getTruckById(id) {
      const { rows } = await query(
        db,
        `SELECT ${TRUCK_COLUMNS} FROM truck_configurations WHERE id = $1 AND is_active`,
        [id],
      );
      return rows[0] ? mapTruck(rows[0]) : null;
    },

    async listCargoTypes() {
      const { rows } = await query(
        db,
        'SELECT id, code, name, names, typical_density_t_m3, notes FROM cargo_types WHERE is_active ORDER BY sort_order, id',
      );
      return rows.map(mapCargo);
    },

    async getCargoTypeByCode(code) {
      const { rows } = await query(
        db,
        'SELECT id, code, name, names, typical_density_t_m3, notes FROM cargo_types WHERE code = $1 AND is_active',
        [code],
      );
      return rows[0] ? mapCargo(rows[0]) : null;
    },
  };
}
