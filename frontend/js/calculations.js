import { h } from './dom.js';
import { createIcon } from './icons.js';
import { fmt, getLocale, t } from './i18n.js';

const localGrain = (c) => c.cargoTypeNames?.[getLocale()] ?? c.cargoTypeNames?.en ?? c.cargoTypeName;

/**
 * View rendering for results, costs, saved history and activity.
 * Pure view code: receives data, returns DOM. No API calls here.
 *
 * Cargo is displayed in kilograms (the store keeps tonnes); €/t and €/tkm stay
 * per tonne. Volume utilisation shows "—" when no positive density was given.
 */

const kg = (tonnes) => (tonnes === null || tonnes === undefined ? null : Math.round(tonnes * 1000));

function headline(label, value, sub, variant) {
  return h(
    'div',
    { class: `headline headline--${variant}` },
    h('div', { class: 'headline-label' }, label),
    h('div', { class: 'headline-value' }, value),
    sub ? h('div', { class: 'headline-sub' }, sub) : null,
  );
}

function metric(iconName, label, value, sub, meter) {
  return h(
    'div',
    { class: 'metric' },
    h('div', { class: 'metric-label' }, createIcon(iconName, { size: 14 }), label),
    h('div', { class: 'metric-value' }, value),
    meter ?? null,
    sub ? h('div', { class: 'metric-sub' }, sub) : null,
  );
}

function meter(pct, { over = false } = {}) {
  const bar = h('span', { class: 'meter-bar' });
  if (pct !== null && pct !== undefined) {
    bar.style.width = `${Math.min(pct, 100)}%`;
    if (over || pct > 100) bar.classList.add('is-over');
    else if (pct >= 99.95) bar.classList.add('is-full');
  }
  return h('span', { class: 'meter' }, bar);
}

function utilisationLabel(pct) {
  if (pct === null || pct === undefined) return '—';
  if (pct >= 99.95 && pct <= 100.05) return t('results.fullLoad');
  return `${fmt.number(pct, 1)} %`;
}

function notices({ warnings = [], assumptions = [], extra = [] }) {
  const items = [
    ...extra.map((n) => ({ type: n.type ?? 'info', text: n.text })),
    ...warnings.map((text) => ({ type: 'warning', text })),
    ...assumptions.map((text) => ({ type: 'info', text })),
  ];
  if (items.length === 0) return null;
  return h(
    'div',
    {},
    h('h3', { class: 'section-title' }, t('results.notices')),
    h(
      'ul',
      { class: 'notice-list' },
      items.map((n) =>
        h('li', { class: `notice notice--${n.type}` }, createIcon(n.type === 'warning' ? 'warning' : 'info', { size: 15 }), h('span', {}, n.text)),
      ),
    ),
  );
}

function profileBadge(route) {
  return h(
    'span',
    { class: `badge ${route.truckRestrictionsApplied ? 'badge--ok' : 'badge--warn'}` },
    route.truckRestrictionsApplied ? t('status.routingTruck') : t('status.routingCar'),
  );
}

