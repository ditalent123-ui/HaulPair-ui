import { $, h, toast } from '../../dom.js';
import { createIcon } from '../../icons.js';
import { api } from '../api.js';
import { createCalendar } from '../calendar.js';
import { createCombo } from '../combo.js';
import { eur, hourVilnius, todayVilnius } from '../format.js';
import { createUserMap } from '../mapView.js';
import { errorText, loadOptions, navigate, onLeave, state } from '../main.js';
import { orders } from '../storage.js';
import { t } from '../strings.js';
import { isValidAmountT, parseAmountT, validateCompany } from '../validators.js';

/* ------------------------------------------------------------------------ */
/* Screen 1 — the four inputs                                                */
/* ------------------------------------------------------------------------ */

const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('lt');

function field({ id, label, control, hint }) {
  return h(
    'div',
    { class: 'hp-field' },
    h('label', { class: 'hp-label', for: id }, label),
    control,
    hint ? h('span', { class: 'hp-hint', id: `${id}Hint` }, hint) : null,
    h('span', { class: 'hp-error', id: `${id}Error`, role: 'alert' }),
  );
}

function setError(input, key) {
  const el = $(`#${input.id}Error`);
  if (el) el.textContent = key ? t(key) : '';
  if (key) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

export async function placeItems(q) {
  const res = await api.places(q);
  return {
    groups: [{ label: res.source === 'offline_demo' ? 'Vietovės (demo paieška)' : 'Vietovės', items: res.results.map((r) => ({ label: r.label, sub: r.sub, demo: r.demo, value: { lat: r.lat, lon: r.lon, label: r.label } })) }],
    hint: res.source === 'offline_demo' ? t('book.offlineHint') : null,
  };
}

function dropoffGroups(options, q) {
  const f = fold(q);
  const match = (d) => !f || fold(`${d.name} ${d.address} ${d.region}`).includes(f);
  const groups = [];
  for (const [type, typeLabel] of Object.entries(options.dropoffTypes)) {
    const inType = options.dropoffs.filter((d) => d.type === type && match(d));
    const regions = [...new Set(inType.map((d) => d.region))].sort((a, b) => a.localeCompare(b, 'lt'));
    for (const region of regions) {
      groups.push({
        label: typeLabel,
        sub: region,
        items: inType
          .filter((d) => d.region === region)
          .map((d) => ({ key: d.id, label: d.name, sub: d.address, demo: d.demo, value: { dropoffId: d.id, lat: d.lat, lon: d.lon, label: d.name } })),
      });
    }
  }
  return groups;
}

export async function renderBookForm(main) {
  const options = await loadOptions();
  const d = state.draft;

  const pickupInput = h('input', { class: 'hp-input', id: 'pickupInput', placeholder: t('book.pickupPh'), value: d.pickup?.label ?? '' });
  const destInput = h('input', { class: 'hp-input', id: 'destinationInput', placeholder: t('book.destinationPh'), value: d.destination?.label ?? '' });
  const cargoSelect = h(
    'select',
    { class: 'hp-select', id: 'cargoSelect' },
    h('option', { value: '' }, t('book.cargoPh')),
    options.cargoTypes.map((c) => h('option', { value: c.id, selected: c.id === d.cargoType }, c.label)),
  );
  const amountInput = h('input', { class: 'hp-input', id: 'amountInput', inputmode: 'decimal', autocomplete: 'off', placeholder: t('book.amountPh'), value: d.amountT ?? '' });

  const pickupWrap = h('div', { class: 'hp-input-wrap' }, pickupInput);
  const destWrap = h('div', { class: 'hp-input-wrap' }, destInput);

  const form = h(
    'form',
    { class: 'hp-card', id: 'bookForm', novalidate: true },
    field({ id: 'pickupInput', label: t('book.pickup'), control: pickupWrap }),
    field({ id: 'destinationInput', label: t('book.destination'), control: destWrap }),
    field({ id: 'cargoSelect', label: t('book.cargo'), control: cargoSelect }),
    field({ id: 'amountInput', label: t('book.amount'), control: h('div', { class: 'hp-amount' }, amountInput, h('span', { class: 'hp-amount-unit', 'aria-hidden': 'true' }, 't')) }),
    h('button', { type: 'submit', class: 'button button--primary hp-btn', id: 'quoteButton' }, t('book.submit'), createIcon('back', { size: 20, className: 'hp-flip' })),
  );
  amountInput.setAttribute('aria-label', `${t('book.amount')}, tonomis`);

  const pickupCombo = createCombo({
    input: pickupInput,
    minChars: 2,
    getItems: placeItems,
    onSelect: (item) => {
      d.pickup = item.value;
      setError(pickupInput, null);
    },
    onClear: () => {
      d.pickup = null;
    },
  });
  if (d.pickup) pickupCombo.set({ label: d.pickup.label, value: d.pickup });

  const destCombo = createCombo({
    input: destInput,
    minChars: 0,
    getItems: async (q, partial) => {
      const groups = dropoffGroups(options, q);
      if (q.length < 3) return { groups };
      partial({ groups, status: null });
      // Free-text address fallback below the drop-off points.
      try {
        const res = await placeItems(q);
        const addresses = res.groups[0].items;
        if (!addresses.length) return { groups };
        return { groups: [...groups, { label: 'Kitas adresas', items: addresses }], hint: res.hint };
      } catch {
        return { groups };
      }
    },
    onSelect: (item) => {
      d.destination = item.value;
      setError(destInput, null);
    },
    onClear: () => {
      d.destination = null;
    },
  });
  if (d.destination) destCombo.set({ label: d.destination.label, value: d.destination });

  cargoSelect.addEventListener('change', () => {
    d.cargoType = cargoSelect.value;
    setError(cargoSelect, null);
  });
  amountInput.addEventListener('input', () => {
    d.amountT = amountInput.value;
    setError(amountInput, null);
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = parseAmountT(amountInput.value);
    let firstBad = null;
    const check = (ok, input, key) => {
      setError(input, ok ? null : key);
      if (!ok && !firstBad) firstBad = input;
    };
    check(Boolean(d.pickup), pickupInput, 'book.err.pickup');
    check(Boolean(d.destination), destInput, 'book.err.destination');
    check(Boolean(cargoSelect.value), cargoSelect, 'book.err.cargo');
    check(isValidAmountT(amount), amountInput, 'book.err.amount');
    if (firstBad) {
      firstBad.focus();
      return;
    }
    d.cargoType = cargoSelect.value;
    d.amountT = String(amount);
    navigate('#/book/result');
  });

  main.append(
    h('p', { class: 'hp-eyebrow' }, t('book.eyebrow')),
    h('h1', { class: 'hp-title' }, t('book.title')),
    h('p', { class: 'hp-lead' }, t('book.lead')),
    form,
  );
}

/* ------------------------------------------------------------------------ */
/* Screen 2 — map, one total price, one button                               */
/* ------------------------------------------------------------------------ */

function draftKey(d) {
  return JSON.stringify([d.pickup, d.destination?.dropoffId ?? d.destination, d.cargoType, d.amountT]);
}

function quoteBody(d) {
  const destination = d.destination.dropoffId
    ? { dropoffId: d.destination.dropoffId }
    : { lat: d.destination.lat, lon: d.destination.lon, label: d.destination.label };
  return { pickup: d.pickup, destination, cargoType: d.cargoType, amountT: Number(d.amountT) };
}

function quoteIsFresh() {
  return state.quote && state.quoteKey === draftKey(state.draft) && Date.parse(state.quote.expiresAt) - Date.now() > 60_000;
}

export async function renderBookResult(main) {
  const d = state.draft;
  if (!d.pickup || !d.destination || !d.cargoType || !d.amountT) return navigate('#/book');
  await loadOptions();
  main.className = 'hp-main hp-main--map';

  const mapEl = h('div', { class: 'hp-map', id: 'resultMap', role: 'region', 'aria-label': 'Maršruto žemėlapis' });
  const badges = h('div', { class: 'hp-map-badges' });
  const sheet = h('section', { class: 'hp-sheet', 'aria-live': 'polite' }, h('div', { class: 'hp-sheet-handle' }), h('div', { class: 'hp-loading' }, h('span', { class: 'spinner' }), t('result.loading')));
  const back = h('a', { class: 'hp-back-fab', href: '#/book' }, createIcon('back', { size: 20 }), t('result.change'));
  main.append(h('div', { class: 'hp-map-screen' }, mapEl, badges, back, sheet));

  const map = createUserMap(mapEl, state.mapConfig);
  onLeave(() => map.destroy());

  let q;
  try {
    q = quoteIsFresh() ? state.quote : await api.quote(quoteBody(d));
    state.quote = q;
    state.quoteKey = draftKey(d);
  } catch (err) {
    sheet.replaceChildren(
      h('div', { class: 'hp-sheet-handle' }),
      h('div', { class: 'hp-notice hp-notice--error', role: 'alert' }, createIcon('warning', { size: 18 }), h('span', {}, errorText(err))),
      h('div', { class: 'hp-section-gap' }),
      h('a', { class: 'button button--primary hp-btn', href: '#/book' }, t('result.change')),
    );
    return;
  }

  map.showRoute({ from: q.pickup, to: q.destination, legs: [{ geometry: q.route.geometry, style: 'main' }] });
  badges.replaceChildren(
    q.route.demo
      ? h('span', { class: 'hp-map-badge hp-map-badge--demo' }, t('result.demoRoute'))
      : h('span', { class: 'hp-map-badge' }, t('result.truckRoute')),
  );

  const btn = h('a', { class: 'button button--primary hp-btn', href: '#/book/details', id: 'continueButton' }, t('result.continue'));
  sheet.replaceChildren(
    h('div', { class: 'hp-sheet-handle' }),
    h('p', { class: 'hp-total-label' }, t('result.total')),
    h('p', { class: 'hp-total', id: 'totalPrice' }, eur(q.totalEur)),
    btn,
  );
  btn.focus({ preventScroll: true });
}

/* ------------------------------------------------------------------------ */
/* Screen 3 — pickup day, time window, optional legal entity, confirm        */
/* ------------------------------------------------------------------------ */

const COMPANY_FIELDS = [
  { key: 'name', label: 'company.name', autocomplete: 'organization' },
  { key: 'code', label: 'company.code', hint: 'company.codeHint', inputmode: 'numeric' },
  { key: 'vat', label: 'company.vat', hint: 'company.vatHint' },
  { key: 'address', label: 'company.address', autocomplete: 'street-address' },
  { key: 'contact', label: 'company.contact', autocomplete: 'name' },
  { key: 'phone', label: 'company.phone', inputmode: 'tel', type: 'tel', autocomplete: 'tel' },
  { key: 'email', label: 'company.email', type: 'email', inputmode: 'email', autocomplete: 'email' },
];

/** Legal entity window. Resolves to the validated values, or null if closed. Nothing is stored or sent. */
function openCompanyDialog(initial) {
  return new Promise((resolve) => {
    const values = { ...initial };
    const inputs = {};
    const body = h('div', { class: 'hp-dialog-body' }, h('div', { class: 'hp-notice hp-notice--demo', role: 'note' }, createIcon('info', { size: 18 }), h('span', {}, t('company.demo'))), h('div', { class: 'hp-section-gap' }));
    for (const f of COMPANY_FIELDS) {
      const input = h('input', { class: 'hp-input', id: `co_${f.key}`, name: f.key, type: f.type ?? 'text', inputmode: f.inputmode, autocomplete: 'off', value: values[f.key] ?? '' });
      inputs[f.key] = input;
      body.append(field({ id: `co_${f.key}`, label: t(f.label), control: input, hint: f.hint ? t(f.hint) : null }));
    }
    const invoice = h('input', { type: 'checkbox', id: 'co_invoice', checked: values.invoice !== false });
    body.append(h('label', { class: 'hp-switch', for: 'co_invoice' }, h('span', {}, t('company.invoice')), invoice, h('span', { class: 'hp-switch-track', 'aria-hidden': 'true' })));

    const save = h('button', { type: 'submit', class: 'button button--primary hp-btn', id: 'companySave' }, t('company.save'));
    const close = h('button', { type: 'button', class: 'hp-dialog-close', 'aria-label': 'Uždaryti' }, createIcon('close', { size: 20 }));
    const form = h('form', { method: 'dialog', novalidate: true }, h('div', { class: 'hp-dialog-head' }, h('h2', { class: 'hp-dialog-title' }, t('company.title')), close), body, h('div', { class: 'hp-dialog-foot' }, save));
    const dialog = h('dialog', { class: 'hp-dialog', id: 'companyDialog', 'aria-label': t('company.title') }, form);
    document.body.append(dialog);

    let result = null;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      for (const f of COMPANY_FIELDS) values[f.key] = inputs[f.key].value.trim();
      values.invoice = invoice.checked;
      const errors = validateCompany(values);
      let first = null;
      for (const f of COMPANY_FIELDS) {
        setError(inputs[f.key], errors[f.key] ?? null);
        if (errors[f.key] && !first) first = inputs[f.key];
      }
      if (first) {
        first.focus();
        return;
      }
      result = values;
      dialog.close();
    });
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });
    dialog.showModal();
  });
}

