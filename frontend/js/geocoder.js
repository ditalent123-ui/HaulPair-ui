import { api } from './api.js';
import { debounce, h } from './dom.js';
import { t } from './i18n.js';

const MIN_CHARS = 3;
const DEBOUNCE_MS = 350;

/**
 * Accessible location combobox (WAI-ARIA combobox + listbox pattern).
 * Suggestions are fetched from the backend geocoding proxy. When the configured
 * provider does not permit search-as-you-type, searching happens on Enter only.
 *
 * The selected place is exposed as { lat, lon, label } via getValue().
 */
export function createLocationInput({ input, listbox, autocomplete = true, onChange }) {
  let value = null;
  let options = [];
  let activeIndex = -1;
  let controller = null;

  function setExpanded(expanded) {
    listbox.hidden = !expanded;
    input.setAttribute('aria-expanded', String(expanded));
    if (!expanded) input.removeAttribute('aria-activedescendant');
  }

  function renderStatus(text) {
    listbox.replaceChildren(h('li', { class: 'combo-status', role: 'presentation' }, text));
    setExpanded(true);
  }

  function renderOptions(results) {
    options = results;
    activeIndex = -1;
    if (results.length === 0) return renderStatus(t('geo.noResults'));
    listbox.replaceChildren(
      ...results.map((r, i) => {
        const [main, ...rest] = r.label.split(', ');
        return h(
          'li',
          {
            id: `${listbox.id}-opt-${i}`,
            class: 'combo-option',
            role: 'option',
            'aria-selected': 'false',
            onmousedown: (e) => e.preventDefault(), // keep focus in the input
            onclick: () => choose(i),
          },
          h('span', { class: 'combo-option-main' }, main),
          rest.length ? h('span', { class: 'combo-option-sub' }, rest.join(', ')) : null,
        );
      }),
    );
    setExpanded(true);
  }

  function highlight(index) {
    const items = [...listbox.querySelectorAll('[role="option"]')];
    if (items.length === 0) return;
    activeIndex = (index + items.length) % items.length;
    items.forEach((el, i) => el.setAttribute('aria-selected', String(i === activeIndex)));
    input.setAttribute('aria-activedescendant', items[activeIndex].id);
    items[activeIndex].scrollIntoView({ block: 'nearest' });
  }

  function choose(index) {
    const r = options[index];
    if (!r) return;
    setValue({ lat: r.lat, lon: r.lon, label: r.label });
    setExpanded(false);
  }

  async function search(query) {
    controller?.abort();
    controller = new AbortController();
    renderStatus(t('geo.searching'));
    try {
      const results = await api.geocode(query, { signal: controller.signal });
      if (input.value.trim() === query) renderOptions(results);
    } catch (err) {
      if (err.name === 'AbortError') return;
      renderStatus(t('geo.error', { message: err.message }));
    }
  }

  const debouncedSearch = debounce((q) => search(q), DEBOUNCE_MS);

  input.addEventListener('input', () => {
    if (value) {
      value = null;
      onChange?.(null);
    }
    const q = input.value.trim();
    if (q.length < MIN_CHARS) {
      controller?.abort();
      setExpanded(false);
      return;
    }
    if (autocomplete) debouncedSearch(q);
    else renderStatus(t('geo.pressEnter'));
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (listbox.hidden && input.value.trim().length >= MIN_CHARS) search(input.value.trim());
      else highlight(activeIndex + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlight(activeIndex - 1);
    } else if (e.key === 'Enter') {
      if (!listbox.hidden && activeIndex >= 0) {
        e.preventDefault();
        choose(activeIndex);
      } else if (!value && input.value.trim().length >= 2) {
        e.preventDefault();
        search(input.value.trim());
      }
    } else if (e.key === 'Escape') {
      setExpanded(false);
    }
  });

  input.addEventListener('blur', () => setTimeout(() => setExpanded(false), 120));

  function setValue(next, { silent = false } = {}) {
    value = next;
    input.value = next ? next.label : '';
    input.removeAttribute('aria-invalid');
    if (!silent) onChange?.(next);
  }

  /** Geocode a query and take the first result (used by quick-fill chips). */
  async function resolveFirst(query) {
    const results = await api.geocode(query);
    if (results.length === 0) throw new Error(t('geo.noResults'));
    setValue({ lat: results[0].lat, lon: results[0].lon, label: results[0].label });
  }

  return { getValue: () => value, setValue, resolveFirst, input };
}
