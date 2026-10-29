import { loadCatalog } from './catalog.js';
import { localize, localizedName } from './i18n.js';
import { COMPATIBILITY_STATUS, createValidator, PACKAGING_TYPES } from './types.js';

/**
 * Cargo compatibility engine: can these shipments share one trailer?
 *
 * Result status:
 *   compatible    — no rule failed and nothing material is unknown
 *   incompatible  — at least one hard rule failed (capacity, packaging, trailer, temperature, bulk mixing)
 *   needs_review  — nothing failed outright, but information is missing or a risk needs a human decision
 *
 * Uncertainty never resolves to "compatible". Route optimisation is out of scope.
 * The output is decision support, not a legally binding transport safety certification.
 */

const { COMPATIBLE, INCOMPATIBLE, NEEDS_REVIEW } = COMPATIBILITY_STATUS;
const INFO = 'info';

/** Hygiene groups whose cargo is food or feed (sensitive to contamination). */
const FOOD_FEED_GROUPS = new Set(['raw_grain_oilseed', 'fresh_produce', 'animal_feed', 'forage']);
/** Groups that pose a contamination risk to food/feed, with the risk label used in messages. */
const CONTAMINANT_GROUPS = { planting_seed: 'possibly_chemically_treated', non_food_industrial: 'possible_oil_residue' };
const DUST_GROUPS = new Set(['forage', 'straw_bedding']);
/** Special conditions that need a human decision whenever cargo is combined. */
const REVIEW_WHEN_COMBINED = new Set(['fire_risk', 'possibly_chemically_treated', 'possible_oil_residue']);

const round1 = (x) => Math.round(x * 10) / 10;

function validateInput({ shipments, trailer }, catalog) {
  const v = createValidator();
  if (!Array.isArray(shipments) || shipments.length === 0) v.add('shipments', 'required', 'at least one shipment is required');
  const ids = new Set();
  (shipments ?? []).forEach((s, i) => {
    const f = `shipments.${i}`;
    if (typeof s?.shipmentId !== 'string' || !s.shipmentId) v.add(`${f}.shipmentId`, 'required', 'is required');
    else if (ids.has(s.shipmentId)) v.add(`${f}.shipmentId`, 'duplicate', 'must be unique');
    ids.add(s?.shipmentId);
    if (typeof s?.cargoTypeId !== 'string' || !s.cargoTypeId) v.add(`${f}.cargoTypeId`, 'required', 'is required');
    if (!PACKAGING_TYPES.includes(s?.packaging)) v.add(`${f}.packaging`, 'invalid', `must be one of ${PACKAGING_TYPES.join(', ')}`);
    v.finiteNumber(`${f}.weightKg`, s?.weightKg, { minExclusive: 0, max: 60_000, required: false });
    v.finiteNumber(`${f}.volumeM3`, s?.volumeM3, { minExclusive: 0, max: 200, required: false });
    v.finiteNumber(`${f}.palletPositions`, s?.palletPositions, { minExclusive: 0, max: 100, required: false });
    const tr = s?.temperatureRequirementC;
    if (tr !== undefined && tr !== null) {
      v.finiteNumber(`${f}.temperatureRequirementC.minC`, tr.minC, { min: -40, max: 40 });
      v.finiteNumber(`${f}.temperatureRequirementC.maxC`, tr.maxC, { min: -40, max: 40 });
      if (typeof tr.minC === 'number' && typeof tr.maxC === 'number' && tr.minC > tr.maxC) v.add(`${f}.temperatureRequirementC`, 'invalid', 'minC must be ≤ maxC');
    }
  });
  if (!trailer || typeof trailer.trailerId !== 'string') v.add('trailer.trailerId', 'required', 'is required');
  else if (!catalog.trailerById.has(trailer.trailerId)) v.add('trailer.trailerId', 'unknown', `unknown trailer "${trailer.trailerId}"`);
  const o = trailer?.overrides ?? {};
  v.finiteNumber('trailer.overrides.maxPayloadKg', o.maxPayloadKg, { minExclusive: 0, max: 40_000, required: false });
  v.finiteNumber('trailer.overrides.internalVolumeM3', o.internalVolumeM3, { minExclusive: 0, max: 200, required: false });
  v.finiteNumber('trailer.overrides.euroPallets', o.euroPallets, { minExclusive: 0, max: 100, required: false });
  v.throwIfInvalid();
}

