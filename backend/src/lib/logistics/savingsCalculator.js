import { localize } from './i18n.js';
import { allocateCents, fromCents, toCents } from './money.js';
import { createValidator } from './types.js';

/**
 * Savings and platform commission for shared transport.
 *
 *   grossSavings      = separateTransportTotal − combinedTransportTotal
 *   platformFee       = max(0, grossSavings) × commissionRate
 *   netClientSavings  = grossSavings − platformFee
 *
 * All arithmetic runs in integer cents. No fee is charged when savings are ≤ 0.
 */

/** Demonstration default commission (20 %). Configurable per call. */
export const DEFAULT_COMMISSION_RATE = 0.2;

export const ALLOCATION_METHODS = Object.freeze([
  'proportional_to_alternative',
  'weight',
  'tonne_km',
  'pallet_positions',
  'equal',
  'custom',
]);

function validateRate(v, commissionRate) {
  v.finiteNumber('commissionRate', commissionRate, { min: 0 });
  if (typeof commissionRate === 'number' && commissionRate >= 1) {
    v.add('commissionRate', 'too_large', 'must be a fraction below 1 (e.g. 0.2 for 20 %)');
  }
}

/** Fee on a savings amount in cents (half away from zero), never negative. */
function feeCents(savingsCents, commissionRate) {
  return savingsCents > 0 ? Math.round(savingsCents * commissionRate + 1e-9) : 0;
}

/**
 * Group-level savings.
 * @param {{ separateTransportTotalEur: number, combinedTransportTotalEur: number, commissionRate?: number,
 *           savingsBasis?: 'estimated'|'verified', servicesEquivalent?: boolean, locale?: string }} p
 */
export function calculateSavings({
  separateTransportTotalEur,
  combinedTransportTotalEur,
  commissionRate = DEFAULT_COMMISSION_RATE,
  savingsBasis = 'estimated',
  servicesEquivalent = true,
  locale,
}) {
  const v = createValidator();
  v.finiteNumber('separateTransportTotalEur', separateTransportTotalEur, { min: 0 });
  v.finiteNumber('combinedTransportTotalEur', combinedTransportTotalEur, { min: 0 });
  validateRate(v, commissionRate);
  if (!['estimated', 'verified'].includes(savingsBasis)) v.add('savingsBasis', 'invalid', 'must be "estimated" or "verified"');
  v.throwIfInvalid();

  const grossCents = toCents(separateTransportTotalEur) - toCents(combinedTransportTotalEur);
  const fee = servicesEquivalent ? feeCents(grossCents, commissionRate) : 0;
  const notes = [];
  if (grossCents <= 0) notes.push({ key: 'savings.no_savings', text: localize('savings.no_savings', {}, locale) });
  if (!servicesEquivalent) notes.push({ key: 'savings.services_not_equivalent', text: localize('savings.services_not_equivalent', {}, locale) });
  if (savingsBasis === 'estimated') notes.push({ key: 'savings.estimated', text: localize('savings.estimated', {}, locale) });

  return {
    separateTransportTotalEur: fromCents(toCents(separateTransportTotalEur)),
    combinedTransportTotalEur: fromCents(toCents(combinedTransportTotalEur)),
    grossSavingsEur: fromCents(grossCents),
    commissionRate,
    platformFeeEur: fromCents(fee),
    netClientSavingsEur: fromCents(grossCents - fee),
    hasSavings: grossCents > 0,
    feeChargeable: fee > 0,
    savingsBasis,
    servicesEquivalent,
    notes,
  };
}

function allocationWeights(method, participants, customShares) {
  switch (method) {
    case 'proportional_to_alternative':
      return participants.map((p) => p.independentAlternativeEur);
    case 'weight':
      return participants.map((p) => p.weightKg);
    case 'tonne_km':
      return participants.map((p) => p.tonneKm);
    case 'pallet_positions':
      return participants.map((p) => p.palletPositions);
    case 'equal':
      return participants.map(() => 1);
    case 'custom':
      return participants.map((p) => customShares[p.participantId]);
    default:
      return null;
  }
}

/**
 * Split a combined transport cost between participants and compute each one's
 * fee and savings against their own independent alternative.
 *
 * Default method 'proportional_to_alternative' gives every participant the same
 * percentage saving. Other methods can leave a participant worse off; that case
 * is flagged and fees are marked not chargeable for the whole arrangement.
 *
 * @param {{ combinedTransportTotalEur: number,
 *           participants: { participantId: string, independentAlternativeEur: number, weightKg?: number, tonneKm?: number, palletPositions?: number }[],
 *           method?: string, customShares?: Record<string, number>, commissionRate?: number,
 *           savingsBasis?: 'estimated'|'verified', locale?: string }} p
 */
