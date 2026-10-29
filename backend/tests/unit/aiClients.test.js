import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGeminiClient, parseGeminiJson } from '../../src/services/ai/geminiClient.js';

// All payloads are synthetic fixtures; no network/paid call is ever made.

describe('Gemini response parsing', () => {
  it('extracts JSON from a candidate part', () => {
    const payload = { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"quantityKg":12000}' }] } }] };
    assert.deepEqual(parseGeminiJson(payload), { quantityKg: 12000 });
  });
  it('maps a block/refusal and incomplete response to typed errors', () => {
    assert.throws(() => parseGeminiJson({ promptFeedback: { blockReason: 'SAFETY' } }), (e) => e.code === 'AI_REFUSAL');
    assert.throws(() => parseGeminiJson({ candidates: [{ finishReason: 'MAX_TOKENS' }] }), (e) => e.code === 'AI_INCOMPLETE');
    assert.throws(() => parseGeminiJson({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'not json' }] } }] }), (e) => e.code === 'AI_BAD_RESPONSE');
  });
});

describe('Gemini client (mocked fetch)', () => {
  const okResponse = (obj) => ({ ok: true, status: 200, async text() { return ''; }, async json() { return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(obj) }] } }] }; } });

  it('sends the key and system prompt and returns parsed JSON (no key leak in body path)', async () => {
    let captured;
    const fetchImpl = async (url, opts) => { captured = { url, opts }; return okResponse({ grainType: 'wheat', quantityKg: 22000 }); };
    const callModel = createGeminiClient({ apiKey: 'secret-key', model: 'gemini-2.5-flash', baseUrl: 'https://example.test', timeoutMs: 5000, fetchImpl });
    const out = await callModel({ system: 'sys', user: '22 t wheat', maxTokens: 100 });
    assert.deepEqual(out, { grainType: 'wheat', quantityKg: 22000 });
    assert.match(captured.url, /models\/gemini-2\.5-flash:generateContent\?key=secret-key/);
    assert.equal(JSON.parse(captured.opts.body).systemInstruction.parts[0].text, 'sys');
  });

  it('maps HTTP errors to stable codes without leaking provider internals', async () => {
    const mk = (status) => createGeminiClient({ apiKey: 'k', model: 'm', baseUrl: 'https://x.test', timeoutMs: 5000, fetchImpl: async () => ({ ok: false, status, async json() { return { error: { message: 'secret internal detail' } }; } }) });
    await assert.rejects(mk(429)({ system: 's', user: 'u' }), (e) => e.code === 'AI_QUOTA');
    await assert.rejects(mk(403)({ system: 's', user: 'u' }), (e) => e.code === 'AI_AUTH');
    await assert.rejects(mk(500)({ system: 's', user: 'u' }).catch((e) => { assert.ok(!String(e.message).includes('secret internal detail')); throw e; }), (e) => e.code === 'AI_UPSTREAM');
  });
});
