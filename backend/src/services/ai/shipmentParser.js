import { z } from 'zod';
import { AiUnavailableError } from './aiErrors.js';
import { AppError } from '../../utils/errors.js';

/**
 * "Describe your shipment" — a narrow, data-extraction-only AI helper.
 *
 * It turns a free-text route/cargo description into a STRUCTURED SUGGESTION that
 * the user reviews and explicitly applies to the form. It never calculates,
 * saves, geocodes or fabricates coordinates, and it never infers a bulk density
 * from the grain type. Missing values are null. Quantities are in kilograms;
 * an un-stated unit is left null (not guessed).
 */

export class AiDisabledError extends AppError {
  constructor(reason) {
    super('AI is not configured.', { status: 503, code: 'AI_DISABLED' });
    this.expose = true;
    this.reason = reason;
  }
}

const RETURN_MODES = ['none', 'empty', 'loaded'];

export function buildSchema(grainTypes) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      originText: { type: ['string', 'null'], description: 'Start place name as written, or null.' },
      destinationText: { type: ['string', 'null'], description: 'Destination place name as written, or null.' },
      grainType: { type: ['string', 'null'], enum: [...grainTypes, null] },
      quantityKg: { type: ['number', 'null'], description: 'Cargo mass in kilograms; null if no explicit unit was given.' },
      quantityUnitStated: { type: 'boolean', description: 'True only if the text gave an explicit mass unit (kg or t).' },
      densityTPerM3: { type: ['number', 'null'], description: 'Bulk density t/m³ if explicitly stated (0 allowed), else null. Never inferred from grain type.' },
      returnMode: { type: ['string', 'null'], enum: [...RETURN_MODES, null] },
      returnQuantityKg: { type: ['number', 'null'] },
      notes: { type: ['string', 'null'], description: 'Dates or other requests the form does not support.' },
    },
    required: [
      'originText',
      'destinationText',
      'grainType',
      'quantityKg',
      'quantityUnitStated',
      'densityTPerM3',
      'returnMode',
      'returnQuantityKg',
      'notes',
    ],
  };
}

function buildSystemPrompt(grainTypes) {
  return [
    'You extract structured shipment data for a Lithuanian grain-haulage planner.',
    'Return ONLY the JSON object required by the schema. Do not calculate costs, routes or coordinates.',
    'Quantities must be in kilograms. If the text says tonnes (t), convert to kg (×1000) and set quantityUnitStated=true.',
    'If a number has no explicit mass unit, set quantityKg=null and quantityUnitStated=false — never guess the unit.',
    'Bulk density (t/m³) only if explicitly stated; 0 is allowed; otherwise null. NEVER infer density from the grain type.',
    `Allowed grainType values: ${grainTypes.join(', ')}. If unclear, use null.`,
    'Place names: copy what the user wrote (the user confirms them later via map search). Do not invent coordinates.',
    'Lithuanian text and a decimal comma are common (e.g. "0,72" means 0.72). Missing values are null.',
  ].join(' ');
}

const modelOutputSchema = z
  .object({
    originText: z.string().trim().min(1).max(200).nullish(),
    destinationText: z.string().trim().min(1).max(200).nullish(),
    grainType: z.string().nullish(),
    quantityKg: z.number().finite().nullish(),
    quantityUnitStated: z.boolean().default(false),
    densityTPerM3: z.number().finite().nullish(),
    returnMode: z.enum(RETURN_MODES).nullish(),
    returnQuantityKg: z.number().finite().nullish(),
    notes: z.string().trim().max(500).nullish(),
  })
  .passthrough();

/** Validate + normalise the model output into a safe suggestion. Returns { suggestion, missing }. */
export function normalizeSuggestion(raw, { grainTypes }) {
  const parsed = modelOutputSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new AiUnavailableError('The AI returned data in an unexpected shape.', { code: 'AI_BAD_RESPONSE' });
  }
  const d = parsed.data;
  const clean = (v) => (v === undefined ? null : v);

  const grainType = d.grainType && grainTypes.includes(d.grainType) ? d.grainType : null;

  // An unstated unit means we do not know the quantity — do not guess.
  let quantityKg = d.quantityUnitStated && typeof d.quantityKg === 'number' ? d.quantityKg : null;
  if (quantityKg !== null && (!(quantityKg > 0) || quantityKg > 60000)) quantityKg = null;

  // Density: keep an explicit 0; reject out-of-range or negative.
  let densityTPerM3 = typeof d.densityTPerM3 === 'number' ? d.densityTPerM3 : null;
  if (densityTPerM3 !== null && (densityTPerM3 < 0 || densityTPerM3 > 2)) densityTPerM3 = null;

  const returnMode = d.returnMode ?? null;
  let returnQuantityKg = returnMode === 'loaded' && typeof d.returnQuantityKg === 'number' ? d.returnQuantityKg : null;
  if (returnQuantityKg !== null && (!(returnQuantityKg > 0) || returnQuantityKg > 60000)) returnQuantityKg = null;

  const suggestion = {
    originText: clean(d.originText),
    destinationText: clean(d.destinationText),
    grainType,
    quantityKg,
    quantityUnitStated: Boolean(d.quantityUnitStated),
    densityTPerM3,
    returnMode,
    returnQuantityKg,
    notes: clean(d.notes),
  };

  // Fields genuinely required before a calculation can run (density is NOT required).
  const missing = [];
  if (!suggestion.originText) missing.push('origin');
  if (!suggestion.destinationText) missing.push('destination');
  if (!suggestion.grainType) missing.push('grainType');
  if (suggestion.quantityKg === null) missing.push('quantityKg');

  return { suggestion, missing };
}

/**
 * @param {object} p
 * @param {object} p.config  - config.ai
 * @param {() => Promise<string[]>} p.getGrainTypes - resolves allowed grain codes
 * @param {Function} p.callModel - callModel({system,user,schema,maxTokens}) -> parsed JSON (injected; mocked in tests)
 */
export function createShipmentAiService({ config, getGrainTypes, callModel, quota }) {
  return {
    available: () => config.ready,
    async parse({ text }) {
      if (!config.ready) throw new AiDisabledError(config.disabledReason ?? 'disabled');
      const grainTypes = await getGrainTypes();
      const schema = buildSchema(grainTypes);
      // Reserve a shared daily/concurrency slot only now, right before the paid call,
      // so a disabled or invalid request never consumes the AI budget.
      const release = quota ? quota.reserve('AI') : () => {};
      let raw;
      try {
        raw = await callModel({ system: buildSystemPrompt(grainTypes), user: text, schema, maxTokens: 700 });
      } finally {
        release();
      }
      return normalizeSuggestion(raw, { grainTypes });
    },
  };
}