export function allocateSharedTransport({
  combinedTransportTotalEur,
  participants,
  method = 'proportional_to_alternative',
  customShares = {},
  commissionRate = DEFAULT_COMMISSION_RATE,
  savingsBasis = 'estimated',
  locale,
}) {
  const v = createValidator();
  v.finiteNumber('combinedTransportTotalEur', combinedTransportTotalEur, { min: 0 });
  validateRate(v, commissionRate);
  if (!ALLOCATION_METHODS.includes(method)) v.add('method', 'invalid', `must be one of ${ALLOCATION_METHODS.join(', ')}`);
  if (!Array.isArray(participants) || participants.length < 2) {
    v.add('participants', 'too_few', 'at least two participants are required');
  } else {
    const ids = new Set();
    participants.forEach((p, i) => {
      if (typeof p?.participantId !== 'string' || !p.participantId) v.add(`participants.${i}.participantId`, 'required', 'is required');
      if (ids.has(p?.participantId)) v.add(`participants.${i}.participantId`, 'duplicate', 'must be unique');
      ids.add(p?.participantId);
      v.finiteNumber(`participants.${i}.independentAlternativeEur`, p?.independentAlternativeEur, { min: 0 });
    });
    const weights = ALLOCATION_METHODS.includes(method) ? allocationWeights(method, participants, customShares) : [];
    weights.forEach((w, i) => {
      if (typeof w !== 'number' || !Number.isFinite(w) || w < 0) v.add(`participants.${i}.${method}`, 'invalid', `allocation basis for "${method}" must be a number ≥ 0`);
    });
    if (weights.length && weights.every((w) => typeof w === 'number' && w >= 0) && !weights.some((w) => w > 0)) {
      v.add('method', 'zero_basis', 'allocation basis sums to zero');
    }
    if (method === 'custom') {
      const sum = participants.reduce((s, p) => s + (customShares[p.participantId] ?? 0), 0);
      if (Math.abs(sum - 1) > 1e-9) v.add('customShares', 'invalid_sum', 'custom shares must sum to 1');
    }
  }
  v.throwIfInvalid();

  const combinedCents = toCents(combinedTransportTotalEur);
  const allocated = allocateCents(combinedCents, allocationWeights(method, participants, customShares));

  const rows = participants.map((p, i) => {
    const alternativeCents = toCents(p.independentAlternativeEur);
    const savingsCents = alternativeCents - allocated[i];
    const fee = feeCents(savingsCents, commissionRate);
    return {
      participantId: p.participantId,
      independentAlternativeEur: fromCents(alternativeCents),
      allocatedTransportCostEur: fromCents(allocated[i]),
      grossSavingsEur: fromCents(savingsCents),
      platformFeeEur: fromCents(fee),
      finalPriceEur: fromCents(allocated[i] + fee),
      netSavingsEur: fromCents(savingsCents - fee),
      paysMoreThanAlternative: savingsCents < 0,
    };
  });

  const separateCents = rows.reduce((s, r) => s + toCents(r.independentAlternativeEur), 0);
  const groupGrossCents = separateCents - combinedCents;
  const worseOff = rows.filter((r) => r.paysMoreThanAlternative);
  const status = groupGrossCents <= 0 ? 'no_savings' : worseOff.length ? 'not_mutually_beneficial' : 'mutually_beneficial';
  const feesChargeable = status === 'mutually_beneficial';
  const totalFeeCents = feesChargeable ? rows.reduce((s, r) => s + toCents(r.platformFeeEur), 0) : 0;

  const notes = [];
  if (status === 'no_savings') notes.push({ key: 'savings.no_savings', text: localize('savings.no_savings', {}, locale) });
  for (const r of worseOff) {
    notes.push({
      key: 'savings.participant_worse_off',
      participantId: r.participantId,
      text: localize('savings.participant_worse_off', { participantId: r.participantId, overEur: (-r.grossSavingsEur).toFixed(2) }, locale),
    });
  }
  if (status === 'not_mutually_beneficial') notes.push({ key: 'savings.not_mutually_beneficial', text: localize('savings.not_mutually_beneficial', {}, locale) });
  if (savingsBasis === 'estimated') notes.push({ key: 'savings.estimated', text: localize('savings.estimated', {}, locale) });

  return {
    method,
    commissionRate,
    savingsBasis,
    status,
    feesChargeable,
    separateTransportTotalEur: fromCents(separateCents),
    combinedTransportTotalEur: fromCents(combinedCents),
    grossSavingsEur: fromCents(groupGrossCents),
    totalPlatformFeeEur: fromCents(totalFeeCents),
    netClientSavingsEur: fromCents(groupGrossCents - totalFeeCents),
    // When fees are not chargeable, per-participant fees are provisional only.
    participants: rows.map((r) => (feesChargeable ? r : { ...r, platformFeeEur: 0, finalPriceEur: r.allocatedTransportCostEur, netSavingsEur: r.grossSavingsEur, provisionalPlatformFeeEur: r.platformFeeEur })),
    notes,
  };
}
