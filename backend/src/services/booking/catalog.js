import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Loads the booking seed data (fleet, cargo, drop-off points, pricing, demo
 * market prices, demo exchange, offline place list) from data/booking/*.json
 * once, validates the parts the pricing and selection logic rely on, and
 * exposes frozen read-only views.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
export const BOOKING_DATA_DIR = path.resolve(here, '../../../../data/booking');

function readJson(dir, name) {
  return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

const positive = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;
const nonNegative = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;

// Keys that must never appear in pricing or fleet seed data (driver costs are excluded by design).
const FORBIDDEN_KEY = /driver|vairuot|wage|perdiem|per_diem|dienpinig|accommodation/i;

function assertNoDriverCosts(obj, where) {
  const walk = (v, p) => {
    if (v && typeof v === 'object') {
      for (const [k, child] of Object.entries(v)) {
        if (FORBIDDEN_KEY.test(k)) throw new Error(`${where}: driver-related cost key "${p}${k}" is not allowed.`);
        walk(child, `${p}${k}.`);
      }
    }
  };
  walk(obj, '');
}

function validateFleet(fleet) {
  if (!Array.isArray(fleet.profiles) || fleet.profiles.length === 0) throw new Error('fleet.json: profiles missing');
  let prevGross = 0;
  for (const p of fleet.profiles) {
    for (const k of ['payloadT', 'cargoVolumeM3', 'grossWeightT', 'heightM', 'widthM', 'lengthM', 'axleLoadT']) {
      if (!positive(p[k])) throw new Error(`fleet.json: ${p.id}.${k} must be a positive number`);
    }
    for (const k of ['vehicleCostEurPerKm', 'vehicleTimeCostEurPerHour', 'tollEurPerKm']) {
      if (!nonNegative(p[k])) throw new Error(`fleet.json: ${p.id}.${k} must be >= 0`);
    }
    if (!positive(p.fuelLPer100Km?.empty) || !(p.fuelLPer100Km.full >= p.fuelLPer100Km.empty)) {
      throw new Error(`fleet.json: ${p.id}.fuelLPer100Km must have empty > 0 and full >= empty`);
    }
    if (p.grossWeightT < prevGross) throw new Error('fleet.json: profiles must be ordered from smallest to largest');
    prevGross = p.grossWeightT;
  }
  assertNoDriverCosts(fleet.profiles, 'fleet.json');
}

function validatePricing(pr) {
  if (!nonNegative(pr.marginPct) || pr.marginPct > 100) throw new Error('pricing.json: marginPct must be 0..100');
  if (!nonNegative(pr.emptyReturnFactor) || pr.emptyReturnFactor > 1) throw new Error('pricing.json: emptyReturnFactor must be 0..1');
  if (!nonNegative(pr.handlingHoursPerTruck)) throw new Error('pricing.json: handlingHoursPerTruck must be >= 0');
  if (!nonNegative(pr.minimumChargeEurPerTruck)) throw new Error('pricing.json: minimumChargeEurPerTruck must be >= 0');
  if (!positive(pr.demoRoute?.roadFactor) || !positive(pr.demoRoute?.averageSpeedKmh)) throw new Error('pricing.json: demoRoute invalid');
  assertNoDriverCosts(pr, 'pricing.json');
}

export function loadBookingCatalog({ dir = BOOKING_DATA_DIR, overrides = {} } = {}) {
  const fleet = readJson(dir, 'fleet.json');
  const cargo = readJson(dir, 'cargo.json');
  const dropoffs = readJson(dir, 'dropoff-points.json');
  const pricing = { ...readJson(dir, 'pricing.json'), ...overrides.pricing };
  const market = readJson(dir, 'market-prices-demo.json');
  const exchange = readJson(dir, 'exchange-demo.json');
  const places = readJson(dir, 'places-lt.json');

  validateFleet(fleet);
  validatePricing(pricing);
  for (const c of cargo.cargoTypes) {
    if (!positive(c.planningDensityTPerM3)) throw new Error(`cargo.json: ${c.id}.planningDensityTPerM3 must be positive`);
  }
  for (const p of dropoffs.points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon) || !dropoffs.types[p.type]) {
      throw new Error(`dropoff-points.json: ${p.id} has invalid coordinates or type`);
    }
  }

  const cargoById = new Map(cargo.cargoTypes.map((c) => [c.id, c]));
  const dropoffById = new Map(dropoffs.points.map((p) => [p.id, p]));
  const profileById = new Map(fleet.profiles.map((p) => [p.id, p]));

  return deepFreeze({
    fleet: fleet.profiles,
    cargoTypes: cargo.cargoTypes,
    dropoffTypes: dropoffs.types,
    dropoffs: dropoffs.points,
    dropoffsCheckedAt: dropoffs.checkedAt,
    pricing,
    market,
    exchange,
    places: places.places.map(([name, lat, lon]) => ({ name, lat, lon })),
    getCargo: (id) => cargoById.get(id) ?? null,
    getDropoff: (id) => dropoffById.get(id) ?? null,
    getProfile: (id) => profileById.get(id) ?? null,
  });
}
