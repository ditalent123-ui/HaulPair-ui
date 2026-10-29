import { h } from '../../dom.js';
import { createIcon } from '../../icons.js';
import { api } from '../api.js';
import { createCombo } from '../combo.js';
import { ago, eur, num, shortDateTime } from '../format.js';
import { errorText, loadOptions } from '../main.js';
import { t } from '../strings.js';
import { isValidAmountT, parseAmountT } from '../validators.js';
import { placeItems } from './booking.js';

/**
 * "Kainos ir geriausias maršrutas" — carrier tab, and the ONLY place where the
 * diesel price is shown. Every price carries its source and timestamp; seeded
 * data is labelled DEMO. Ranking is computed by the backend (deterministic).
 */

const SVG = 'http://www.w3.org/2000/svg';
function sparkline(values) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 300 56');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'hp-spark');
  svg.setAttribute('role', 'img');
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 296 + 2, 50 - ((v - min) / span) * 42]);
  const line = pts.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ');
  const area = document.createElementNS(SVG, 'path');
  area.setAttribute('d', `M${pts[0][0]},54 L${line.replace(/ /g, ' L')} L${pts[pts.length - 1][0]},54 Z`);
  area.setAttribute('class', 'hp-spark-area');
  const pl = document.createElementNS(SVG, 'polyline');
  pl.setAttribute('points', line);
  pl.setAttribute('class', 'hp-spark-line');
  const dot = document.createElementNS(SVG, 'circle');
  const last = pts[pts.length - 1];
  dot.setAttribute('cx', last[0]);
  dot.setAttribute('cy', last[1]);
  dot.setAttribute('r', '3.5');
  dot.setAttribute('class', 'hp-spark-dot');
  svg.append(area, pl, dot);
  return svg;
}

const demoTag = (demo) => (demo ? h('span', { class: 'hp-tag-demo' }, t('prices.demo')) : null);
const sourceLine = (name, updatedAt, demo) =>
  h('p', { class: 'hp-source' }, demoTag(demo), `${t('prices.source')}: ${name}`, ' · ', `${t('prices.updated')} ${shortDateTime(updatedAt)} (${ago(updatedAt)})`);

function dieselCard(d, aiManaged) {
  const trend = d.history?.map((x) => x.eurPerL) ?? [];
  return h(
    'section',
    { class: 'hp-card', id: 'dieselCard' },
    h('h2', { class: 'hp-h2' }, createIcon('fuel', { size: 20 }), ' ', t('prices.diesel')),
    h('p', { class: 'hp-price-big' }, `${num(d.eurPerL, 3)} €/l`),
    sourceLine(d.sourceName, d.updatedAt, d.demo),
    aiManaged ? h('p', { class: 'hp-small' }, t('prices.ai')) : null,
    trend.length > 1 ? sparkline(trend) : null,
  );
}

function grainCard(points) {
  return h(
    'section',
    { class: 'hp-card', id: 'grainCard' },
    h('h2', { class: 'hp-h2' }, createIcon('cargo', { size: 20 }), ' ', t('prices.grain')),
    points.length ? sourceLine(points[0].prices[0].sourceName, points[0].prices[0].updatedAt, points[0].prices[0].demo) : null,
    points.map((p) =>
      h(
        'div',
        { class: 'hp-grain-point' },
        h('div', { class: 'hp-grain-name' }, p.name),
        h('div', { class: 'hp-small' }, p.region),
        h(
          'div',
          { class: 'hp-grain-prices' },
          p.prices.map((x) =>
            h(
              'div',
              { class: 'hp-grain-price', title: `${t('prices.source')}: ${x.sourceName}, ${shortDateTime(x.updatedAt)}` },
              h('div', { class: 'hp-small' }, x.label, ' ', demoTag(x.demo)),
              h('div', { class: 'hp-grain-price-value' }, `${num(x.eurPerT, 0)} €/t`),
              h('div', { class: 'hp-small' }, ago(x.updatedAt)),
            ),
          ),
        ),
      ),
    ),
  );
}

function optionCard(o, rankLabel, best, result) {
  const assumption = [
    `Kaina atnaujinta ${ago(o.priceUpdatedAt)}${o.priceDemo ? ' (DEMO)' : ''}`,
    `kuras ${num(result.diesel.eurPerL, 2)} €/l${result.diesel.demo ? ' (DEMO)' : ''}`,
    o.routeDemo ? 'atstumas pagal DEMO maršrutą' : 'sunkvežimio maršrutas',
    'be vairuotojo išlaidų',
  ].join(' · ');
  return h(
    'article',
    { class: `hp-option${best ? ' hp-option--best' : ''}`, dataset: { rank: o.rank } },
    h('p', { class: 'hp-option-rank' }, rankLabel),
    h('p', { class: 'hp-option-name' }, o.name),
    h('p', {}, h('span', { class: 'hp-option-net' }, eur(o.netEur)), ' ', h('span', { class: 'hp-muted' }, `${t('prices.net')} · ${eur(o.netPerTonneEur, 2)} ${t('prices.netPerT')}`)),
    h(
      'div',
      { class: 'hp-option-grid' },
      h('span', {}, t('prices.price')), h('span', {}, `${num(o.grainPriceEurPerT, 0)} €/t`),
      h('span', {}, t('prices.revenue')), h('span', {}, eur(o.revenueEur)),
      h('span', {}, t('prices.cost')), h('span', {}, `− ${eur(o.transportCostEur)}`),
      h('span', {}, t('prices.distance')), h('span', {}, `${num(o.distanceKm, 0)} km`),
    ),
    h('p', { class: 'hp-assumption' }, assumption),
  );
}

