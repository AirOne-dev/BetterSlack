// Signing in.
//
// A real form in Slack's own dialog (`api.ui.modal` wears `c-dialog`) with
// Slack's own fields, so it looks like the rest of the client on every theme.
//
// The password is taken out of its field the moment the form is sent -- before
// the request leaves -- so it is in the DOM only while it is being typed. It
// reaches `session.signIn` as an argument and nowhere else. The submit button
// is held while the request travels: a second press would be a second sign-in
// to Kelio, and five refused ones lock out the whole office's network.

import { hostOf } from '../quelio.js';

export function openLogin({ api, t, format, session, onSignedIn }) {
  const { h } = api.dom;
  const needsAddress = !session.state.address;

  const input = (attrs) => h('input', { class: 'c-input_text betterslack-quelio-login__input', ...attrs });
  const field = (label, control, hint) => h('label', { class: 'betterslack-quelio-login__field' }, [
    h('span', { class: 'betterslack-quelio-login__label' }, [label]),
    control,
    ...(hint ? [h('span', { class: 'betterslack-quelio-login__hint' }, [hint])] : []),
  ]);

  const address = needsAddress
    ? input({ type: 'url', name: 'address', placeholder: 'https://example.com/quelio-api/', spellcheck: 'false', autocomplete: 'url' })
    : null;
  const user = input({ type: 'text', name: 'username', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'username' });
  user.value = session.state.lastUser ?? '';
  const password = input({ type: 'password', name: 'password', autocomplete: 'off' });
  const error = h('p', { class: 'betterslack-quelio-login__error', role: 'alert' });
  const submit = h('button', { type: 'submit', class: 'c-button c-button--primary c-button--medium' }, [t('submit')]);

  const host = hostOf(session.state.address);
  const form = h('form', { class: 'betterslack-quelio-login', novalidate: '' }, [
    ...(address
      ? [field(t('fieldAddress'), address, t('fieldAddressHint'))]
      : [h('p', { class: 'betterslack-quelio-login__server' }, [t('server', { host })])]),
    field(t('fieldUser'), user),
    field(t('fieldPassword'), password),
    error,
    h('div', { class: 'betterslack-quelio-login__actions' }, [submit]),
    h('p', { class: 'betterslack-quelio-login__privacy' }, [
      address ? t('privacyNoHost') : t('privacy', { host }),
    ]),
  ]);

  const modal = api.ui.modal({ title: t('loginTitle'), subtitle: t('loginSubtitle'), content: form, width: 420 });

  const explain = (outcome) => {
    if (outcome.reason === 'rateLimited') {
      return t('error_rateLimited', { left: format.duration(Math.ceil((outcome.retryAfter ?? 300) / 60)) });
    }
    const text = t(`error_${outcome.reason}`);
    return outcome.reason === 'credentials' && Number.isInteger(outcome.attemptsLeft)
      ? `${text} ${t('error_attemptsLeft', { count: outcome.attemptsLeft })}`
      : text;
  };

  let sending = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (sending) return;
    const secret = password.value;
    password.value = '';
    sending = true;
    submit.setAttribute('disabled', '');
    submit.textContent = t('submitting');
    error.textContent = '';
    let outcome;
    try {
      outcome = await session.signIn(user.value, secret, address?.value);
    } catch {
      outcome = { ok: false, reason: 'unreachable' };
    }
    sending = false;
    if (outcome.ok) {
      modal.close();
      onSignedIn();
      return;
    }
    submit.removeAttribute('disabled');
    submit.textContent = t('submit');
    error.textContent = explain(outcome);
    (outcome.reason === 'address' && address ? address : password).focus();
  });

  // After the dialog has focused its own first button.
  setTimeout(() => {
    const first = address && !address.value ? address : user.value ? password : user;
    first.focus();
  }, 0);
  return modal;
}
