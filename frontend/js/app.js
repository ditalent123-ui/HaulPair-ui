import { api, ApiError } from './api.js';
import { renderActivity, renderCosts, renderEmpty, renderError, renderHistory, renderResults } from './calculations.js';
import { $, $$, h, toast } from './dom.js';
import { createLocationInput } from './geocoder.js';
import { applyTranslations, fmt, getLocale, initLocale, onLocaleChange, setLocale, t } from './i18n.js';
import { createMap } from './map.js';
import { buildCalculationBody, buildRouteRequest, routeKey } from './routing.js';
import { readAndValidate, SERVER_FIELD_TO_INPUT } from './validation.js';

const HISTORY_PAGE = 10;
const kg = (tonnes) => (tonnes === null || tonnes === undefined ? null : Math.round(tonnes * 1000));

const state = {
  config: null,
  trucks: [],
  cargoTypes: [],
  route: null,
  routeKey: null,
  lastView: null,
  currentSavedId: null,
  picking: null,
  historyOffset: 0,
  fuelOrigin: { origin: 'manual' }, // {origin:'manual'|'suggested', date?, source?}
  fuelSuggestion: null,
  resultDirty: false,
};

const form = $('#plannerForm');
let map;
let locations;

/* ------------------------------------------------------------------ helpers */

const localName = (item) => item?.names?.[getLocale()] ?? item?.names?.en ?? item?.name ?? '';

function setFieldValue(id, value) {
  const el = $(`#${id}`);
  if (el) el.value = value === null || value === undefined ? '' : String(value);
}

function clearErrors() {
  $$('.field-error', form).forEach((el) => (el.textContent = ''));
  $$('[aria-invalid="true"]', form).forEach((el) => el.removeAttribute('aria-invalid'));
  $('#formMessage').textContent = '';
}

function showErrors(errors) {
  let first = null;
  for (const [id, message] of Object.entries(errors)) {
    const inputId = id === 'origin' || id === 'destination' ? `${id}Input` : id;
    const input = $(`#${inputId}`);
    const slot = $(`#${id}Error`);
    if (slot) slot.textContent = message;
    if (input) {
      input.setAttribute('aria-invalid', 'true');
      first ??= input;
    }
  }
  if (first) {
    const details = first.closest('details');
    if (details) details.open = true;
    first.focus();
  }
  $('#formMessage').textContent = t('error.fixFields');
}

function setBusy(busy) {
  const button = $('#calculateButton');
  button.disabled = busy;
  button.classList.toggle('is-loading', busy);
  button.querySelector('.button-label').textContent = t(busy ? 'action.calculating' : 'action.calculate');
  $('#mapLoading').hidden = !busy;
}

function mapNotice(text, kind = 'warning') {
  const el = $('#mapNotice');
  el.hidden = !text;
  el.textContent = text ?? '';
  el.className = `map-overlay map-overlay--top is-${kind}`;
}

function errorMessage(err) {
  if (err instanceof ApiError && err.code === 'NETWORK_ERROR') return t('error.network');
  // Localise known server error codes; fall back to the server-provided message.
  if (err instanceof ApiError && err.code) {
    const key = `apierror.${err.code}`;
    const localized = t(key);
    if (localized !== key) return localized;
  }
  return err?.message ?? String(err);
}

function handleApiError(err) {
  if (err instanceof ApiError && Array.isArray(err.details) && err.details.length) {
    const fieldErrors = {};
    for (const d of err.details) {
      const id = SERVER_FIELD_TO_INPUT[d.field];
      if (id) fieldErrors[id] = d.message;
    }
    if (Object.keys(fieldErrors).length) {
      showErrors(fieldErrors);
      return;
    }
    $('#formMessage').textContent = err.details.map((d) => d.message).join(' ');
    return;
  }
  $('#formMessage').textContent = errorMessage(err);
}

/* ------------------------------------------------------------- reference data */

function renderTruckOptions() {
  const select = $('#truckPreset');
  const selected = select.value;
  select.replaceChildren(
    ...state.trucks.map((tr) => h('option', { value: String(tr.id) }, localName(tr))),
    h('option', { value: '' }, t('truck.custom')),
  );
  if (selected !== undefined) select.value = selected;
}

