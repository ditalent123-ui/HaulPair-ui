import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { normalizePriceToEurPerL } from '../../src/services/fuelPrice/fuelPriceService.js';

const ADMIN = 'admin-token-123';
const env = { FUEL_PRICE_ADMIN_TOKEN: ADMIN };

const today = new Date().toISOString().slice(0, 10);
const importBody = (over = {}) => ({
  fuelType: 'diesel',
  price: '1,459',
  unit: 'eur_per_l',
  priceDate: today,
  priceBasis: 'Lithuania retail average, VAT incl.',
  sourceName: 'Lietuvos energetikos agentūra (LEA)',
  sourceUrl: 'https://www.ena.lt/degalu-kainos-degalinese/',
  ...over,
});

describe('unit normalisation', () => {
  it('converts units to EUR/l and supports a decimal comma', () => {
    assert.equal(normalizePriceToEurPerL('1,459', 'eur_per_l'), 1.459);
    assert.equal(normalizePriceToEurPerL(1459, 'eur_per_1000l'), 1.459);
    assert.equal(normalizePriceToEurPerL('145,9', 'ct_per_l'), 1.459);
  });
  it('rejects implausible converted values', () => {
    assert.throws(() => normalizePriceToEurPerL('1459', 'eur_per_l')); // > 5 EUR/l
    assert.throws(() => normalizePriceToEurPerL('0', 'eur_per_l'));
  });
});

describe('fuel price endpoints', () => {
  it('reports no suggestion before any import (manual entry still works client-side)', async () => {
    const { app } = buildTestApp({ env });
    const res = await request(app).get('/api/fuel-price?fuelType=diesel');
    assert.equal(res.status, 200);
    assert.equal(res.body.data.available, false);
    assert.equal(res.body.data.reason, 'no_data');
  });

  it('refuses import without a valid admin token', async () => {
    const { app } = buildTestApp({ env });
    assert.equal((await request(app).post('/api/fuel-price/import').send(importBody())).status, 403);
    assert.equal((await request(app).post('/api/fuel-price/import').set('X-Admin-Token', 'wrong').send(importBody())).status, 403);
  });

  it('disables import entirely when no admin token is configured', async () => {
    const { app } = buildTestApp();
    const res = await request(app).post('/api/fuel-price/import').set('X-Admin-Token', 'anything').send(importBody());
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, 'FUEL_ADMIN_DISABLED');
  });

  it('imports a verified diesel record and serves it as a shared suggestion', async () => {
    const { app } = buildTestApp({ env });
    const imp = await request(app).post('/api/fuel-price/import').set('X-Admin-Token', ADMIN).send(importBody({ price: 1459, unit: 'eur_per_1000l' }));
    assert.equal(imp.status, 201, JSON.stringify(imp.body));
    assert.equal(imp.body.data.priceEurPerL, 1.459);

    const sug = await request(app).get('/api/fuel-price?fuelType=diesel');
    assert.equal(sug.body.data.available, true);
    assert.equal(sug.body.data.priceEurPerL, 1.459);
    assert.equal(sug.body.data.priceDate, today);
    assert.equal(sug.body.data.sourceName, 'Lietuvos energetikos agentūra (LEA)');
    assert.equal(sug.body.data.stale, false);
    assert.equal(sug.body.data.label, 'source_suggested');
  });

  it('does not offer a diesel price for an unsupported fuel type', async () => {
    const { app } = buildTestApp({ env });
    await request(app).post('/api/fuel-price/import').set('X-Admin-Token', ADMIN).send(importBody());
    const res = await request(app).get('/api/fuel-price?fuelType=lng');
    assert.equal(res.body.data.available, false);
    assert.equal(res.body.data.reason, 'unsupported_fuel');
  });

  it('marks an old price as stale (status "could not update")', async () => {
    const { app } = buildTestApp({ env: { ...env, FUEL_PRICE_MAX_AGE_HOURS: '24' } });
    await request(app).post('/api/fuel-price/import').set('X-Admin-Token', ADMIN).send(importBody({ priceDate: '2026-10-01' }));
    const res = await request(app).get('/api/fuel-price?fuelType=diesel');
    assert.equal(res.body.data.available, true);
    assert.equal(res.body.data.stale, true);
    assert.ok(res.body.data.ageHours > 24);
  });

  it('rejects a bad price date and a future date', async () => {
    const { app } = buildTestApp({ env });
    assert.equal((await request(app).post('/api/fuel-price/import').set('X-Admin-Token', ADMIN).send(importBody({ priceDate: 'not-a-date' }))).status, 400);
    assert.equal((await request(app).post('/api/fuel-price/import').set('X-Admin-Token', ADMIN).send(importBody({ priceDate: '2999-01-01' }))).status, 400);
  });
});