function plannerCard(options) {
  const grainTypes = options.cargoTypes.filter((c) => ['wheat', 'barley', 'rapeseed', 'oats', 'rye', 'corn'].includes(c.id));
  let pickup = null;
  const pickupInput = h('input', { class: 'hp-input', id: 'plannerPickup', placeholder: t('book.pickupPh') });
  const cargo = h('select', { class: 'hp-select', id: 'plannerCargo' }, grainTypes.map((c) => h('option', { value: c.id }, c.label)));
  const amount = h('input', { class: 'hp-input', id: 'plannerAmount', inputmode: 'decimal', value: '24', 'aria-label': 'Kiekis tonomis' });
  const error = h('p', { class: 'hp-error', role: 'alert' });
  const results = h('div', { id: 'plannerResults', 'aria-live': 'polite' });
  const btn = h('button', { type: 'submit', class: 'button button--primary hp-btn', id: 'plannerButton' }, t('prices.compare'));

  const pickupWrap = h('div', { class: 'hp-input-wrap' }, pickupInput);
  createCombo({ input: pickupInput, minChars: 2, getItems: placeItems, onSelect: (i) => { pickup = i.value; }, onClear: () => { pickup = null; } });

  const form = h(
    'form',
    { novalidate: true },
    h('div', { class: 'hp-field' }, h('label', { class: 'hp-label', for: 'plannerPickup' }, t('book.pickup')), pickupWrap),
    h('div', { class: 'hp-two-col' },
      h('div', { class: 'hp-field' }, h('label', { class: 'hp-label', for: 'plannerCargo' }, t('book.cargo')), cargo, h('span', { class: 'hp-hint' }, t('prices.cargoHint'))),
      h('div', { class: 'hp-field' }, h('label', { class: 'hp-label', for: 'plannerAmount' }, t('book.amount')), h('div', { class: 'hp-amount' }, amount, h('span', { class: 'hp-amount-unit' }, 't')))),
    error,
    btn,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.textContent = '';
    const a = parseAmountT(amount.value);
    if (!pickup) return void (error.textContent = t('book.err.pickup'));
    if (!isValidAmountT(a)) return void (error.textContent = t('book.err.amount'));
    btn.disabled = true;
    results.replaceChildren(h('div', { class: 'hp-loading' }, h('span', { class: 'spinner' }), t('book.searching')));
    try {
      const r = await api.planner({ pickup, cargoType: cargo.value, amountT: a });
      if (!r.options.length) {
        results.replaceChildren(h('div', { class: 'hp-empty' }, h('p', { class: 'hp-empty-title' }, t('prices.noPrices'))));
        return;
      }
      const rest = r.options.slice(2);
      results.replaceChildren(
        h('div', { class: 'hp-section-gap' }),
        optionCard(r.best, t('prices.best'), true, r),
        r.runnerUp ? optionCard(r.runnerUp, t('prices.runnerUp'), false, r) : null,
        rest.length
          ? h('details', { class: 'hp-section-gap' }, h('summary', { class: 'hp-link-btn' }, `${t('prices.others')} (${rest.length})`), rest.map((o) => optionCard(o, `${o.rank}.`, false, r)))
          : null,
      );
    } catch (err) {
      results.replaceChildren(h('div', { class: 'hp-notice hp-notice--error' }, errorText(err)));
    } finally {
      btn.disabled = false;
    }
  });
  return h('section', { class: 'hp-card', id: 'plannerCard' }, h('h2', { class: 'hp-h2' }, createIcon('route', { size: 20 }), ' ', t('prices.planner')), h('p', { class: 'hp-muted' }, t('prices.plannerLead')), h('div', { class: 'hp-section-gap' }), form, results);
}

export async function renderPrices(main) {
  const [options, prices] = await Promise.all([loadOptions(), api.prices()]);
  main.className = 'hp-main hp-main--wide';
  main.append(
    h('h1', { class: 'hp-title' }, t('prices.title')),
    h('p', { class: 'hp-lead' }, t('prices.lead')),
    h('div', { class: 'hp-two-col' }, h('div', {}, dieselCard(prices.diesel, prices.aiManaged), plannerCard(options)), grainCard(prices.grain)),
  );
}