/** Rezultatai tab: headline total + €/t + €/tkm, then the metric grid, notices, save. */
export function renderResults(container, view) {
  const { route, calc, inputs, routeWarnings = [], extraNotices = [], saved, onSave, recalcNeeded } = view;
  const r = calc.rounded;
  const durationSub = route.truckRestrictionsApplied ? t('results.durationTruck') : t('results.durationCar');
  const modeLabel = calc.returnMode === 'empty' ? t('route.returnEmpty') : t('route.returnLoaded');
  const qtyKg = kg(inputs?.cargo?.quantityT);
  const capKg = kg(inputs?.truck?.capacityT);

  const header = h(
    'div',
    { class: 'results-header' },
    h('span', { class: 'results-route' }, `${route.origin.label.split(',')[0]} → ${route.destination.label.split(',')[0]}`),
    profileBadge(route),
    h('span', { class: 'results-meta' }, t('results.routeVia', { provider: route.provider, profile: route.profile })),
    saved ? h('span', { class: 'results-meta' }, t('results.saved', { date: fmt.dateTime(saved.createdAt) })) : null,
    recalcNeeded ? h('div', { class: 'recalc-flag' }, t('fuel.recalcNeeded')) : null,
  );

  const headlineGrid = h(
    'div',
    { class: 'headline-grid' },
    headline(t('results.total'), fmt.currency(r.totalCostEur), t('results.disclaimer'), 'total'),
    headline(t('results.perTonne'), fmt.currency(r.costPerTonneEur), null, 'sec'),
    headline(t('results.perTonneKm'), fmt.currency(r.costPerTonneKmEur, { decimals: 4 }), null, 'sec'),
  );

  const metrics = h(
    'div',
    { class: 'metric-grid' },
    metric('route', t('results.distance'), fmt.unit(r.distanceKm, 'km', 1), calc.returnMode !== 'none' ? t('results.returnLeg', { mode: modeLabel }) : null),
    metric('history', t('results.duration'), r.durationS === null ? t('results.durationUnavailable') : fmt.duration(r.durationS), durationSub),
    metric('fuel', t('results.fuel'), fmt.unit(r.fuelLitres, 'l', 1)),
    metric('costs', t('results.fuelCost'), fmt.currency(r.fuelCostEur)),
    metric(
      'cargo',
      t('results.utilization'),
      utilisationLabel(r.capacityUtilizationPct),
      qtyKg !== null ? `${fmt.number(qtyKg, 0)} / ${fmt.number(capKg, 0)} kg` : null,
      meter(r.capacityUtilizationPct),
    ),
    metric(
      'cargo',
      t('results.volume'),
      utilisationLabel(r.volumeUtilizationPct),
      r.volumeUtilizationPct === null
        ? t('results.volumeNeedsDensity')
        : calc.volume
          ? `${fmt.number(calc.volume.requiredM3, 1)} / ${fmt.number(calc.volume.availableM3, 1)} m³`
          : null,
      r.volumeUtilizationPct === null ? null : meter(r.volumeUtilizationPct),
    ),
  );

  const children = [header, headlineGrid, metrics, notices({ warnings: [...routeWarnings, ...calc.warnings], assumptions: calc.assumptions, extra: extraNotices })];

  if (onSave) {
    const labelInput = h('input', { type: 'text', id: 'saveLabel', maxlength: '120', placeholder: t('results.savePlaceholder') });
    const saveButton = h('button', { type: 'button', class: 'button button--primary' }, createIcon('save', { size: 16 }), h('span', {}, t('action.save')));
    saveButton.addEventListener('click', async () => {
      saveButton.disabled = true;
      saveButton.replaceChildren(document.createTextNode(t('action.saving')));
      try {
        await onSave(labelInput.value.trim());
        saveButton.replaceChildren(createIcon('check', { size: 16 }));
      } catch {
        saveButton.disabled = false;
        saveButton.replaceChildren(createIcon('save', { size: 16 }), h('span', {}, t('action.save')));
      }
    });
    children.push(h('div', { class: 'save-row' }, h('div', { class: 'field' }, h('label', { for: 'saveLabel' }, t('results.saveLabel')), labelInput), saveButton));
  }

  container.replaceChildren(...children);
}

/** Išlaidos tab: cost breakdown, route legs, utilisation detail, fuel origin. */
export function renderCosts(container, view) {
  if (!view) {
    renderEmpty(container, 'results.emptyTitle', 'results.emptyText');
    return;
  }
  const { route, calc, inputs, fuelOrigin } = view;
  const r = calc.rounded;

  const summary = h(
    'div',
    { class: 'results-header' },
    h('span', { class: 'results-route' }, `${route.origin.label.split(',')[0]} → ${route.destination.label.split(',')[0]}`),
    profileBadge(route),
    fuelOrigin ? h('span', { class: 'results-meta' }, `${t('results.fuelPriceOrigin')}: ${fuelOrigin}`) : null,
  );

  const breakdown = h(
    'div',
    {},
    h('h3', { class: 'section-title' }, t('results.breakdown')),
    h(
      'table',
      { class: 'table' },
      h('thead', {}, h('tr', {}, h('th', {}, t('results.item')), h('th', {}, t('results.source')), h('th', { class: 'num' }, t('results.amount')))),
      h(
        'tbody',
        {},
        r.costLines.map((c) =>
          h('tr', {}, h('td', {}, t(`cost.${c.key}`)), h('td', {}, h('span', { class: 'badge' }, t(`source.${c.source}`))), h('td', { class: 'num' }, fmt.currency(c.amountEur))),
        ),
      ),
      h('tfoot', {}, h('tr', {}, h('td', { colspan: '2' }, t('results.totalRow')), h('td', { class: 'num' }, fmt.currency(r.totalCostEur)))),
    ),
  );

  const legs = h(
    'div',
    {},
    h('h3', { class: 'section-title' }, t('results.legs')),
    h(
      'table',
      { class: 'table' },
      h('thead', {}, h('tr', {}, h('th', {}, t('results.leg')), h('th', { class: 'num' }, 'km'), h('th', { class: 'num' }, 'l/100 km'), h('th', { class: 'num' }, 'l'))),
      h(
        'tbody',
        {},
        calc.legs.map((l) =>
          h(
            'tr',
            {},
            h('td', {}, `${t(`results.leg.${l.leg}`)} (${l.loaded ? t('results.loaded') : t('results.empty')})`),
            h('td', { class: 'num' }, fmt.number(l.distanceKm, 1)),
            h('td', { class: 'num' }, fmt.number(l.fuelConsumptionLPer100Km, 1)),
            h('td', { class: 'num' }, fmt.number(l.fuelLitres, 1)),
          ),
        ),
      ),
    ),
  );

  const qtyKg = kg(inputs?.cargo?.quantityT);
  const capKg = kg(inputs?.truck?.capacityT);
  const util = h(
    'div',
    {},
    h('h3', { class: 'section-title' }, `${t('results.utilization')} · ${t('results.volume')}`),
    h(
      'div',
      { class: 'metric-grid' },
      metric('cargo', t('results.utilization'), utilisationLabel(r.capacityUtilizationPct), qtyKg !== null ? `${fmt.number(qtyKg, 0)} / ${fmt.number(capKg, 0)} kg` : null, meter(r.capacityUtilizationPct)),
      metric(
        'cargo',
        t('results.volume'),
        utilisationLabel(r.volumeUtilizationPct),
        r.volumeUtilizationPct === null ? t('results.volumeNeedsDensity') : calc.volume ? `${fmt.number(calc.volume.requiredM3, 1)} / ${fmt.number(calc.volume.availableM3, 1)} m³` : null,
        r.volumeUtilizationPct === null ? null : meter(r.volumeUtilizationPct),
      ),
    ),
  );

  container.replaceChildren(summary, h('div', { class: 'results-columns' }, breakdown, h('div', {}, legs, util)));
}