function renderCargoOptions() {
  const select = $('#cargoType');
  const selected = select.value;
  select.replaceChildren(...state.cargoTypes.map((c) => h('option', { value: c.code }, localName(c))));
  if (selected) select.value = selected;
}

function applyTruckPreset(id) {
  const truck = state.trucks.find((tr) => String(tr.id) === String(id));
  if (!truck) return;
  setFieldValue('truckType', truck.truckType);
  setFieldValue('fuelType', truck.fuelType);
  setFieldValue('capacity', truck.capacityT);
  setFieldValue('cargoVolume', truck.cargoVolumeM3);
  setFieldValue('fuelConsumption', truck.fuelConsumptionLPer100Km);
  setFieldValue('emptyFuelConsumption', truck.emptyFuelConsumptionLPer100Km);
  setFieldValue('vehHeight', truck.vehicle.heightM);
  setFieldValue('vehWidth', truck.vehicle.widthM);
  setFieldValue('vehLength', truck.vehicle.lengthM);
  setFieldValue('vehWeight', truck.vehicle.grossWeightT);
  setFieldValue('vehAxle', truck.vehicle.axleLoadT);
  updateCapacityMeter();
  updateSummaries();
  loadFuelSuggestion();
}

/** Show the typical density only as a soft placeholder hint — never auto-applied. */
function applyCargoDensityHint(code) {
  const cargo = state.cargoTypes.find((c) => c.code === code);
  const el = $('#cargoDensity');
  el.placeholder = cargo?.typicalDensityTPerM3 ? fmt.number(cargo.typicalDensityTPerM3, 2) : '0';
}

function updateQtyEquiv() {
  const qtyKg = Number($('#cargoQuantity').value);
  const el = $('#cargoQtyEquiv');
  el.textContent = qtyKg > 0 ? t('cargo.tEquiv', { t: fmt.number(qtyKg / 1000, qtyKg % 1000 === 0 ? 0 : 1) }) : '';
}

function updateCapacityMeter() {
  updateQtyEquiv();
  const capKg = Number($('#capacity').value) * 1000;
  const qtyKg = Number($('#cargoQuantity').value);
  const bar = $('#capacityMeterBar');
  const text = $('#capacityMeterText');
  bar.classList.remove('is-full', 'is-over');
  if (!(capKg > 0) || !(qtyKg >= 0)) {
    bar.style.width = '0';
    text.textContent = '';
    return;
  }
  const pct = (qtyKg / capKg) * 100;
  bar.style.width = `${Math.min(pct, 100)}%`;
  if (pct > 100) bar.classList.add('is-over');
  else if (pct >= 99.95) bar.classList.add('is-full');
  text.textContent =
    pct > 100
      ? t('cargo.capacityOver', { over: fmt.number(qtyKg - capKg, 0) })
      : t('cargo.capacityText', { pct: fmt.number(pct, 1), qty: fmt.number(qtyKg, 0), cap: fmt.number(capKg, 0) });
}

function updateSummaries() {
  const preset = currentPreset();
  const cap = Number($('#capacity').value);
  $('#transportSummary').textContent = [preset ? localName(preset) : t('truck.custom'), cap > 0 ? `${fmt.number(cap, 0)} t` : null]
    .filter(Boolean)
    .join(' · ');
  const price = Number($('#fuelPrice').value);
  $('#costsSummary').textContent = price > 0 ? fmt.currency(price, { decimals: 3 }) + '/l' : '';
}

