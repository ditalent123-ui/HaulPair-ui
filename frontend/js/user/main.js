import { $, h, toast } from '../dom.js';
import { createIcon } from '../icons.js';
import { request } from '../api.js';
import { api } from './api.js';
import { session } from './storage.js';
import { t } from './strings.js';
import { renderLogin } from './screens/login.js';
import { renderBookForm, renderBookResult, renderBookDetails } from './screens/booking.js';
import { renderOrder, renderOrders } from './screens/orders.js';
import { renderExchange } from './screens/exchange.js';
import { renderPrices } from './screens/prices.js';

/**
 * HaulPair end-user app: hash router, demo session and shared state.
 * Demo accounts are fixed; no real authentication happens in the browser.
 */
export const ACCOUNTS = Object.freeze({
  piemuo: {
    id: 'piemuo',
    name: 'Piemuo',
    role: 'sender',
    company: { name: 'Ūkis „Piemuo“ (demo)', code: '100000001', vat: 'LT100000001', address: 'Demo g. 1, Kėdainiai', contact: 'Piemuo', phone: '+370 000 00001', email: 'piemuo@example.com', invoice: true },
  },
  linas: {
    id: 'linas',
    name: 'Linas Agro',
    role: 'carrier',
    company: { name: 'Linas Agro (demo)', code: '100000002', vat: 'LT100000002', address: 'Demo g. 2, Panevėžys', contact: 'Linas', phone: '+370 000 00002', email: 'linas@example.com', invoice: true },
  },
});

const NAV = [
  { href: '#/book', key: 'nav.book', icon: 'route', roles: ['sender', 'carrier'], match: /^#\/book/ },
  { href: '#/orders', key: 'nav.orders', icon: 'list', roles: ['sender', 'carrier'], match: /^#\/orders/ },
  { href: '#/exchange', key: 'nav.exchange', icon: 'exchange', roles: ['sender', 'carrier'], match: /^#\/exchange/ },
  { href: '#/prices', key: 'nav.prices', icon: 'chart', roles: ['carrier'], match: /^#\/prices/ },
];

export const state = {
  account: null,
  options: null,
  mapConfig: null,
  draft: { pickup: null, destination: null, cargoType: '', amountT: '' },
  quote: null,
  quoteKey: null,
  company: null, // legal-entity form values: memory only, never stored or sent
  asCompany: false,
};

let cleanup = null;
export function onLeave(fn) {
  cleanup = fn;
}

export async function loadOptions() {
  if (!state.options) {
    const [options, cfg] = await Promise.all([api.options(), request('GET', '/config').then((r) => r.data).catch(() => null)]);
    state.options = options;
    state.mapConfig = cfg?.map ?? null;
  }
  return state.options;
}

export function errorText(err) {
  if (!err) return t('err.generic');
  if (err.code === 'NETWORK_ERROR') return t('err.network');
  const k = `err.${err.code}`;
  const s = t(k);
  return s === k ? t('err.generic') : s;
}

function renderHeader() {
  const acc = state.account;
  $('#hpAccount').hidden = !acc;
  const navHtml = (cls) =>
    acc
      ? NAV.filter((n) => n.roles.includes(acc.role)).map((n) => {
          const a = h('a', { href: n.href, class: cls, dataset: { nav: n.href } }, createIcon(n.icon, { size: 22 }), h('span', {}, t(n.key)));
          return a;
        })
      : [];
  $('#hpHeaderNav').replaceChildren(...navHtml(''));
  $('#hpBottomNav').replaceChildren(...navHtml(''));
  if (acc) {
    $('#hpAccountName').textContent = acc.name;
    $('#hpAccountRole').textContent = t(`role.${acc.role}`);
  }
}

function markActiveNav(hash) {
  for (const a of document.querySelectorAll('[data-nav]')) {
    const item = NAV.find((n) => n.href === a.dataset.nav);
    if (item?.match.test(hash)) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

export function navigate(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

export function signIn(accountId) {
  state.account = ACCOUNTS[accountId];
  session.set(accountId);
  renderHeader();
  toast(t('login.done', { name: state.account.name }), 'success');
  navigate(state.account.role === 'carrier' ? '#/prices' : '#/book');
}

function signOut() {
  session.clear();
  state.account = null;
  state.quote = null;
  state.company = null;
  state.asCompany = false;
  state.draft = { pickup: null, destination: null, cargoType: '', amountT: '' };
  renderHeader();
  toast(t('logout.done'));
  navigate('#/login');
}

async function route() {
  if (cleanup) {
    try {
      cleanup();
    } catch {
      /* ignore */
    }
    cleanup = null;
  }
  const hash = location.hash || '#/';
  const main = $('#hpMain');
  main.className = 'hp-main';
  main.replaceChildren();

  if (!state.account && hash !== '#/login') return navigate('#/login');
  if (state.account && (hash === '#/login' || hash === '#/' || hash === '#')) {
    return navigate(state.account.role === 'carrier' ? '#/prices' : '#/book');
  }
  markActiveNav(hash);

  try {
    if (hash === '#/login') return renderLogin(main);
    if (hash === '#/book') return await renderBookForm(main);
    if (hash === '#/book/result') return await renderBookResult(main);
    if (hash === '#/book/details') return await renderBookDetails(main);
    if (hash === '#/orders') return renderOrders(main);
    const m = hash.match(/^#\/orders\/([A-Za-z0-9-]+)$/);
    if (m) return await renderOrder(main, m[1]);
    if (hash === '#/exchange') return await renderExchange(main);
    if (hash === '#/prices') {
      if (state.account.role !== 'carrier') return navigate('#/book');
      return await renderPrices(main);
    }
    return navigate('#/book');
  } catch (err) {
    main.replaceChildren(
      h('div', { class: 'hp-empty' }, createIcon('warning', { size: 32 }), h('p', { class: 'hp-empty-title' }, errorText(err))),
    );
  }
}

function boot() {
  const saved = session.get();
  if (saved && ACCOUNTS[saved]) state.account = ACCOUNTS[saved];
  $('#hpLogout').append(createIcon('logout', { size: 20 }));
  $('#hpLogout').addEventListener('click', signOut);
  renderHeader();
  window.addEventListener('hashchange', route);
  route();
}

boot();
