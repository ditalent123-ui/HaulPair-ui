import { h } from '../../dom.js';
import { createIcon } from '../../icons.js';
import { api } from '../api.js';
import { ago, longDate, num } from '../format.js';
import { t } from '../strings.js';

/** Krovinių birža — read-only DEMO list of cargo offers and available trucks. No matching. */
export async function renderExchange(main) {
  const data = await api.exchange();
  let tab = 'cargo';
  const panel = h('div', { id: 'exchangePanel' });
  const tabCargo = h('button', { type: 'button', role: 'tab', 'aria-selected': 'true', id: 'tabCargo' }, `${t('exchange.cargo')} (${data.cargoOffers.length})`);
  const tabTrucks = h('button', { type: 'button', role: 'tab', 'aria-selected': 'false', id: 'tabTrucks' }, `${t('exchange.trucks')} (${data.trucks.length})`);

  function render() {
    tabCargo.setAttribute('aria-selected', String(tab === 'cargo'));
    tabTrucks.setAttribute('aria-selected', String(tab === 'trucks'));
    const items =
      tab === 'cargo'
        ? data.cargoOffers.map((o) =>
            h(
              'li',
              { class: 'hp-list-item' },
              h('span', { class: 'hp-list-title' }, `${o.cargoLabel}, ${num(o.amountT, 1)} t`, h('span', { class: 'hp-tag-demo' }, 'DEMO')),
              h('span', { class: 'hp-list-meta', style: null }, `${o.from} → ${o.to} · ${longDate(o.date)}`),
              h('span', { class: 'hp-list-meta' }, o.shipper, o.note ? ` · ${o.note}` : ''),
            ),
          )
        : data.trucks.map((tr) =>
            h(
              'li',
              { class: 'hp-list-item' },
              h('span', { class: 'hp-list-title' }, tr.truckLabel, h('span', { class: 'hp-plate' }, tr.plate), h('span', { class: 'hp-tag-demo' }, 'DEMO')),
              h('span', { class: 'hp-list-meta' }, `${tr.base}, ${t('exchange.heading')} ${tr.heading} · ${t('exchange.free')} ${longDate(tr.freeFrom)}`),
              h('span', { class: 'hp-list-meta' }, `${tr.carrier} · ${t('exchange.capacity', { t: num(tr.freeCapacityT, 1) })}`),
            ),
          );
    panel.replaceChildren(h('ul', { class: 'hp-list', role: 'tabpanel' }, items));
  }
  tabCargo.addEventListener('click', () => { tab = 'cargo'; render(); });
  tabTrucks.addEventListener('click', () => { tab = 'trucks'; render(); });
  render();

  main.className = 'hp-main hp-main--wide';
  main.append(
    h('h1', { class: 'hp-title' }, t('exchange.title')),
    h('p', { class: 'hp-lead' }, t('exchange.lead')),
    h('div', { class: 'hp-notice hp-notice--demo', role: 'note' }, createIcon('info', { size: 18 }), h('span', {}, `DEMO duomenys · atnaujinta ${ago(data.updatedAt)}`)),
    h('div', { class: 'hp-section-gap' }),
    h('div', { class: 'hp-tabs', role: 'tablist' }, tabCargo, tabTrucks),
    panel,
  );
}
