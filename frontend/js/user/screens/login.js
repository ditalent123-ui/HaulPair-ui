import { h } from '../../dom.js';
import { createIcon } from '../../icons.js';
import { signIn } from '../main.js';
import { t } from '../strings.js';

/**
 * Fake demo login. Any username/password is accepted. On submit the fields are
 * cleared, nothing is stored or sent anywhere, and the role selector decides
 * which demo account is signed in.
 */
export function renderLogin(main) {
  const user = h('input', { class: 'hp-input', id: 'loginUser', name: 'username', autocomplete: 'off', placeholder: 'pvz. jonas' });
  const pass = h('input', { class: 'hp-input', id: 'loginPass', name: 'password', type: 'password', autocomplete: 'off', placeholder: '••••••' });
  const roleSender = h('input', { type: 'radio', name: 'role', value: 'piemuo', checked: true });
  const roleCarrier = h('input', { type: 'radio', name: 'role', value: 'linas' });

  const form = h(
    'form',
    { class: 'hp-card', id: 'loginForm', novalidate: true },
    h('div', { class: 'hp-field' }, h('label', { class: 'hp-label', for: 'loginUser' }, t('login.username')), user),
    h('div', { class: 'hp-field' }, h('label', { class: 'hp-label', for: 'loginPass' }, t('login.password')), pass),
    h(
      'fieldset',
      { class: 'hp-field', style: null },
      h('legend', { class: 'hp-label' }, t('login.role')),
      h(
        'div',
        { class: 'hp-choices' },
        h('label', { class: 'hp-choice' }, roleSender, h('span', { class: 'hp-choice-title' }, t('role.sender')), h('span', { class: 'hp-choice-sub' }, t('login.senderSub'))),
        h('label', { class: 'hp-choice' }, roleCarrier, h('span', { class: 'hp-choice-title' }, t('role.carrier')), h('span', { class: 'hp-choice-sub' }, t('login.carrierSub'))),
      ),
    ),
    h('button', { type: 'submit', class: 'button button--primary hp-btn' }, t('login.submit')),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const accountId = roleCarrier.checked ? 'linas' : 'piemuo';
    // Demo: discard whatever was typed. Nothing is stored or transmitted.
    user.value = '';
    pass.value = '';
    form.reset();
    signIn(accountId);
  });

  main.append(
    h('p', { class: 'hp-eyebrow' }, 'HaulPair'),
    h('h1', { class: 'hp-title' }, t('login.title')),
    h('p', { class: 'hp-lead' }, t('login.lead')),
    h('div', { class: 'hp-notice hp-notice--demo', role: 'note' }, createIcon('info', { size: 18 }), h('span', {}, t('login.demo'))),
    h('div', { class: 'hp-section-gap' }),
    form,
  );
  user.focus();
}
