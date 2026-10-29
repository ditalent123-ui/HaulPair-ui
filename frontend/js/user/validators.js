/**
 * Light format checks for the demo booking forms. Pure functions (no DOM), so
 * they are unit-tested in Node as well.
 */

export function parseAmountT(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const n = Number(String(value).trim().replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function isValidAmountT(n) {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0.1 && n <= 500;
}

/** Lithuanian company code: exactly 9 digits. */
export function isCompanyCode(v) {
  return /^\d{9}$/.test(String(v ?? '').replace(/\s/g, ''));
}

/** Lithuanian VAT code: "LT" + 9 or 12 digits. Optional (empty is valid). */
export function isVatCode(v) {
  const s = String(v ?? '').replace(/\s/g, '').toUpperCase();
  return s === '' || /^LT(\d{9}|\d{12})$/.test(s);
}

export function isPhone(v) {
  const s = String(v ?? '').replace(/[\s()-]/g, '');
  return /^\+?\d{8,15}$/.test(s);
}

export function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v ?? '').trim());
}

/** Returns { field: messageKey } for every invalid field of the legal-entity form. */
export function validateCompany(c) {
  const errors = {};
  if (!String(c.name ?? '').trim()) errors.name = 'company.err.name';
  if (!isCompanyCode(c.code)) errors.code = 'company.err.code';
  if (!isVatCode(c.vat)) errors.vat = 'company.err.vat';
  if (!String(c.address ?? '').trim()) errors.address = 'company.err.address';
  if (!String(c.contact ?? '').trim()) errors.contact = 'company.err.contact';
  if (!isPhone(c.phone)) errors.phone = 'company.err.phone';
  if (!isEmail(c.email)) errors.email = 'company.err.email';
  return errors;
}
