/**
 * Monetary helpers. Amounts that are added, split or compared are handled as
 * integer euro cents to avoid floating-point drift; conversion back to euros
 * happens only at the edges.
 */

/** Euros → integer cents, rounding half away from zero. */
export function toCents(eur) {
  return Math.sign(eur) * Math.round(Math.abs(eur) * 100 + 1e-9);
}

export function fromCents(cents) {
  return cents / 100;
}

/** Round a euro amount to whole cents (half away from zero). */
export function roundEur(eur) {
  return fromCents(toCents(eur));
}

/**
 * Split `totalCents` in proportion to `weights` using the largest-remainder
 * method, so the parts always add up exactly to the total.
 * @param {number} totalCents  integer
 * @param {number[]} weights   non-negative, at least one > 0
 * @returns {number[]} integer cents per weight
 */
export function allocateCents(totalCents, weights) {
  const sum = weights.reduce((s, w) => s + w, 0);
  const raw = weights.map((w) => (totalCents * w) / sum);
  const floors = raw.map(Math.floor);
  let remainder = totalCents - floors.reduce((s, c) => s + c, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; remainder > 0; k = (k + 1) % order.length, remainder--) floors[order[k].i] += 1;
  return floors;
}
