import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CARGO_CATEGORIES,
  CONFIDENCE_LEVELS,
  PACKAGING_TYPES,
  TEMPERATURE_STATUSES,
  TRAILER_CATEGORIES,
} from './types.js';

/**
 * Loads and validates the JSON catalogs in data/logistics/.
 * The JSON files are the single source of truth; the planner's database seed
 * references catalog ids, and a test checks they stay in sync.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
export const CATALOG_DIR = path.resolve(here, '../../../../data/logistics');

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, file), 'utf8'));
}

/**
 * Validate catalog structure. Returns a list of human-readable problems (empty = valid).
 * Checks ids, enum values, units (non-negative numbers), localisation and confidence tags.
 */
export function validateCatalog({ cargo, trucks, trailers }) {
  const problems = [];
  const err = (where, msg) => problems.push(`${where}: ${msg}`);
  const isPosOrNull = (v) => v === null || (typeof v === 'number' && Number.isFinite(v) && v > 0);
  const checkConfidence = (where, c) => {
    if (!CONFIDENCE_LEVELS.includes(c)) err(where, `invalid confidence "${c}"`);
  };
  const checkIds = (where, list) => {
    const seen = new Set();
    for (const item of list) {
      if (typeof item.id !== 'string' || !/^[a-z][a-z0-9_]*$/.test(item.id)) err(where, `invalid id "${item.id}"`);
      if (seen.has(item.id)) err(where, `duplicate id "${item.id}"`);
      seen.add(item.id);
    }
  };

  // Cargo
  checkIds('cargoTypes', cargo.cargoTypes);
  for (const c of cargo.cargoTypes) {
    const w = `cargo ${c.id}`;
    if (!c.names?.lt) err(w, 'missing Lithuanian name');
    if (!c.names?.en) err(w, 'missing English name');
    if (!CARGO_CATEGORIES.includes(c.category)) err(w, `invalid category "${c.category}"`);
    if (!Array.isArray(c.transportOptions) || c.transportOptions.length === 0) err(w, 'no transport options');
    for (const opt of c.transportOptions ?? []) {
      if (!PACKAGING_TYPES.includes(opt.packaging)) err(w, `invalid packaging "${opt.packaging}"`);
      for (const tc of opt.trailerCategories ?? []) if (!TRAILER_CATEGORIES.includes(tc)) err(w, `invalid trailer category "${tc}"`);
    }
    if (!TEMPERATURE_STATUSES.includes(c.temperature?.status)) err(w, 'invalid temperature status');
    if (c.temperature?.status === 'required' && (typeof c.temperature.minC !== 'number' || typeof c.temperature.maxC !== 'number')) {
      err(w, 'required temperature needs minC and maxC');
    }
    if (typeof c.hygiene?.group !== 'string') err(w, 'missing hygiene group');
    if (c.bulkDensity) {
      const { minTPerM3: lo, maxTPerM3: hi } = c.bulkDensity;
      if (!isPosOrNull(lo) || !isPosOrNull(hi)) err(w, 'bulk density must be positive t/m³ or null');
      if (lo !== null && hi !== null && lo > hi) err(w, 'bulk density min > max');
      if (lo !== null && lo >= 2) err(w, 'bulk density looks like kg/m³, expected t/m³');
      checkConfidence(`${w}.bulkDensity`, c.bulkDensity.confidence);
    }
    if (c.hazardous !== false) err(w, 'MVP catalog must contain non-hazardous cargo only');
    checkConfidence(w, c.dataConfidence);
  }
  for (const key of Object.keys(cargo.categories ?? {})) if (!cargo.categories[key].lt) err(`category ${key}`, 'missing lt name');
  for (const p of PACKAGING_TYPES) if (!cargo.packagingTypes?.[p]?.lt) err(`packaging ${p}`, 'missing lt name');

  // Trucks
  checkIds('tractors', trucks.tractors);
  if (!(trucks.defaults?.estimatedConsumptionLPer100Km > 0)) err('trucks.defaults', 'estimated consumption must be > 0');
  for (const t of trucks.tractors) {
    const w = `tractor ${t.id}`;
    if (!t.manufacturer || !t.model) err(w, 'manufacturer and model are required');
    if (t.fuelType !== 'diesel') err(w, `unsupported fuel type "${t.fuelType}"`);
    const ref = t.referenceConsumption;
    if (!ref || !(ref.valueLPer100Km > 0 && ref.valueLPer100Km < 100)) err(w, 'reference consumption must be in l/100 km (0–100)');
    if (ref && !trucks.referenceTests?.[ref.testId]) err(w, `unknown reference test "${ref.testId}"`);
    if (!isPosOrNull(t.estimatedConsumptionLPer100Km)) err(w, 'estimated consumption must be positive or null');
    if (!isPosOrNull(t.unladenWeightKg?.value ?? null)) err(w, 'unladen weight must be positive kg or null');
    checkConfidence(w, t.dataConfidence);
  }

  // Trailers
  checkIds('trailers', trailers.trailers);
  for (const tr of trailers.trailers) {
    const w = `trailer ${tr.id}`;
    if (!TRAILER_CATEGORIES.includes(tr.category)) err(w, `invalid category "${tr.category}"`);
    if (!trailers.trailerCategories?.[tr.category]?.lt) err(w, 'trailer category has no Lithuanian name');
    if (!isPosOrNull(tr.maxPayloadKg)) err(w, 'maxPayloadKg must be positive or null');
    if (tr.maxPayloadKg !== null && tr.maxPayloadKg > 40000) err(w, 'maxPayloadKg above 40 t — payload confused with combination mass?');
    if (!isPosOrNull(tr.internalVolumeM3)) err(w, 'internalVolumeM3 must be positive or null');
    if (tr.palletCapacity && !isPosOrNull(tr.palletCapacity.euroPallets)) err(w, 'euroPallets must be positive or null');
    if (typeof tr.temperatureControl?.available !== 'boolean') err(w, 'temperatureControl.available must be boolean');
    for (const p of tr.supportedPackaging ?? []) if (!PACKAGING_TYPES.includes(p)) err(w, `invalid packaging "${p}"`);
    for (const c of tr.permittedCargoCategories ?? []) if (!CARGO_CATEGORIES.includes(c)) err(w, `invalid cargo category "${c}"`);
    checkConfidence(w, tr.dataConfidence);
  }
  if (trailers.demoPayloadProfile?.maxPayloadKg !== 24000) err('trailers.demoPayloadProfile', 'expected 24000 kg demo profile');

  return problems;
}

let cached = null;

/** Load all catalogs once (validated). Throws if the data files are invalid. */
export function loadCatalog() {
  if (cached) return cached;
  const data = { cargo: readJson('cargo-types.json'), trucks: readJson('trucks.json'), trailers: readJson('trailers.json') };
  const problems = validateCatalog(data);
  if (problems.length) throw new Error(`Logistics catalog is invalid:\n- ${problems.join('\n- ')}`);

  const byId = (list) => new Map(list.map((x) => [x.id, x]));
  cached = Object.freeze({
    ...data,
    cargoById: byId(data.cargo.cargoTypes),
    tractorById: byId(data.trucks.tractors),
    trailerById: byId(data.trailers.trailers),
  });
  return cached;
}

export const getCargoType = (id, catalog = loadCatalog()) => catalog.cargoById.get(id) ?? null;
export const getTractor = (id, catalog = loadCatalog()) => catalog.tractorById.get(id) ?? null;
export const getTrailer = (id, catalog = loadCatalog()) => catalog.trailerById.get(id) ?? null;
