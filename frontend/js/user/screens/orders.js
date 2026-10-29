import { h, toast } from '../../dom.js';
import { createIcon } from '../../icons.js';
import { countdown, eur, longDate, num } from '../format.js';
import { createUserMap } from '../mapView.js';
import { loadOptions, navigate, onLeave, state } from '../main.js';
import { orders } from '../storage.js';
import { t } from '../strings.js';
import { computeState, createSimulatedPositionProvider, preparePolyline } from '../tracking.js';

const STEPS = ['ordered', 'assigned', 'en_route', 'arrived', 'loaded', 'delivered'];
const stepIndex = (phase) => (phase === 'scheduled' ? 1 : STEPS.indexOf(phase));

function myOrders() {
  return orders.all().filter((o) => !o.ownerId || o.ownerId === state.account.id);
}

function statusPill(phase) {
  const cls = phase === 'delivered' ? 'hp-pill hp-pill--done' : ['en_route', 'loaded', 'arrived'].includes(phase) ? 'hp-pill hp-pill--live' : 'hp-pill';
  return h('span', { class: cls }, t(`order.status.${phase}`));
}

export function renderOrders(main) {
  const list = myOrders();
  main.append(h('h1', { class: 'hp-title' }, t('orders.title')));
  if (!list.length) {
    main.append(
      h(
        'div',
        { class: 'hp-card hp-empty' },
        createIcon('truck', { size: 36 }),
        h('p', { class: 'hp-empty-title' }, t('orders.empty')),
        h('p', {}, t('orders.emptySub')),
        h('div', { class: 'hp-section-gap' }),
        h('a', { class: 'button button--primary hp-btn', href: '#/book' }, t('orders.new')),
      ),
    );
    return;
  }
  main.append(
    h(
      'ul',
      { class: 'hp-list', id: 'ordersList' },
      list.map((o) => {
        const s = computeState(o, Date.now(), { approach: preparePolyline(o.legs.approach.geometry), delivery: preparePolyline(o.legs.delivery.geometry) });
        return h(
          'li',
          {},
          h(
            'a',
            { class: 'hp-list-item', href: `#/orders/${o.id}` },
            h('span', { class: 'hp-list-title' }, `${o.cargo.label}, ${num(o.cargo.amountT, 1)} t`, statusPill(s.phase)),
            h('span', { class: 'hp-list-meta', style: null }, `${o.from.label} → ${o.to.label}`),
            h('span', { class: 'hp-list-meta' }, `${longDate(o.pickupDate)}, ${o.timeWindow.label} · ${eur(o.totalEur)}`),
          ),
        );
      }),
    ),
  );
}