function updateRoutingIndicators() {
  const routing = state.config.routing;
  const badge = $('#routingBadge');
  badge.textContent = t('status.routing', {
    provider: `${routing.name.toUpperCase()} · ${routing.supportsTruckRestrictions ? t('status.routingTruck') : t('status.routingCar')}`,
  });
  badge.title = `${routing.displayName} — ${routing.profile}`;
  badge.classList.toggle('status-pill--warn', !routing.supportsTruckRestrictions);
  const rb = $('#restrictionsBadge');
  rb.textContent = routing.supportsTruckRestrictions ? t('truck.restrictionsOn') : t('truck.restrictionsOff');
  rb.className = `badge ${routing.supportsTruckRestrictions ? 'badge--ok' : 'badge--warn'}`;
  $('#restrictionsHint').textContent = routing.supportsTruckRestrictions ? t('truck.restrictionsHintOn') : t('truck.restrictionsHintOff');
  const access = $('#accessBadge');
  access.textContent = t(state.config.accessProtection ? 'status.accessOn' : 'status.accessOff');
}

/* ------------------------------------------------------------------- fuel price */

function fuelOriginLabel() {
  if (state.fuelOrigin.origin === 'suggested') {
    return t('fuel.originSuggested', { source: state.fuelOrigin.source, date: state.fuelOrigin.date });
  }
  return t('fuel.originManual');
}

function setFuelOrigin(origin, meta = {}) {
  state.fuelOrigin = { origin, ...meta };
  $('#fuelOrigin').textContent = fuelOriginLabel();
}