/**
 * @param {{ shipments: import('./types.js').Shipment[],
 *           trailer: { trailerId: string, overrides?: { maxPayloadKg?: number, internalVolumeM3?: number, euroPallets?: number } },
 *           useDemoPayloadProfile?: boolean, locale?: string }} input
 * @param {ReturnType<typeof loadCatalog>} [catalog]
 */
export function checkCompatibility(input, catalog = loadCatalog()) {
  validateInput(input, catalog);
  const { shipments, useDemoPayloadProfile = false, locale } = input;
  const trailer = catalog.trailerById.get(input.trailer.trailerId);
  const overrides = input.trailer.overrides ?? {};
  const trailerName = localizedName(catalog.trailers.trailerCategories[trailer.category], locale, trailer.category);
  const reasons = [];
  const reason = (code, severity, shipmentIds, params = {}) => reasons.push({ code, severity, shipmentIds, params });

  // Resolve catalog entries.
  const items = [];
  for (const s of shipments) {
    const cargo = catalog.cargoById.get(s.cargoTypeId);
    if (!cargo) {
      reason('unknown_cargo_type', NEEDS_REVIEW, [s.shipmentId], { shipmentId: s.shipmentId, cargoTypeId: s.cargoTypeId });
      continue;
    }
    items.push({ s, cargo, name: localizedName(cargo.names, locale, cargo.id) });
  }

  // 1–2. Packaging and trailer suitability.
  for (const { s, cargo, name } of items) {
    const p = { shipmentId: s.shipmentId, cargo: name, packaging: s.packaging, trailer: trailerName, category: cargo.category };
    const option = cargo.transportOptions.find((o) => o.packaging === s.packaging);
    if (!option) reason('packaging_not_permitted', INCOMPATIBLE, [s.shipmentId], p);
    else if (!option.trailerCategories.includes(trailer.category)) reason('trailer_category_unsuitable', INCOMPATIBLE, [s.shipmentId], p);
    if (!trailer.supportedPackaging.includes(s.packaging)) reason('trailer_packaging_unsupported', INCOMPATIBLE, [s.shipmentId], p);
    if (!trailer.permittedCargoCategories.includes(cargo.category)) reason('trailer_cargo_category_not_permitted', INCOMPATIBLE, [s.shipmentId], p);
    if (cargo.dataConfidence === 'unknown') reason('data_unverified', NEEDS_REVIEW, [s.shipmentId], { cargo: name, confidence: cargo.dataConfidence });
    else if (cargo.dataConfidence !== 'verified_official_source') reason('data_unverified', INFO, [s.shipmentId], { cargo: name, confidence: cargo.dataConfidence });
  }

  // 3. Weight.
  let limitKg = overrides.maxPayloadKg ?? trailer.maxPayloadKg ?? null;
  let payloadSource = overrides.maxPayloadKg ? 'user_provided' : trailer.maxPayloadKg ? 'catalog' : null;
  if (limitKg === null && useDemoPayloadProfile) {
    limitKg = catalog.trailers.demoPayloadProfile.maxPayloadKg;
    payloadSource = 'demo_assumption';
    reason('payload_demo_profile', INFO, [], { limitKg });
  }
  const missingWeight = shipments.filter((s) => typeof s.weightKg !== 'number');
  missingWeight.forEach((s) => reason('weight_unknown', NEEDS_REVIEW, [s.shipmentId], { shipmentId: s.shipmentId }));
  const totalKg = shipments.reduce((sum, s) => sum + (s.weightKg ?? 0), 0);
  if (limitKg === null) reason('payload_limit_unknown', NEEDS_REVIEW, []);
  else if (totalKg > limitKg) reason('weight_exceeded', INCOMPATIBLE, shipments.map((s) => s.shipmentId), { totalKg: round1(totalKg), limitKg });
  else if (missingWeight.length === 0) reason('capacity_ok', INFO, [], { totalKg: round1(totalKg), limitKg });

  // 4–5. Space: pallet positions for palletised (or explicitly pallet-counted) cargo, volume for the rest.
  const palletBased = items.filter(({ s }) => s.packaging === 'palletized' || typeof s.palletPositions === 'number');
  const volumeBased = items.filter((it) => !palletBased.includes(it));

  const limitPallets = overrides.euroPallets ?? trailer.palletCapacity?.euroPallets ?? null;
  if (palletBased.length) {
    let totalPallets = 0;
    for (const { s } of palletBased) {
      if (typeof s.palletPositions !== 'number') reason('pallets_unknown', NEEDS_REVIEW, [s.shipmentId], { shipmentId: s.shipmentId });
      else totalPallets += s.palletPositions;
    }
    if (limitPallets === null) reason('trailer_pallets_unknown', NEEDS_REVIEW, []);
    else if (totalPallets > limitPallets) reason('pallets_exceeded', INCOMPATIBLE, palletBased.map((x) => x.s.shipmentId), { totalPallets, limitPallets });
  }

  const limitM3 = overrides.internalVolumeM3 ?? trailer.internalVolumeM3 ?? null;
  let totalM3 = volumeBased.length ? 0 : null;
  for (const { s, cargo } of volumeBased) {
    let m3 = typeof s.volumeM3 === 'number' ? s.volumeM3 : null;
    // Derive bulk volume from the LOWER bound of bulk density → conservative (largest) volume.
    if (m3 === null && s.packaging === 'bulk' && typeof s.weightKg === 'number' && cargo.bulkDensity?.minTPerM3) {
      m3 = s.weightKg / 1000 / cargo.bulkDensity.minTPerM3;
    }
    if (m3 === null) {
      reason('volume_unknown', NEEDS_REVIEW, [s.shipmentId], { shipmentId: s.shipmentId });
      totalM3 = null;
    } else if (totalM3 !== null) totalM3 += m3;
  }
  if (volumeBased.length) {
    if (limitM3 === null) reason('trailer_volume_unknown', NEEDS_REVIEW, []);
    else if (totalM3 !== null && totalM3 > limitM3) reason('volume_exceeded', INCOMPATIBLE, volumeBased.map((x) => x.s.shipmentId), { totalM3: round1(totalM3), limitM3 });
  }
  if (palletBased.length && volumeBased.length) reason('space_mixed_measures', NEEDS_REVIEW, []);

  // 6. Temperature.
  const ranges = [];
  for (const { s, cargo } of items) {
    if (s.temperatureRequirementC) ranges.push({ id: s.shipmentId, ...s.temperatureRequirementC });
    else if (cargo.temperature.status === 'required') ranges.push({ id: s.shipmentId, minC: cargo.temperature.minC, maxC: cargo.temperature.maxC });
    else if (cargo.temperature.status === 'unknown') reason('temperature_unknown', NEEDS_REVIEW, [s.shipmentId], { shipmentId: s.shipmentId });
  }
  if (ranges.length) {
    const minC = Math.max(...ranges.map((r) => r.minC));
    const maxC = Math.min(...ranges.map((r) => r.maxC));
    if (minC > maxC) reason('temperature_conflict', INCOMPATIBLE, ranges.map((r) => r.id));
    if (!trailer.temperatureControl.available) {
      reason('temperature_control_unavailable', INCOMPATIBLE, ranges.map((r) => r.id), { trailer: trailerName });
    } else if (minC <= maxC) {
      const tc = trailer.temperatureControl;
      if (tc.minC === null || tc.maxC === null) reason('temperature_range_unverified', NEEDS_REVIEW, ranges.map((r) => r.id), { minC, maxC });
      else if (minC < tc.minC || maxC > tc.maxC) reason('temperature_control_unavailable', INCOMPATIBLE, ranges.map((r) => r.id), { trailer: trailerName });
    }
  }

  // 7. Bulk mixing.
  const bulk = items.filter(({ s }) => s.packaging === 'bulk');
  if (bulk.length) {
    const types = [...new Set(bulk.map((b) => b.cargo.id))];
    if (types.length > 1 && trailer.undividedBody) {
      reason('bulk_mixing', INCOMPATIBLE, bulk.map((b) => b.s.shipmentId), {
        cargoList: types.map((id) => localizedName(catalog.cargoById.get(id).names, locale, id)).join(', '),
      });
    } else if (bulk.length > 1) {
      reason('bulk_same_type_multiple_owners', NEEDS_REVIEW, bulk.map((b) => b.s.shipmentId));
    }
    if (bulk.length < items.length) reason('bulk_with_other_packaging', INCOMPATIBLE, items.map((x) => x.s.shipmentId));
  }

  // 8. Hygiene and contamination (pairwise across distinct cargo types).
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      const ga = a.cargo.hygiene.group;
      const gb = b.cargo.hygiene.group;
      const ids = [a.s.shipmentId, b.s.shipmentId];
      const contaminant = CONTAMINANT_GROUPS[ga] && FOOD_FEED_GROUPS.has(gb) ? [a, b, CONTAMINANT_GROUPS[ga]]
        : CONTAMINANT_GROUPS[gb] && FOOD_FEED_GROUPS.has(ga) ? [b, a, CONTAMINANT_GROUPS[gb]]
        : (DUST_GROUPS.has(ga) && gb === 'fresh_produce') ? [a, b, 'dust']
        : (DUST_GROUPS.has(gb) && ga === 'fresh_produce') ? [b, a, 'dust'] : null;
      if (contaminant) {
        reason('contamination_risk', NEEDS_REVIEW, ids, { cargoA: contaminant[0].name, riskA: contaminant[2], cargoB: contaminant[1].name });
      } else if (ga !== gb || ga === 'unspecified') {
        reason('hygiene_unverified', NEEDS_REVIEW, ids, { cargoA: a.name, cargoB: b.name });
      }
    }
  }

  // 9. Special handling when combining.
  if (items.length > 1) {
    for (const { s, cargo } of items) {
      const flagged = cargo.specialConditions.filter((c) => REVIEW_WHEN_COMBINED.has(c));
      if (flagged.length) reason('special_handling', NEEDS_REVIEW, [s.shipmentId], { shipmentId: s.shipmentId, conditions: flagged.join(', ') });
    }
  }

  const status = reasons.some((r) => r.severity === INCOMPATIBLE)
    ? INCOMPATIBLE
    : reasons.some((r) => r.severity === NEEDS_REVIEW)
      ? NEEDS_REVIEW
      : COMPATIBLE;

  return {
    status,
    summary: localize(`compat.${status}`, {}, locale),
    disclaimer: localize('compat.disclaimer', {}, locale),
    reasons: reasons.map((r) => ({ ...r, messageKey: `reason.${r.code}`, message: localize(`reason.${r.code}`, r.params, locale) })),
    totals: {
      weightKg: totalKg,
      weightComplete: missingWeight.length === 0,
      volumeM3: totalM3 === null ? null : round1(totalM3),
      palletPositions: palletBased.reduce((s2, { s }) => s2 + (s.palletPositions ?? 0), 0),
    },
    limits: { maxPayloadKg: limitKg, payloadSource, internalVolumeM3: limitM3, euroPallets: limitPallets },
    trailer: { trailerId: trailer.id, category: trailer.category, model: trailer.model },
  };
}

/**
 * Trailer categories that every shipment could use, based on catalog transport options.
 * @returns {string[]}
 */
export function suggestTrailerCategories(shipments, catalog = loadCatalog()) {
  let common = null;
  for (const s of shipments) {
    const cargo = catalog.cargoById.get(s.cargoTypeId);
    const option = cargo?.transportOptions.find((o) => o.packaging === s.packaging);
    const cats = new Set(option?.trailerCategories ?? []);
    common = common === null ? cats : new Set([...common].filter((c) => cats.has(c)));
  }
  return [...(common ?? [])];
}