export async function renderOrder(main, id) {
  const order = orders.get(id);
  if (!order) {
    main.append(h('div', { class: 'hp-card hp-empty' }, createIcon('warning', { size: 32 }), h('p', { class: 'hp-empty-title' }, t('order.notFound')), h('a', { class: 'hp-btn-secondary', href: '#/orders' }, t('orders.title'))));
    return;
  }
  await loadOptions();
  main.className = 'hp-main hp-main--map';

  const mapEl = h('div', { class: 'hp-map', id: 'orderMap', role: 'region', 'aria-label': 'Sunkvežimio vieta žemėlapyje' });
  const demoRoute = order.legs.approach.demo || order.legs.delivery.demo;
  const badges = h(
    'div',
    { class: 'hp-map-badges' },
    h('span', { class: 'hp-map-badge hp-map-badge--live', id: 'liveBadge' }, h('span', { class: 'hp-live-dot' }), t('order.live')),
    demoRoute ? h('span', { class: 'hp-map-badge hp-map-badge--demo' }, t('result.demoRoute')) : null,
  );
  const back = h('a', { class: 'hp-back-fab', href: '#/orders' }, createIcon('back', { size: 20 }), t('nav.orders'));

  const statusTitle = h('h1', { class: 'hp-status-title', id: 'orderStatus' });
  const eta = h('p', { class: 'hp-eta', id: 'orderEta', 'aria-live': 'polite' });
  const timeline = h('ol', { class: 'hp-timeline', id: 'orderTimeline' }, STEPS.map((s) => h('li', { dataset: { step: s } }, t(`order.status.${s}`))));
  const action = h('div', { id: 'orderAction' });
  const speed = h('div', { class: 'hp-speed', id: 'demoSpeed' });

  const sheet = h(
    'section',
    { class: 'hp-sheet' },
    h('div', { class: 'hp-sheet-handle' }),
    h('div', { class: 'hp-status' }, statusTitle, h('span', { class: 'hp-small' }, order.id)),
    eta,
    h('p', { class: 'hp-small' }, `${t('order.when')}: `, h('strong', { id: 'orderWhen' }, `${longDate(order.pickupDate)}, ${order.timeWindow.label}`)),
    h('div', { class: 'hp-section-gap' }),
    h(
      'div',
      { class: 'hp-truck-row' },
      h('span', { class: 'hp-truck-icon' }, createIcon('truck', { size: 26 })),
      h(
        'div',
        {},
        h('div', { class: 'hp-choice-title' }, `${order.truck.type} · ${order.truck.classLabel}`, order.truck.count > 1 ? ` ${t('order.trucks', { n: order.truck.count - 1 })}` : ''),
        h('div', { class: 'hp-row' }, h('span', { class: 'hp-plate', id: 'truckPlate' }, order.truck.plate), h('span', { class: 'hp-small' }, `${t('order.driver')}: ${order.driver.name}`)),
      ),
    ),
    action,
    h('div', { class: 'hp-section-gap' }),
    timeline,
    h(
      'dl',
      { class: 'hp-kv' },
      h('dt', {}, t('order.cargo')), h('dd', {}, `${order.cargo.label}, ${num(order.cargo.amountT, 1)} t`),
      h('dt', {}, t('order.route')), h('dd', {}, `${order.from.label} → ${order.to.label} (${num(order.legs.delivery.distanceKm, 0)} km)`),
      h('dt', {}, t('order.carrier')), h('dd', {}, order.carrier),
      h('dt', {}, t('order.total')), h('dd', {}, eur(order.totalEur)),
      h('dt', {}, t('order.invoice')), h('dd', {}, order.invoiceToCompany ? t('order.invoiceCompany') : t('order.invoicePerson')),
    ),
    speed,
  );
  main.append(h('div', { class: 'hp-map-screen' }, mapEl, badges, back, sheet));

  const map = createUserMap(mapEl, state.mapConfig);
  map.showRoute({
    from: order.from,
    to: order.to,
    legs: [
      { geometry: order.legs.approach.geometry, style: 'approach' },
      { geometry: order.legs.delivery.geometry, style: 'main' },
    ],
  });

  const provider = createSimulatedPositionProvider(order, { onOrderChange: (o) => orders.save(o) });
  let lastPhase = null;

  function renderAction(phase) {
    action.replaceChildren();
    let btn;
    if (phase === 'arrived') {
      btn = h('button', { type: 'button', class: 'button button--primary hp-btn', id: 'actionButton' }, t('order.confirmLoaded'));
      btn.addEventListener('click', () => provider.confirmLoaded());
    } else if (phase === 'delivered') {
      btn = h('a', { class: 'button button--primary hp-btn', href: '#/book', id: 'actionButton' }, t('order.again'));
    } else if (phase === 'scheduled') {
      btn = h('button', { type: 'button', class: 'button button--primary hp-btn', id: 'actionButton' }, t('order.cancel'));
      btn.addEventListener('click', () => {
        if (!window.confirm(t('order.cancelConfirm'))) return;
        orders.remove(order.id);
        toast(t('order.cancelled'));
        navigate('#/orders');
      });
    } else {
      btn = h('button', { type: 'button', class: 'button button--primary hp-btn', id: 'actionButton' }, createIcon('message', { size: 20 }), t('order.message'));
      btn.addEventListener('click', () => toast(t('order.messageDemo')));
    }
    action.append(btn);
  }

  function renderSpeed(phase) {
    speed.replaceChildren();
    if (!['assigned', 'en_route', 'loaded', 'ordered'].includes(phase)) return;
    const current = order.sim?.multiplier ?? 1;
    speed.append(h('span', { class: 'hp-small' }, t('order.speed')));
    for (const m of [1, 10, 60]) {
      const b = h('button', { type: 'button', 'aria-pressed': String(current === m), dataset: { speed: m } }, `×${m}`);
      b.addEventListener('click', () => {
        provider.setSpeed(m);
        renderSpeed(provider.state.phase);
      });
      speed.append(b);
    }
  }

  provider.subscribe((s) => {
    map.setTruck(s.lat, s.lon);
    statusTitle.textContent = t(`order.status.${s.phase}`);
    const idx = stepIndex(s.phase);
    for (const li of timeline.children) {
      const i = STEPS.indexOf(li.dataset.step);
      li.className = i < idx || (s.phase === 'delivered' && i === idx) ? 'is-done' : i === idx ? 'is-current' : '';
    }
    if (s.phase === 'en_route' || s.phase === 'assigned' || s.phase === 'ordered') eta.replaceChildren(`${t('order.etaPickup')} `, h('strong', {}, countdown(s.etaS)));
    else if (s.phase === 'scheduled') eta.replaceChildren(`${t('order.etaScheduled')} `, h('strong', {}, countdown(s.etaS)));
    else if (s.phase === 'loaded') eta.replaceChildren(`${t('order.etaDelivery')} `, h('strong', {}, countdown(s.etaS)), ` · ${num(s.legKmLeft, 0)} km`);
    else if (s.phase === 'arrived') eta.textContent = t('order.arrived');
    else eta.textContent = t('order.delivered');
    if (s.phase !== lastPhase) {
      renderAction(s.phase);
      renderSpeed(s.phase);
      if (s.phase === 'loaded') map.fit(order.legs.delivery.geometry);
      else if (['scheduled', 'assigned', 'en_route', 'ordered'].includes(s.phase) && lastPhase === null) map.fit([...order.legs.approach.geometry, [order.to.lat, order.to.lon]]);
      lastPhase = s.phase;
    }
    document.getElementById('liveBadge')?.toggleAttribute('hidden', s.phase === 'scheduled' || s.phase === 'delivered');
  });
  provider.start();
  onLeave(() => {
    provider.stop();
    map.destroy();
  });
}