async function loadFuelSuggestion() {
  const el = $('#fuelSuggestion');
  const fuelType = $('#fuelType').value;
  let sug;
  try {
    sug = await api.fuelPrice(fuelType);
  } catch {
    el.hidden = true;
    return;
  }
  state.fuelSuggestion = sug;
  if (!sug.available) {
    // Do not present any demo value as a found price; just hide the suggestion UI.
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.className = `fuel-suggestion${sug.stale ? ' is-stale' : ''}`;
  const useBtn = h('button', { type: 'button', class: 'button button--small button--accent' }, t('fuel.useSuggested'));
  useBtn.addEventListener('click', () => {
    setFieldValue('fuelPrice', sug.priceEurPerL);
    setFuelOrigin('suggested', { date: sug.priceDate, source: sug.sourceName });
    updateSummaries();
    markDirty();
  });
  el.replaceChildren(
    h('span', { class: 'badge badge--accent' }, t('fuel.suggestedBadge')),
    h('span', { class: 'fuel-suggestion-price' }, fmt.currency(sug.priceEurPerL, { decimals: 3 }) + '/l'),
    useBtn,
    h('span', { class: 'fuel-suggestion-meta' }, `${sug.sourceName} · ${sug.priceDate}${sug.stale ? ' · ' + t('fuel.suggestionStale', { date: sug.priceDate }) : ''}`),
  );
}

function currentFuelMeta() {
  if (state.fuelOrigin.origin === 'suggested') {
    return { origin: 'lea', priceDate: state.fuelOrigin.date ?? null, source: state.fuelOrigin.source ?? null };
  }
  return { origin: 'manual' };
}

/* ------------------------------------------------------------------- status */

async function refreshHealth() {
  const pill = $('#apiStatus');
  const text = pill.querySelector('.status-text');
  try {
    await api.health();
    pill.dataset.state = 'ok';
    text.textContent = t('status.ok');
    pill.title = text.textContent;
  } catch (err) {
    const degraded = err instanceof ApiError && err.status === 503;
    pill.dataset.state = degraded ? 'degraded' : 'error';
    text.textContent = t(degraded ? 'status.degraded' : 'status.offline');
    pill.title = text.textContent;
  }
}

/* --------------------------------------------------------------- calculation */

async function ensureRoute(values) {
  const request = buildRouteRequest(values, state.config.routing);
  const key = routeKey(request);
  if (state.route && state.routeKey === key && Date.parse(state.route.routeTokenExpiresAt) - Date.now() > 60_000) {
    return state.route;
  }
  const route = await api.route(request);
  state.route = route;
  state.routeKey = key;
  map.showRoute(route);
  mapNotice(route.truckRestrictionsApplied ? null : t('results.mapNoticeCar'), 'warning');
  return route;
}

function currentPreset() {
  const id = $('#truckPreset').value;
  return state.trucks.find((tr) => String(tr.id) === id) ?? null;
}

function viewFromEstimate(estimate, route, extra = {}) {
  return {
    route: {
      provider: route?.provider?.displayName ?? estimate.route.provider,
      profile: estimate.route.profile,
      truckRestrictionsApplied: estimate.route.truckRestrictionsApplied,
      origin: estimate.route.origin,
      destination: estimate.route.destination,
    },
    calc: estimate.calculation,
    inputs: estimate.inputs,
    routeWarnings: route?.warnings ?? [],
    fuelOrigin: fuelOriginLabel(),
    ...extra,
  };
}

function renderCurrent() {
  if (!state.lastView) return;
  state.lastView.recalcNeeded = state.resultDirty;
  renderResults($('#resultsContainer'), state.lastView);
  renderCosts($('#costsContainer'), state.lastView);
}

function markDirty() {
  if (!state.lastView || state.resultDirty) return;
  state.resultDirty = true;
  renderCurrent();
}

async function onSubmit(event) {
  event.preventDefault();
  clearErrors();
  const { errors, values } = readAndValidate(form, {
    origin: locations.origin.getValue(),
    destination: locations.destination.getValue(),
  });
  if (Object.keys(errors).length) {
    showErrors(errors);
    return;
  }

  setBusy(true);
  activateTab('results');
  try {
    let route = await ensureRoute(values);
    const preset = currentPreset();
    const bodyFor = (r) => ({
      ...buildCalculationBody(values, { routeToken: r.routeToken, truckConfigurationId: preset?.id ?? null, truckName: preset ? localName(preset) : undefined }),
      fuelPriceMeta: currentFuelMeta(),
    });

    let body = bodyFor(route);
    let estimate;
    try {
      estimate = await api.estimate(body);
    } catch (err) {
      if (err instanceof ApiError && err.details?.some((d) => d.field === 'routeToken')) {
        state.routeKey = null;
        route = await ensureRoute(values);
        body = bodyFor(route);
        estimate = await api.estimate(body);
      } else throw err;
    }

    state.currentSavedId = null;
    state.resultDirty = false;
    state.lastView = viewFromEstimate(estimate, route, {
      onSave: async (label) => {
        try {
          const saved = await api.saveCalculation({ ...body, ...(label ? { label } : {}) });
          state.currentSavedId = saved.id;
          toast(t('history.savedToast'), 'success');
          state.historyOffset = 0;
          await Promise.all([loadHistory(), loadActivity()]);
        } catch (err) {
          toast(errorMessage(err), 'error');
          throw err;
        }
      },
    });
    renderCurrent();
    loadActivity();
  } catch (err) {
    handleApiError(err);
    if (err instanceof ApiError && ['NO_ROUTE', 'UPSTREAM_ERROR', 'UPSTREAM_TIMEOUT', 'UPSTREAM_UNREACHABLE', 'UPSTREAM_RATE_LIMITED', 'UPSTREAM_AUTH', 'EXTERNAL_LIMIT'].includes(err.code)) {
      mapNotice(errorMessage(err), 'error');
      map.clearRoute();
      state.route = null;
      state.routeKey = null;
    }
    loadActivity();
  } finally {
    setBusy(false);
  }
}

/* ------------------------------------------------------------- AI "describe shipment" */

function setupAi() {
  const panel = $('#aiPanel');
  const badge = $('#aiAvailabilityBadge');
  const input = $('#aiInput');
  const prepareBtn = $('#aiPrepareBtn');
  input.maxLength = state.config.ai?.maxInputChars ?? 2000;

  const updateCount = () => {
    $('#aiCharCount').textContent = `${input.value.length}/${input.maxLength}`;
  };
  input.addEventListener('input', updateCount);
  updateCount();

  if (!state.config.ai?.available) {
    badge.hidden = false;
    badge.textContent = 'off';
    badge.className = 'badge badge--warn';
    input.disabled = true;
    prepareBtn.disabled = true;
    $('#aiHint').textContent = t('ai.disabledHint');
    return;
  }
  badge.hidden = true;
  prepareBtn.addEventListener('click', onAiPrepare);
}

async function onAiPrepare() {
  const input = $('#aiInput');
  const btn = $('#aiPrepareBtn');
  const errEl = $('#aiError');
  errEl.textContent = '';
  const text = input.value.trim();
  if (!text) {
    errEl.textContent = t('validation.required');
    return;
  }
  btn.disabled = true;
  btn.textContent = t('ai.preparing');
  try {
    const result = await api.parseShipment(text);
    renderAiSuggestion(result);
  } catch (err) {
    // Any provider/limit/disabled failure → manual fallback message (never a fake suggestion).
    $('#aiSuggestion').hidden = true;
    errEl.textContent = err instanceof ApiError && err.code === 'AI_DISABLED' ? t('ai.disabledHint') : t('ai.unavailable');
  } finally {
    btn.disabled = false;
    btn.textContent = t('ai.prepare');
  }
}

function renderAiSuggestion({ suggestion, missing }) {
  const box = $('#aiSuggestion');
  const grainName = suggestion.grainType ? localName(state.cargoTypes.find((c) => c.code === suggestion.grainType)) || suggestion.grainType : '—';
  const rows = [
    [t('ai.field.origin'), suggestion.originText ?? '—'],
    [t('ai.field.destination'), suggestion.destinationText ?? '—'],
    [t('ai.field.grainType'), grainName],
    [t('ai.field.quantityKg'), suggestion.quantityKg !== null ? `${fmt.number(suggestion.quantityKg, 0)} kg` : '—'],
    [t('ai.field.densityTPerM3'), suggestion.densityTPerM3 !== null ? fmt.number(suggestion.densityTPerM3, 2) : '—'],
  ];
  if (suggestion.returnMode && suggestion.returnMode !== 'none') {
    rows.push([t('ai.field.return'), `${t(`route.return${suggestion.returnMode === 'loaded' ? 'Loaded' : 'Empty'}`)}${suggestion.returnQuantityKg ? ` · ${fmt.number(suggestion.returnQuantityKg, 0)} kg` : ''}`]);
  }

  const grid = h('dl', { class: 'ai-suggestion-grid' }, rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
  const applyBtn = h('button', { type: 'button', class: 'button button--small button--primary' }, t('ai.apply'));
  applyBtn.addEventListener('click', () => applyAiSuggestion(suggestion));

  const children = [h('p', { class: 'field-hint' }, t('ai.review')), grid];
  if (missing.length) {
    children.push(h('p', { class: 'ai-missing' }, t('ai.missing', { fields: missing.map((m) => t(`ai.field.${m === 'origin' ? 'origin' : m === 'destination' ? 'destination' : m}`)).join(', ') })));
  }
  if (suggestion.notes) children.push(h('p', { class: 'ai-note' }, `${t('ai.notes')}: ${suggestion.notes}`));
  children.push(h('p', { class: 'ai-note' }, t('ai.confirmLocations')));
  children.push(applyBtn);
  box.replaceChildren(...children);
  box.hidden = false;
}

function applyAiSuggestion(s) {
  // Places: fill the text and trigger search; the user confirms via suggestions/map (no fabricated coords).
  for (const [kind, text] of [['origin', s.originText], ['destination', s.destinationText]]) {
    if (text) {
      const el = $(`#${kind}Input`);
      el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  if (s.grainType && state.cargoTypes.some((c) => c.code === s.grainType)) {
    setFieldValue('cargoType', s.grainType);
    applyCargoDensityHint(s.grainType);
  }
  if (s.quantityKg !== null) setFieldValue('cargoQuantity', s.quantityKg);
  if (s.densityTPerM3 !== null) setFieldValue('cargoDensity', s.densityTPerM3);
  if (s.returnMode) {
    setFieldValue('returnMode', s.returnMode);
    $('#returnCargoField').hidden = s.returnMode !== 'loaded';
    if (s.returnMode === 'loaded' && s.returnQuantityKg) setFieldValue('returnCargoQuantity', s.returnQuantityKg);
  }
  updateCapacityMeter();
  updateSummaries();
  markDirty();
  toast(t('ai.applied'), 'success');
}

/* ------------------------------------------------------------------ history */

async function loadHistory() {
  const container = $('#historyContainer');
  try {
    const res = await api.listCalculations({ limit: HISTORY_PAGE, offset: state.historyOffset });
    $('#historyCount').textContent = res.meta.total ? `(${res.meta.total})` : '';
    renderHistory(container, {
      items: res.data,
      total: res.meta.total,
      limit: HISTORY_PAGE,
      offset: state.historyOffset,
      currentId: state.currentSavedId,
      onOpen: openSaved,
      onDelete: confirmDelete,
      onPage: (offset) => {
        state.historyOffset = offset;
        loadHistory();
      },
    });
  } catch (err) {
    renderError(container, errorMessage(err), loadHistory);
  }
}

async function loadActivity() {
  const container = $('#activityContainer');
  try {
    renderActivity(container, await api.activity(30));
  } catch (err) {
    renderError(container, errorMessage(err), loadActivity);
  }
}

function fillFormFromSaved(record) {
  const inputs = record.inputs;
  locations.origin.setValue(record.origin, { silent: true });
  locations.destination.setValue(record.destination, { silent: true });
  map.setMarker('origin', record.origin);
  map.setMarker('destination', record.destination);

  setFieldValue('truckPreset', record.truckConfigurationId ?? '');
  const truck = inputs.truck;
  setFieldValue('truckType', truck.truckType ?? 'tractor_semitrailer');
  setFieldValue('fuelType', truck.fuelType);
  setFieldValue('capacity', truck.capacityT);
  setFieldValue('cargoVolume', truck.cargoVolumeM3);
  setFieldValue('fuelConsumption', truck.fuelConsumptionLPer100Km);
  setFieldValue('emptyFuelConsumption', truck.emptyFuelConsumptionLPer100Km);
  const veh = record.routeMetadata?.vehicleRestrictions ?? {};
  for (const [id, key] of [['vehHeight', 'heightM'], ['vehWidth', 'widthM'], ['vehLength', 'lengthM'], ['vehWeight', 'grossWeightT'], ['vehAxle', 'axleLoadT']]) {
    if (veh[key] !== undefined) setFieldValue(id, veh[key]);
  }
  setFieldValue('cargoType', inputs.cargo.typeCode);
  applyCargoDensityHint(inputs.cargo.typeCode);
  setFieldValue('cargoQuantity', kg(inputs.cargo.quantityT));
  setFieldValue('cargoDensity', inputs.cargo.densityTPerM3); // 0 → "0", null → ""
  setFieldValue('fuelPrice', inputs.fuelPriceEurPerL);
  // Restore the saved fuel-price origin (manual vs source), not today's.
  const fp = record.fuelPrice ?? {};
  if (fp.origin === 'lea' || fp.origin === 'suggested') setFuelOrigin('suggested', { date: fp.date, source: fp.source });
  else setFuelOrigin('manual');
  setFieldValue('returnMode', inputs.returnTrip?.mode ?? 'none');
  setFieldValue('returnCargoQuantity', inputs.returnTrip?.cargoQuantityT ? kg(inputs.returnTrip.cargoQuantityT) : '');
  $('#returnCargoField').hidden = (inputs.returnTrip?.mode ?? 'none') !== 'loaded';
  setFieldValue('tolls', inputs.costs.tollsEur);
  setFieldValue('returnTolls', inputs.costs.returnTollsEur);
  setFieldValue('loadingCost', inputs.costs.loadingUnloadingEur);
  setFieldValue('otherCost', inputs.costs.otherEur);
  updateCapacityMeter();
  updateSummaries();
}

async function openSaved(id) {
  clearErrors();
  try {
    const record = await api.getCalculation(id);
    state.currentSavedId = record.id;
    fillFormFromSaved(record);
    activateTab('results');

    const savedEstimate = record.results;
    const extraNotices = [{ type: 'info', text: t('results.savedNote') }];
    const baseView = () => viewFromEstimate(savedEstimate, null, { saved: { createdAt: record.createdAt }, extraNotices });
    state.resultDirty = false;
    state.lastView = baseView();
    renderCurrent();
    loadHistory();

    $('#mapLoading').hidden = false;
    try {
      const { values } = readAndValidate(form, { origin: record.origin, destination: record.destination });
      const route = await ensureRoute(values);
      const now = route.outbound.distanceKm;
      const then = record.outboundDistanceKm;
      if (Math.abs(now - then) / then > 0.005) {
        extraNotices.push({ type: 'warning', text: t('results.routeChanged', { now: fmt.unit(now, 'km', 1), then: fmt.unit(then, 'km', 1) }) });
      }
      state.lastView = { ...baseView(), routeWarnings: route.warnings };
    } catch (err) {
      map.clearRoute();
      map.fitMarkers();
      extraNotices.push({ type: 'warning', text: t('results.routeRefetchFailed', { message: errorMessage(err) }) });
      state.lastView = baseView();
    } finally {
      $('#mapLoading').hidden = true;
    }
    renderCurrent();
  } catch (err) {
    toast(errorMessage(err), 'error');
  }
}

function confirmDelete(id, name) {
  const dialog = $('#confirmDialog');
  $('#confirmText').textContent = t('history.confirmText', { name });
  dialog.returnValue = '';
  dialog.showModal();
  dialog.addEventListener(
    'close',
    async () => {
      if (dialog.returnValue !== 'confirm') return;
      try {
        await api.deleteCalculation(id);
        toast(t('history.deleted'), 'success');
        if (state.currentSavedId === id) state.currentSavedId = null;
        await Promise.all([loadHistory(), loadActivity()]);
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    },
    { once: true },
  );
}

/* --------------------------------------------------------------------- tabs */

function activateTab(name) {
  for (const tab of $$('.tab')) {
    const active = tab.id === `tab-${name}`;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    $(`#${tab.getAttribute('aria-controls')}`).hidden = !active;
  }
}

function initTabs() {
  const tabs = $$('.tab');
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => {
      const name = tab.id.replace('tab-', '');
      activateTab(name);
      if (name === 'history') loadHistory();
      if (name === 'activity') loadActivity();
    });
    tab.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      next.focus();
      next.click();
    });
  });
  $$('[data-nav]').forEach((btn) =>
    btn.addEventListener('click', () => {
      $$('[data-nav]').forEach((b) => b.classList.toggle('is-active', b === btn));
      const target = btn.dataset.nav === 'history' ? 'history' : 'results';
      activateTab(target);
      if (target === 'history') loadHistory();
    }),
  );
}

