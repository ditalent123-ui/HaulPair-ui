import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildTestApp, calculationBody, KLAIPEDA, VILNIUS } from '../helpers/testApp.js';

const USER = 'tester';
const PASS = 'shared-prototype-pass';
const authEnv = { AUTH_ENABLED: 'true', AUTH_USERNAME: USER, AUTH_PASSWORD: PASS };

// supertest helper: authenticated, same-origin state-changing request.
const authed = (r) => r.auth(USER, PASS).set('X-Requested-With', 'XMLHttpRequest');

describe('access protection (shared HTTP Basic)', () => {
  it('blocks ALL data and provider endpoints without credentials', async () => {
    const { app, provider } = buildTestApp({ env: authEnv });
    const cases = [
      ['get', '/api/calculations'],
      ['get', '/api/calculations/00000000-0000-0000-0000-000000000000'],
      ['get', '/api/activity'],
      ['get', '/api/trucks'],
      ['get', '/api/geocode?q=Vilnius'],
      ['post', '/api/routes'],
      ['post', '/api/calculations'],
      ['delete', '/api/calculations/00000000-0000-0000-0000-000000000000'],
    ];
    for (const [method, path] of cases) {
      const res = await request(app)[method](path).send(method === 'post' ? {} : undefined);
      assert.equal(res.status, 401, `${method} ${path} → ${res.status}`);
      assert.equal(res.body.error.code, 'UNAUTHORIZED');
    }
    // No paid provider call happened for any anonymous request.
    assert.equal(provider.calls.length, 0);
  });

  it('a wrong password is rejected with a Basic challenge and leaks nothing', async () => {
    const { app } = buildTestApp({ env: authEnv });
    const res = await request(app).get('/api/trucks').auth(USER, 'wrong-password');
    assert.equal(res.status, 401);
    assert.match(res.headers['www-authenticate'] ?? '', /^Basic realm=/);
    assert.ok(!JSON.stringify(res.body).includes(PASS));
  });

  it('keeps the health check public but minimal', async () => {
    const { app } = buildTestApp({ env: authEnv });
    const res = await request(app).get('/api/health');
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.body.data), ['status']);
  });

  it('allows the full flow with valid credentials', async () => {
    const { app } = buildTestApp({ env: authEnv });
    const route = await authed(request(app).post('/api/routes')).send({ origin: VILNIUS, destination: KLAIPEDA });
    assert.equal(route.status, 200, JSON.stringify(route.body));
    const est = await authed(request(app).post('/api/calculations/estimate')).send(calculationBody(route.body.data.routeToken));
    assert.equal(est.status, 200, JSON.stringify(est.body));
    const list = await request(app).get('/api/calculations').auth(USER, PASS);
    assert.equal(list.status, 200);
    const cfg = await request(app).get('/api/config').auth(USER, PASS);
    assert.equal(cfg.body.data.accessProtection, true);
  });

  it('config never exposes secrets even when authenticated', async () => {
    const { app } = buildTestApp({ env: { ...authEnv, ORS_API_KEY: 'secret-ors-key', GEMINI_API_KEY: 'secret-gemini-key' } });
    const res = await request(app).get('/api/config').auth(USER, PASS);
    const body = JSON.stringify(res.body);
    assert.ok(!body.includes('secret-ors-key'));
    assert.ok(!body.includes('secret-gemini-key'));
    assert.ok(!body.includes(PASS));
  });
});

describe('CSRF protection for state-changing requests', () => {
  it('blocks a cross-site state-changing request (no same-site signal, no custom header)', async () => {
    const { app, provider } = buildTestApp({ env: authEnv });
    const res = await request(app).post('/api/routes').auth(USER, PASS).send({ origin: VILNIUS, destination: KLAIPEDA });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'CSRF_BLOCKED');
    assert.equal(provider.calls.length, 0);
  });

  it('allows a same-origin fetch (Sec-Fetch-Site: same-origin)', async () => {
    const { app } = buildTestApp({ env: authEnv });
    const res = await request(app).post('/api/routes').auth(USER, PASS).set('Sec-Fetch-Site', 'same-origin').send({ origin: VILNIUS, destination: KLAIPEDA });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  });
});

describe('shared external-service daily ceiling', () => {
  it('stops calling the provider once the shared daily cap is reached', async () => {
    const { app, provider } = buildTestApp({ env: { ...authEnv, EXTERNAL_DAILY_MAX: '2' } });
    // Distinct destinations so each allowed call actually reaches the provider (cache misses).
    const call = (destination) => authed(request(app).post('/api/routes')).send({ origin: VILNIUS, destination });
    assert.equal((await call(KLAIPEDA)).status, 200);
    assert.equal((await call({ lat: 54.8985, lon: 23.9036, label: 'Kaunas' })).status, 200);
    const third = await call({ lat: 55.9349, lon: 23.3137, label: 'Šiauliai' });
    assert.equal(third.status, 503);
    assert.equal(third.body.error.code, 'EXTERNAL_LIMIT');
    // The third request never reached the provider.
    assert.equal(provider.calls.length, 2);
  });
});