function addDays(date, n) {
  const x = new Date(`${date}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

export async function renderBookDetails(main) {
  if (!state.quote) return navigate(state.draft.pickup ? '#/book/result' : '#/book');
  const options = await loadOptions();
  const today = todayVilnius();
  const hourNow = hourVilnius();
  const windowsFor = (date) =>
    options.timeWindows.map((w) => {
      const from = Number(w.id.split('-')[0]);
      const to = Number(w.id.split('-')[1]);
      const disabled = w.todayOnly ? date !== today : date === today && to <= hourNow;
      return { ...w, from, disabled };
    });

  let day = hourNow < 16 ? today : addDays(today, 1);
  let windowId = day === today ? 'asap' : '08-10';

  const calHost = h('div', { id: 'pickupCalendar' });
  const winHost = h('div', { class: 'hp-windows', id: 'timeWindows', role: 'group', 'aria-label': t('details.window') });
  const dayError = h('span', { class: 'hp-error', role: 'alert' });

  function renderWindows() {
    const ws = windowsFor(day);
    if (ws.find((w) => w.id === windowId)?.disabled) windowId = ws.find((w) => !w.disabled)?.id ?? null;
    winHost.replaceChildren(
      ...ws.map((w) => {
        const b = h('button', { type: 'button', class: 'hp-choice', 'aria-pressed': String(w.id === windowId), disabled: w.disabled, dataset: { window: w.id } }, h('span', { class: 'hp-choice-title' }, w.label));
        b.addEventListener('click', () => {
          windowId = w.id;
          renderWindows();
        });
        return b;
      }),
    );
  }

  createCalendar({
    container: calHost,
    minDate: today,
    maxDate: addDays(today, 120),
    value: day,
    onChange: (d) => {
      day = d;
      dayError.textContent = '';
      renderWindows();
    },
  });
  renderWindows();

  // Legal entity (company) step.
  const sw = h('input', { type: 'checkbox', id: 'asCompany', checked: state.asCompany });
  const summary = h('div', { id: 'companySummary' });
  function renderSummary() {
    summary.replaceChildren();
    if (state.asCompany && state.company) {
      const edit = h('button', { type: 'button', class: 'hp-link-btn' }, t('details.companyEdit'));
      edit.addEventListener('click', editCompany);
      summary.append(h('div', { class: 'hp-company-summary' }, h('span', {}, createIcon('building', { size: 18 }), ' ', state.company.name), edit));
    }
  }
  async function editCompany() {
    const values = await openCompanyDialog(state.company ?? state.account.company);
    if (values) state.company = values;
    if (!state.company) {
      state.asCompany = false;
      sw.checked = false;
    }
    renderSummary();
  }
  sw.addEventListener('change', async () => {
    state.asCompany = sw.checked;
    if (sw.checked && !state.company) await editCompany();
    renderSummary();
  });
  renderSummary();

  const submit = h('button', { type: 'button', class: 'button button--primary hp-btn', id: 'confirmOrder' }, t('details.submit'));
  const formError = h('div', { role: 'alert' });
  submit.addEventListener('click', async () => {
    formError.replaceChildren();
    if (!day) {
      dayError.textContent = t('details.err.day');
      return;
    }
    if (!windowId) {
      formError.append(h('div', { class: 'hp-notice hp-notice--error' }, t('details.err.window')));
      return;
    }
    if (state.asCompany && (!state.company || Object.keys(validateCompany(state.company)).length)) {
      formError.append(h('div', { class: 'hp-notice hp-notice--error' }, t('details.err.company')));
      return;
    }
    submit.disabled = true;
    submit.classList.add('is-loading');
    try {
      const order = await api.createOrder({ quoteToken: state.quote.quoteToken, pickupDate: day, timeWindow: windowId, asCompany: state.asCompany });
      orders.save({ ...order, ownerId: state.account.id });
      // Demo: forget the company form and the used quote.
      state.company = null;
      state.asCompany = false;
      state.quote = null;
      state.quoteKey = null;
      toast(t('order.created', { id: order.id }), 'success');
      navigate(`#/orders/${order.id}`);
    } catch (err) {
      submit.disabled = false;
      submit.classList.remove('is-loading');
      formError.append(h('div', { class: 'hp-notice hp-notice--error' }, createIcon('warning', { size: 18 }), h('span', {}, errorText(err))));
      if (err.code === 'QUOTE_EXPIRED' || err.code === 'QUOTE_INVALID') state.quote = null;
    }
  });

  main.append(
    h('a', { class: 'hp-back', href: '#/book/result' }, createIcon('back', { size: 20 }), 'Atgal'),
    h('p', { class: 'hp-eyebrow' }, t('details.eyebrow')),
    h('h1', { class: 'hp-title' }, t('details.title')),
    h('section', { class: 'hp-card' }, h('h2', { class: 'hp-h2' }, t('details.day')), calHost, dayError),
    h('section', { class: 'hp-card' }, h('h2', { class: 'hp-h2' }, t('details.window')), winHost),
    h(
      'section',
      { class: 'hp-card' },
      h('label', { class: 'hp-switch', for: 'asCompany' }, h('span', {}, h('span', { class: 'hp-choice-title' }, t('details.company')), h('br'), h('span', { class: 'hp-small' }, t('details.companySub'))), sw, h('span', { class: 'hp-switch-track', 'aria-hidden': 'true' })),
      summary,
    ),
    h('div', { class: 'hp-summary-total' }, h('span', { class: 'hp-muted' }, t('details.total')), h('strong', {}, eur(state.quote.totalEur))),
    formError,
    submit,
  );
}