/* --------------------------------------------------------------- locations */

function onLocationChange(kind, value) {
  map.setMarker(kind, value);
  $(`#${kind}Error`).textContent = '';
  if (value) map.fitMarkers();
  markDirty();
}

function startPicking(kind) {
  state.picking = state.picking === kind ? null : kind;
  $$('[data-pick-on-map]').forEach((b) => b.classList.toggle('is-active', b.dataset.pickOnMap === state.picking));
  map.setPicking(Boolean(state.picking));
  mapNotice(state.picking ? t('route.pickingHint', { field: t(kind === 'origin' ? 'route.origin' : 'route.destination').toLowerCase() }) : null, 'warning');
}

function initLocations() {
  const autocomplete = state.config.geocoding.supportsAutocomplete;
  locations = {
    origin: createLocationInput({ input: $('#originInput'), listbox: $('#originListbox'), autocomplete, onChange: (v) => onLocationChange('origin', v) }),
    destination: createLocationInput({ input: $('#destinationInput'), listbox: $('#destinationListbox'), autocomplete, onChange: (v) => onLocationChange('destination', v) }),
  };

  let lastFocused = 'origin';
  $('#originInput').addEventListener('focus', () => (lastFocused = 'origin'));
  $('#destinationInput').addEventListener('focus', () => (lastFocused = 'destination'));

  $$('[data-quick]').forEach((chip) =>
    chip.addEventListener('click', async () => {
      let target = lastFocused;
      if (locations[target].getValue() && !locations[target === 'origin' ? 'destination' : 'origin'].getValue()) {
        target = target === 'origin' ? 'destination' : 'origin';
      }
      try {
        await locations[target].resolveFirst(chip.dataset.quick);
        lastFocused = target === 'origin' ? 'destination' : 'origin';
      } catch (err) {
        $(`#${target}Error`).textContent = t('geo.error', { message: errorMessage(err) });
      }
    }),
  );

  $('#swapButton').addEventListener('click', () => {
    const a = locations.origin.getValue();
    const b = locations.destination.getValue();
    locations.origin.setValue(b);
    locations.destination.setValue(a);
  });

  $$('[data-pick-on-map]').forEach((btn) => btn.addEventListener('click', () => startPicking(btn.dataset.pickOnMap)));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.picking) startPicking(state.picking);
  });
  map.onClick(({ lat, lon }) => {
    if (!state.picking) return;
    const kind = state.picking;
    const label = t('route.droppedPin', { lat: lat.toFixed(5), lon: lon.toFixed(5) });
    locations[kind].setValue({ lat: Number(lat.toFixed(6)), lon: Number(lon.toFixed(6)), label });
    startPicking(kind);
  });
}