export function renderEmpty(container, titleKey, textKey) {
  container.replaceChildren(
    h('div', { class: 'empty-state' }, h('p', { class: 'empty-title' }, t(titleKey)), textKey ? h('p', {}, t(textKey)) : null),
  );
}

export function renderError(container, message, onRetry) {
  container.replaceChildren(
    h('div', { class: 'error-state', role: 'alert' }, h('p', {}, message), onRetry ? h('button', { type: 'button', class: 'button button--small', onclick: onRetry }, t('action.retry')) : null),
  );
}

export function renderHistory(container, { items, total, limit, offset, currentId, onOpen, onDelete, onPage }) {
  if (items.length === 0 && offset === 0) {
    renderEmpty(container, 'history.emptyTitle', 'history.emptyText');
    return;
  }
  const list = h(
    'ul',
    { class: 'list' },
    items.map((c) => {
      const title = c.label || `${c.originLabel.split(',')[0]} → ${c.destinationLabel.split(',')[0]}`;
      return h(
        'li',
        { class: `list-item${c.id === currentId ? ' is-current' : ''}` },
        h(
          'div',
          {},
          h('div', { class: 'list-title' }, title),
          h(
            'div',
            { class: 'list-meta' },
            h('span', {}, fmt.dateTime(c.createdAt)),
            h('span', {}, `${fmt.number(c.outboundDistanceKm, 1)} km${c.returnMode !== 'none' ? ' + ↩' : ''}`),
            h('span', {}, `${localGrain(c)} · ${fmt.number(kg(c.cargoQuantityT), 0)} kg`),
            h('span', {}, c.truckName),
            h('span', {}, `${c.routingProvider}/${c.routingProfile}`),
          ),
        ),
        h(
          'div',
          { class: 'list-actions' },
          h('span', { class: 'list-amount' }, fmt.currency(c.totalCostEur)),
          h('button', { type: 'button', class: 'button button--small', onclick: () => onOpen(c.id) }, t('action.open')),
          h('button', { type: 'button', class: 'button button--small', 'aria-label': `${t('action.delete')}: ${title}`, onclick: () => onDelete(c.id, title) }, t('action.delete')),
        ),
      );
    }),
  );
  const pager = h(
    'div',
    { class: 'pagination' },
    h('span', {}, t('history.total', { count: total })),
    h(
      'span',
      { class: 'list-actions' },
      h('button', { type: 'button', class: 'button button--small', disabled: offset === 0, onclick: () => onPage(Math.max(0, offset - limit)) }, t('action.newer')),
      h('button', { type: 'button', class: 'button button--small', disabled: offset + limit >= total, onclick: () => onPage(offset + limit) }, t('action.older')),
    ),
  );
  container.replaceChildren(list, pager);
}

export function renderActivity(container, entries) {
  if (entries.length === 0) {
    renderEmpty(container, 'activity.empty');
    return;
  }
  container.replaceChildren(
    h(
      'div',
      {},
      entries.map((e) => {
        const d = e.details ?? {};
        const summary = [
          d.origin && d.destination ? `${String(d.origin).split(',')[0]} → ${String(d.destination).split(',')[0]}` : null,
          d.distanceKm !== undefined ? `${fmt.number(d.distanceKm, 1)} km` : null,
          d.totalCostEur !== undefined ? fmt.currency(d.totalCostEur) : null,
          d.provider ? d.provider : null,
          d.fuelType ? d.fuelType : null,
          d.errorCode ? d.errorCode : null,
          e.entityId && !d.origin ? String(e.entityId).slice(0, 8) : null,
        ]
          .filter(Boolean)
          .join(' · ');
        return h(
          'div',
          { class: 'activity-item' },
          h('span', { class: 'activity-time' }, fmt.dateTime(e.createdAt)),
          h('span', { class: 'activity-type' }, e.eventType),
          h('span', {}, summary),
        );
      }),
    ),
  );
}
