import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';

// Enable the AI feature in tests; the model call itself is always a mock (no paid call).
// Provider is Google Gemini; AI_ENABLED=false (default) keeps it off.
const aiEnv = { AI_ENABLED: 'true', GEMINI_API_KEY: 'test-gemini-key' };

/** A fake callModel that returns whatever `out` is, or throws `err`. Records calls. */
function fakeModel(out, err) {
  const calls = [];
  const fn = async (args) => {
    calls.push(args);
    if (err) throw err;
    return typeof out === 'function' ? out(args) : out;
  };
  fn.calls = calls;
  return fn;
}

const post = (app, text) => request(app).post('/api/ai/parse-shipment').send({ text });

describe('POST /api/ai/parse-shipment', () => {
  it('is disabled by default and makes no model call', async () => {
    const model = fakeModel({});
    const { app } = buildTestApp({ aiCallModel: model }); // AI_ENABLED not set
    const res = await post(app, 'Vežti 12 t kviečių iš Panevėžio į Klaipėdą');
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, 'AI_DISABLED');
    assert.equal(model.calls.length, 0);
  });

  it('stays off when enabled but no Gemini key is set (no provider call)', async () => {
    const model = fakeModel({});
    const { app } = buildTestApp({ env: { AI_ENABLED: 'true' }, aiCallModel: model }); // no GEMINI_API_KEY
    const res = await post(app, '22 t kviečių');
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, 'AI_DISABLED');
    const cfg = await request(app).get('/api/config');
    assert.equal(cfg.body.data.ai.available, false);
    assert.equal(cfg.body.data.ai.disabledReason, 'no_api_key');
    assert.equal(model.calls.length, 0);
  });

  it('reports availability and provider through /api/config when ready', async () => {
    const { app } = buildTestApp({ env: aiEnv, aiCallModel: fakeModel({}) });
    const cfg = await request(app).get('/api/config');
    assert.equal(cfg.body.data.ai.available, true);
    assert.equal(cfg.body.data.ai.maxInputChars, 2000);
  });

  it('extracts tonnes as kilograms (12 t → 12000 kg) with a stated unit', async () => {
    const model = fakeModel({
      originText: 'Panevėžys', destinationText: 'Klaipėda', grainType: 'wheat',
      quantityKg: 12000, quantityUnitStated: true, densityTPerM3: 0.72,
      returnMode: 'none', returnQuantityKg: null, notes: null,
    });
    const { app } = buildTestApp({ env: aiEnv, aiCallModel: model });
    const res = await post(app, 'Vežti 12 t kviečių iš Panevėžio į Klaipėdą, piltinis tankis 0,72 t/m³');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.data.suggestion.quantityKg, 12000);
    assert.equal(res.body.data.suggestion.densityTPerM3, 0.72);
    assert.equal(res.body.data.suggestion.grainType, 'wheat');
    assert.deepEqual(res.body.data.missing, []);
  });

  it('keeps 12000 kg as 12000 kg', async () => {
    const model = fakeModel({ originText: 'Kaunas', destinationText: 'Klaipėda', grainType: 'barley', quantityKg: 12000, quantityUnitStated: true, densityTPerM3: null, returnMode: 'none', returnQuantityKg: null, notes: null });
    const { app } = buildTestApp({ env: aiEnv, aiCallModel: model });
    const res = await post(app, '12000 kg miežių Kaunas-Klaipėda');
    assert.equal(res.body.data.suggestion.quantityKg, 12000);
    assert.equal(res.body.data.suggestion.densityTPerM3, null);
  });

  it('does not guess an unstated quantity unit (marks quantity missing)', async () => {
    const model = fakeModel({ originText: 'Vilnius', destinationText: 'Klaipėda', grainType: 'wheat', quantityKg: 12000, quantityUnitStated: false, densityTPerM3: null, returnMode: 'none', returnQuantityKg: null, notes: null });
    const { app } = buildTestApp({ env: aiEnv, aiCallModel: model });
    const res = await post(app, '12000 kviečių Vilnius-Klaipėda');
    assert.equal(res.body.data.suggestion.quantityKg, null);
    assert.ok(res.body.data.missing.includes('quantityKg'));
  });

  it('keeps an explicit 0 density and never infers density from grain type', async () => {
    const model = fakeModel({ originText: 'Vilnius', destinationText: 'Kaunas', grainType: 'oats', quantityKg: 20000, quantityUnitStated: true, densityTPerM3: 0, returnMode: 'none', returnQuantityKg: null, notes: null });
    const { app } = buildTestApp({ env: aiEnv, aiCallModel: model });
    const res = await post(app, '20 t avižų Vilnius-Kaunas, tankio nenurodau');
    assert.equal(res.body.data.suggestion.densityTPerM3, 0);
  });

  it('handles a loaded return trip', async () => {
    const model = fakeModel({ originText: 'Panevėžys', destinationText: 'Klaipėda', grainType: 'wheat', quantityKg: 22000, quantityUnitStated: true, densityTPerM3: null, returnMode: 'loaded', returnQuantityKg: 18000, notes: 'pirmadienį' });
    const { app } = buildTestApp({ env: aiEnv, aiCallModel: model });
    const res = await post(app, '22 t kviečių pirmyn, 18 t atgal');
    assert.equal(res.body.data.suggestion.returnMode, 'loaded');
    assert.equal(res.body.data.suggestion.returnQuantityKg, 18000);
    assert.equal(res.body.data.suggestion.notes, 'pirmadienį');
  });

  it('reports missing required fields for a vague description', async () => {
    const model = fakeModel({ originText: null, destinationText: 'Klaipėda', grainType: null, quantityKg: null, quantityUnitStated: false, densityTPerM3: null, returnMode: null, returnQuantityKg: null, notes: null });
    const { app } = buildTestApp({ env: aiEnv, aiCallModel: model });
    const res = await post(app, 'kažką į Klaipėdą');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.missing.sort(), ['grainType', 'origin', 'quantityKg']);
  });

  it('rejects empty and over-long input (400, no model call)', async () => {
    const model = fakeModel({});
    const { app } = buildTestApp({ env: aiEnv, aiCallModel: model });
    assert.equal((await post(app, '')).status, 400);
    assert.equal((await post(app, 'x'.repeat(2500))).status, 400); // over default 2000
    assert.equal(model.calls.length, 0);
  });

  it('normalises a model refusal to a stable error without changing anything', async () => {
    const { AiUnavailableError } = await import('../../src/services/ai/aiErrors.js');
    const model = fakeModel(null, new AiUnavailableError('refused', { code: 'AI_REFUSAL', status: 422 }));
    const { app } = buildTestApp({ env: aiEnv, aiCallModel: model });
    const res = await post(app, '22 t kviečių');
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'AI_REFUSAL');
  });

  it('stops at the configured daily limit without further model calls', async () => {
    const model = fakeModel({ originText: 'A', destinationText: 'B', grainType: 'wheat', quantityKg: 10000, quantityUnitStated: true, densityTPerM3: null, returnMode: 'none', returnQuantityKg: null, notes: null });
    const { app } = buildTestApp({ env: { ...aiEnv, AI_DAILY_MAX: '2' }, aiCallModel: model });
    assert.equal((await post(app, '10 t kviečių A-B')).status, 200);
    assert.equal((await post(app, '10 t kviečių A-B')).status, 200);
    const third = await post(app, '10 t kviečių A-B');
    assert.equal(third.status, 503);
    assert.equal(model.calls.length, 2);
  });
});