/* --------------------------------------------------------------------- init */

async function init() {
  initLocale();
  applyTranslations();
  $('#langSelect').value = getLocale();
  $('#langSelect').addEventListener('change', (e) => setLocale(e.target.value));
  initTabs();
  refreshHealth();
  setInterval(refreshHealth, 30_000);

  try {
    state.config = await api.config();
  } catch (err) {
    $('#formMessage').textContent = errorMessage(err);
    renderError($('#resultsContainer'), errorMessage(err), () => location.reload());
    return;
  }

  map = createMap($('#map'), state.config.map);
  window.addEventListener('resize', () => map.invalidateSize());
  updateRoutingIndicators();
  initLocations();
  setupAi();

  try {
    [state.trucks, state.cargoTypes] = await Promise.all([api.trucks(), api.cargoTypes()]);
    renderTruckOptions();
    renderCargoOptions();
    if (state.trucks[0]) {
      $('#truckPreset').value = String(state.trucks[0].id);
      applyTruckPreset(state.trucks[0].id);
    }
    if (state.cargoTypes[0]) applyCargoDensityHint(state.cargoTypes[0].code);
  } catch (err) {
    $('#formMessage').textContent = t('error.loadReference', { message: errorMessage(err) });
  }

  $('#fuelOrigin').textContent = fuelOriginLabel();

  $('#truckPreset').addEventListener('change', (e) => applyTruckPreset(e.target.value));
  $('#cargoType').addEventListener('change', (e) => applyCargoDensityHint(e.target.value));
  $('#fuelType').addEventListener('change', () => {
    // Changing fuel type must not silently carry a manual/suggested price across.
    setFuelOrigin('manual');
    loadFuelSuggestion();
  });
  $('#returnMode').addEventListener('change', (e) => {
    $('#returnCargoField').hidden = e.target.value !== 'loaded';
  });
  $('#fuelPrice').addEventListener('input', () => {
    setFuelOrigin('manual');
    updateSummaries();
  });
  ['capacity', 'cargoQuantity'].forEach((id) => $(`#${id}`).addEventListener('input', updateCapacityMeter));
  form.addEventListener('input', (e) => {
    if (e.target.getAttribute('aria-invalid') === 'true') {
      e.target.removeAttribute('aria-invalid');
      const slot = $(`#${e.target.id}Error`);
      if (slot) slot.textContent = '';
    }
    if (e.target.id !== 'aiInput' && e.target.id !== 'saveLabel') markDirty();
  });
  form.addEventListener('submit', onSubmit);

  onLocaleChange(() => {
    renderTruckOptions();
    renderCargoOptions();
    updateRoutingIndicators();
    updateCapacityMeter();
    updateSummaries();
    $('#fuelOrigin').textContent = fuelOriginLabel();
    refreshHealth();
    renderCurrent();
    loadHistory();
    loadActivity();
    loadFuelSuggestion();
  });

  updateCapacityMeter();
  updateSummaries();
  loadFuelSuggestion();
  loadHistory();
  loadActivity();
}

init();
