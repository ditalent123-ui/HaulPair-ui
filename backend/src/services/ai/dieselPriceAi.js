import { AiUnavailableError } from './aiErrors.js';

/**
 * AI-managed diesel price input (the ONLY input the language model manages).
 *
 * Gemini is asked, with Google Search grounding, for the current Lithuanian
 * retail average diesel price, preferably the Lithuanian Energy Agency (LEA,
 * ena.lt) daily figure. The model only reports a number + date + publisher;
 * the backend parses and validates it (sanity range, date) and all pricing
 * arithmetic stays in deterministic code.
 */

export const DIESEL_SANITY_EUR_PER_L = Object.freeze({ min: 1.0, max: 3.5 });

const SYSTEM = [
  'You report the current average retail price of diesel fuel in Lithuania in EUR per litre (VAT included).',
  'Use Google Search. Prefer the Lithuanian Energy Agency (Lietuvos energetikos agentūra, ena.lt) daily average; otherwise a reputable Lithuanian news report citing it.',
  'Answer with exactly one line and nothing else:',
  'PRICE=<number with dot decimal>;DATE=<YYYY-MM-DD the price refers to>;SOURCE=<publisher name>;KIND=<source|estimate>',
  'Use KIND=estimate only if no published figure from the last 7 days is found. If you cannot give a figure, answer PRICE=NONE.',
].join('\n');

export function parseDieselAnswer(text) {
  const line = String(text).split(/\r?\n/).find((l) => /PRICE\s*=/.test(l)) ?? '';
  const get = (k) => line.match(new RegExp(`${k}\\s*=\\s*([^;]+)`))?.[1]?.trim() ?? null;
  const priceRaw = get('PRICE');
  if (!priceRaw || /NONE/i.test(priceRaw)) return null;
  const eurPerL = Number(priceRaw.replace(',', '.'));
  const date = get('DATE');
  return {
    eurPerL: Number.isFinite(eurPerL) ? Math.round(eurPerL * 1000) / 1000 : NaN,
    priceDate: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    sourceName: get('SOURCE'),
    kind: /estimate/i.test(get('KIND') ?? '') ? 'estimate' : 'source',
  };
}

/** Throws AiUnavailableError with a stable code when the answer is unusable. */
export function validateDieselAnswer(parsed, { now = Date.now(), maxAgeDays = 14 } = {}) {
  if (!parsed) throw new AiUnavailableError('The AI found no current diesel price.', { code: 'AI_NO_DATA', status: 502 });
  const { min, max } = DIESEL_SANITY_EUR_PER_L;
  if (!(parsed.eurPerL >= min && parsed.eurPerL <= max)) {
    throw new AiUnavailableError('The AI diesel price failed the sanity range check.', { code: 'AI_OUT_OF_RANGE', status: 502 });
  }
  const today = new Date(now).toISOString().slice(0, 10);
  const date = parsed.priceDate ?? today;
  const ageDays = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000;
  if (ageDays < -1 || ageDays > maxAgeDays) {
    throw new AiUnavailableError('The AI diesel price date is not current.', { code: 'AI_STALE', status: 502 });
  }
  return { ...parsed, priceDate: date };
}

export function createDieselPriceAi({ callModel, now = () => Date.now() }) {
  return {
    async fetchCurrent() {
      const today = new Date(now()).toISOString().slice(0, 10);
      const { text, sources } = await callModel({
        system: SYSTEM,
        user: `Šiandien ${today}. Kokia dabartinė vidutinė dyzelino kaina Lietuvos degalinėse (EUR/l)?`,
        responseFormat: 'text',
        googleSearch: true,
        maxTokens: 200,
      });
      const valid = validateDieselAnswer(parseDieselAnswer(text), { now: now() });
      const top = sources?.[0];
      return {
        ...valid,
        sourceName: valid.kind === 'estimate' ? 'Gemini įvertis' : (valid.sourceName || top?.title || 'Gemini (Google paieška)'),
        sourceUrl: top?.uri ?? 'https://ai.google.dev/gemini-api/docs/google-search',
      };
    },
  };
}
