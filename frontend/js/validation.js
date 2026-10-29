import { fmt, t } from './i18n.js';

/**
 * Client-side validation for fast feedback. The server re-validates every
 * request; these rules mirror it so users see errors next to fields.
 *
 * Cargo quantities are ENTERED IN KILOGRAMS and converted to tonnes (kg / 1000)
 * at this boundary only; the backend contract and the €/t, €/tkm metrics stay in
 * tonnes. Truck max payload stays in tonnes. Bulk density is optional and 0 is
 * allowed (empty or 0 → no volume estimate).
 */

function num(raw) {
  if (raw === '' || raw === null || raw === undefined) return null;
  const n = Number(String(raw).replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

export function readAndValidate(form, { origin, destination }) {
  const errors = {};
  const v = (id) => num(form.querySelector(`#${id}`).value);

  const requirePositive = (id, max) => {
    const n = v(id);
    if (n === null) errors[id] = t('validation.required');
    else if (!(n > 0)) errors[id] = t('validation.positive');
    else if (max !== undefined && n > max) errors[id] = t('validation.max', { max });
    return n;
  };
  const optionalPositive = (id, max) => {
    const n = v(id);
    if (n === null) return null;
    if (!(n > 0)) errors[id] = t('validation.positive');
    else if (max !== undefined && n > max) errors[id] = t('validation.max', { max });
    return n;
  };
  // Optional and 0-allowed (bulk density): empty → null, 0 → 0, negative → invalid.
  const optionalNonNegative = (id, max) => {
    const n = v(id);
    if (n === null) return null;
    if (!(n >= 0)) errors[id] = t('validation.nonNegative');
    else if (max !== undefined && n > max) errors[id] = t('validation.max', { max });
    return n;
  };
  const money = (id) => {
    const n = v(id);
    if (n === null) return 0;
    if (!(n >= 0)) errors[id] = t('validation.nonNegative');
    else if (n > 1_000_000) errors[id] = t('validation.max', { max: '1 000 000' });
    return n;
  };

  if (!origin) errors.origin = t('validation.selectLocation');
  if (!destination) errors.destination = t('validation.selectLocation');
  if (origin && destination && origin.lat === destination.lat && origin.lon === destination.lon) {
    errors.destination = t('validation.sameLocation');
  }

  const capacityT = requirePositive('capacity', 60);
  const cargoVolumeM3 = optionalPositive('cargoVolume', 200);
  const fuelConsumptionLPer100Km = requirePositive('fuelConsumption', 100);
  const emptyFuelConsumptionLPer100Km = optionalPositive('emptyFuelConsumption', 100);

  // Quantity entered in kg (max 60 000 kg), converted to tonnes.
  const quantityKg = requirePositive('cargoQuantity', 60000);
  const quantityT = quantityKg === null || Number.isNaN(quantityKg) ? quantityKg : quantityKg / 1000;
  const densityTPerM3 = optionalNonNegative('cargoDensity', 2);
  const fuelPriceEurPerL = requirePositive('fuelPrice', 10);

  if (capacityT > 0 && quantityKg > capacityT * 1000) {
    errors.cargoQuantity = t('validation.overCapacity', { cap: fmt.number(capacityT * 1000, 0) });
  }

  const cargoTypeCode = form.querySelector('#cargoType').value;
  if (!cargoTypeCode) errors.cargoType = t('validation.selectCargo');

  const returnMode = form.querySelector('#returnMode').value;
  let returnCargoQuantityT = null;
  if (returnMode === 'loaded') {
    const returnKg = requirePositive('returnCargoQuantity', 60000);
    returnCargoQuantityT = returnKg === null || Number.isNaN(returnKg) ? returnKg : returnKg / 1000;
    if (capacityT > 0 && returnKg > capacityT * 1000) {
      errors.returnCargoQuantity = t('validation.overCapacity', { cap: fmt.number(capacityT * 1000, 0) });
    }
  }

  const vehicle = {
    heightM: optionalPositive('vehHeight', 5),
    widthM: optionalPositive('vehWidth', 3.5),
    lengthM: optionalPositive('vehLength', 30),
    grossWeightT: optionalPositive('vehWeight', 80),
    axleLoadT: optionalPositive('vehAxle', 20),
  };

  const costs = {
    tollsEur: money('tolls'),
    returnTollsEur: money('returnTolls'),
    loadingUnloadingEur: money('loadingCost'),
    otherEur: money('otherCost'),
  };

  return {
    errors,
    values: {
      origin,
      destination,
      returnMode,
      returnCargoQuantityT,
      truck: {
        truckType: form.querySelector('#truckType').value,
        fuelType: form.querySelector('#fuelType').value,
        capacityT,
        cargoVolumeM3,
        fuelConsumptionLPer100Km,
        emptyFuelConsumptionLPer100Km,
      },
      vehicle,
      cargo: { typeCode: cargoTypeCode, quantityT, densityTPerM3 },
      fuelPriceEurPerL,
      costs,
    },
  };
}

/** Map server error details (field paths) onto form input ids. */
export const SERVER_FIELD_TO_INPUT = {
  'origin': 'origin',
  'origin.label': 'origin',
  'destination': 'destination',
  'destination.label': 'destination',
  'truck.capacityT': 'capacity',
  'truck.cargoVolumeM3': 'cargoVolume',
  'truck.fuelConsumptionLPer100Km': 'fuelConsumption',
  'truck.emptyFuelConsumptionLPer100Km': 'emptyFuelConsumption',
  'cargo.quantityT': 'cargoQuantity',
  'cargo.densityTPerM3': 'cargoDensity',
  'cargo.typeCode': 'cargoType',
  'fuelPriceEurPerL': 'fuelPrice',
  'returnTrip.cargoQuantityT': 'returnCargoQuantity',
  'costs.tollsEur': 'tolls',
  'costs.returnTollsEur': 'returnTolls',
  'costs.loadingUnloadingEur': 'loadingCost',
  'costs.otherEur': 'otherCost',
  'vehicle.heightM': 'vehHeight',
  'vehicle.widthM': 'vehWidth',
  'vehicle.lengthM': 'vehLength',
  'vehicle.grossWeightT': 'vehWeight',
  'vehicle.axleLoadT': 'vehAxle',
};
