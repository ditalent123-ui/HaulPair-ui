import { debounce, h } from '../dom.js';
import { t } from './strings.js';

/**
 * Accessible searchable combobox (ARIA 1.2 pattern) with grouped options.
 * getItems(query) resolves to { groups: [{ label, sub?, items: [{ key, label, sub?, demo?, value }] }], hint? }.
 * Items are rendered with textContent only (no HTML from data sources).
 */
let seq = 0;

export function createCombo({ input, getItems, onSelect, onClear = () => {}, minChars = 0, debounceMs = 220 }) {
  if (!input.parentNode) throw new Error('createCombo: the input must already have a parent element.');
  const id = `hpCombo${(seq += 1)}`;
  const list = h('ul', { class: 'hp-combo-list', id: `${id}List`, role: 'listbox', hidden: true });
  input.after(list);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', list.id);
  input.autocomplete = 'off';

  let options = [];
  let active = -1;
  let selected = null;
  let requestNo = 0;

  function close() {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  }

  function setActive(i) {
    options.forEach((o, n) => o.el.setAttribute('aria-selected', String(n === i)));
    active = i;
    if (i >= 0) {
      input.setAttribute('aria-activedescendant', options[i].el.id);
      options[i].el.scrollIntoView({ block: 'nearest' });
    }
  }

  function choose(i) {
    const o = options[i];
    if (!o) return;
    selected = o.item;
    input.value = o.item.label;
    input.removeAttribute('aria-invalid');
    close();
    onSelect(o.item);
  }

  function render({ groups = [], hint, status }) {
    list.replaceChildren();
    options = [];
    if (status) list.append(h('li', { class: 'hp-combo-status', role: 'presentation' }, status));
    for (const g of groups) {
      if (!g.items.length) continue;
      list.append(h('li', { class: 'hp-combo-group', role: 'presentation' }, g.label, g.sub ? h('span', { class: 'hp-combo-region' }, ` · ${g.sub}`) : null));
      for (const item of g.items) {
        const el = h(
          'li',
          { class: 'hp-combo-option', role: 'option', id: `${id}-o${options.length}`, 'aria-selected': 'false' },
          h('span', { class: 'hp-combo-text' }, h('span', { class: 'hp-combo-main' }, item.label), item.sub ? h('span', { class: 'hp-combo-sub' }, item.sub) : null),
          item.demo ? h('span', { class: 'hp-tag-demo', title: 'Duomenys nepatvirtinti / demonstraciniai' }, t('book.demoTag')) : null,
        );
        const index = options.length;
        el.addEventListener('mousedown', (e) => e.preventDefault());
        el.addEventListener('click', () => choose(index));
        options.push({ el, item });
        list.append(el);
      }
    }
    if (!options.length && !status) list.append(h('li', { class: 'hp-combo-status', role: 'presentation' }, t('book.noResults')));
    if (hint) list.append(h('li', { class: 'hp-combo-status', role: 'presentation' }, hint));
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  async function update() {
    const q = input.value.trim();
    if (q.length < minChars) {
      render({ status: t('book.typeMore') });
      return;
    }
    const no = (requestNo += 1);
    try {
      const partial = (res) => no === requestNo && render(res);
      const res = await getItems(q, partial);
      if (no === requestNo) render(res);
    } catch {
      if (no === requestNo) render({ status: t('err.network') });
    }
  }
  const updateDebounced = debounce(update, debounceMs);

  input.addEventListener('input', () => {
    if (selected) {
      selected = null;
      onClear();
    }
    updateDebounced();
  });
  input.addEventListener('focus', () => update());
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (list.hidden) update();
      else setActive(Math.min(options.length - 1, active + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(0, active - 1));
    } else if (e.key === 'Enter' && !list.hidden && active >= 0) {
      e.preventDefault();
      choose(active);
    } else if (e.key === 'Escape') {
      close();
    }
  });

  return {
    get value() {
      return selected;
    },
    set(item) {
      selected = item;
      input.value = item ? item.label : '';
    },
    close,
  };
}
