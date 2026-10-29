/**
 * Browser storage for the DEMO only: the signed-in demo account id (never the
 * typed username/password) and demo orders. Every access is guarded, so the
 * app still works when storage is blocked.
 */
const SESSION_KEY = 'haulpair.demoAccount.v1';
const ORDERS_KEY = 'haulpair.demoOrders.v1';

function read(store, key, fallback) {
  try {
    const raw = store.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function write(store, key, value) {
  try {
    if (value === null) store.removeItem(key);
    else store.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: keep working in memory */
  }
}

let memoryAccount = null;
let memoryOrders = null;

export const session = {
  get() {
    return memoryAccount ?? read(sessionStorage, SESSION_KEY, null);
  },
  set(accountId) {
    memoryAccount = accountId;
    write(sessionStorage, SESSION_KEY, accountId);
  },
  clear() {
    memoryAccount = null;
    write(sessionStorage, SESSION_KEY, null);
  },
};

export const orders = {
  all() {
    memoryOrders ??= read(localStorage, ORDERS_KEY, []);
    return memoryOrders;
  },
  get(id) {
    return this.all().find((o) => o.id === id) ?? null;
  },
  save(order) {
    const list = this.all().filter((o) => o.id !== order.id);
    list.unshift(order);
    memoryOrders = list.slice(0, 50);
    write(localStorage, ORDERS_KEY, memoryOrders);
  },
  remove(id) {
    memoryOrders = this.all().filter((o) => o.id !== id);
    write(localStorage, ORDERS_KEY, memoryOrders);
  },
};
