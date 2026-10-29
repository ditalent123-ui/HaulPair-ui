import { AiUnavailableError } from './aiErrors.js';

/**
 * Minimal Google Gemini (generativelanguage) client for the shipment parser.
 * Server-side only; GEMINI_API_KEY never reaches the browser, logs or errors.
 *
 * COST NOTE: a configured key is NOT proof that usage is free. Gemini free-tier
 * eligibility depends on the project, model, region (incl. EU terms) and Google's
 * current terms, which must be verified in the owner's own Google AI account.
 * This client makes NO paid fallback and is only reached when AI_ENABLED=true and a
 * GEMINI_API_KEY is set. Tests inject a fake callModel, so no real call is made here.
 *
 * We request `responseMimeType: application/json` and validate the parsed object
 * ourselves (the shipment parser normalises every field), which avoids provider
 * schema-dialect mismatches while still returning structured data.
 *
 * API: POST {base}/v1beta/models/{model}:generateContent?key=KEY
 * Reference: https://ai.google.dev/api/generate-content
 */
export function createGeminiClient({ apiKey, model, baseUrl, timeoutMs, fetchImpl = globalThis.fetch }) {
  /**
   * responseFormat 'json' (default) returns the parsed JSON object.
   * responseFormat 'text' returns { text, sources } — used with googleSearch
   * grounding, which does not combine with a JSON response MIME type.
   */
  return async function callModel({ system, user, maxTokens = 700, responseFormat = 'json', googleSearch = false }) {
    const url = `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const generationConfig = { temperature: 0, maxOutputTokens: maxTokens };
    if (responseFormat === 'json') generationConfig.responseMimeType = 'application/json';
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig,
    };
    if (googleSearch) body.tools = [{ google_search: {} }];

    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      throw new AiUnavailableError(timedOut ? 'The AI service timed out.' : 'The AI service could not be reached.', {
        code: timedOut ? 'AI_TIMEOUT' : 'AI_UNREACHABLE',
        status: timedOut ? 504 : 502,
        cause: err,
      });
    }

    if (response.status === 401 || response.status === 403) {
      throw new AiUnavailableError('The AI API key was rejected.', { code: 'AI_AUTH', status: 502 });
    }
    if (response.status === 429) {
      throw new AiUnavailableError('The AI quota or rate limit was reached.', { code: 'AI_QUOTA', status: 503 });
    }
    if (!response.ok) {
      throw new AiUnavailableError('The AI service returned an error.', { code: 'AI_UPSTREAM', status: 502 });
    }

    let payload;
    try {
      payload = await response.json();
    } catch (err) {
      throw new AiUnavailableError('The AI service returned an unreadable response.', { code: 'AI_BAD_RESPONSE', cause: err });
    }
    return responseFormat === 'text' ? parseGeminiText(payload) : parseGeminiJson(payload);
  };
}

function checkCandidate(payload) {
  if (payload?.promptFeedback?.blockReason) {
    throw new AiUnavailableError('The AI declined to answer.', { code: 'AI_REFUSAL', status: 422 });
  }
  const candidate = payload?.candidates?.[0];
  if (candidate?.finishReason === 'MAX_TOKENS') {
    throw new AiUnavailableError('The AI response was incomplete.', { code: 'AI_INCOMPLETE', status: 502 });
  }
  if (candidate && candidate.finishReason && candidate.finishReason !== 'STOP') {
    throw new AiUnavailableError('The AI declined to answer.', { code: 'AI_REFUSAL', status: 422 });
  }
  return candidate;
}

/** Plain-text answer plus any Google Search grounding sources ({ title, uri }). */
export function parseGeminiText(payload) {
  const candidate = checkCandidate(payload);
  const text = candidate?.content?.parts?.map((p) => p?.text).filter(Boolean).join('').trim() ?? '';
  if (!text) throw new AiUnavailableError('The AI response was empty.', { code: 'AI_BAD_RESPONSE' });
  const chunks = candidate?.groundingMetadata?.groundingChunks ?? [];
  const sources = chunks
    .map((c) => c?.web)
    .filter((w) => w && typeof w.uri === 'string')
    .map((w) => ({ title: typeof w.title === 'string' ? w.title : null, uri: w.uri }));
  return { text, sources };
}

export function parseGeminiJson(payload) {
  if (payload?.promptFeedback?.blockReason) {
    throw new AiUnavailableError('The AI declined to answer.', { code: 'AI_REFUSAL', status: 422 });
  }
  const candidate = payload?.candidates?.[0];
  if (candidate?.finishReason === 'MAX_TOKENS') {
    throw new AiUnavailableError('The AI response was incomplete.', { code: 'AI_INCOMPLETE', status: 502 });
  }
  if (candidate && candidate.finishReason && candidate.finishReason !== 'STOP') {
    throw new AiUnavailableError('The AI declined to answer.', { code: 'AI_REFUSAL', status: 422 });
  }
  const text = candidate?.content?.parts?.map((p) => p?.text).filter(Boolean).join('') ?? '';
  if (text) {
    try {
      return JSON.parse(text);
    } catch {
      /* fall through */
    }
  }
  throw new AiUnavailableError('The AI response did not contain usable structured data.', { code: 'AI_BAD_RESPONSE' });
}
