// Signing in, in the view itself.
//
// A form for a GitLab address and a personal access token. The token is taken
// out of its field the moment the form is sent -- before the request leaves --
// so it is in the DOM only while it is being typed, and from there it is an
// argument to `store.signIn` and nowhere else: not logged, not in an address,
// not in a setting, not in an error. What is shown on failure is a sentence
// chosen by a reason, never anything the server said.
//
// The form is built once and kept: it is the one part of the view with
// something a person has typed in it, so it is never rebuilt around them.

import { setText, show } from './dom.js';

export function createLogin({ api, t, store }) {
  const { h } = api.dom;

  const input = (attrs) => h('input', { class: 'c-input_text betterslack-gitlab-login__input', ...attrs });
  const field = (label, control, hint) => h('label', { class: 'betterslack-gitlab-login__field' }, [
    h('span', { class: 'betterslack-gitlab-login__label' }, [label]),
    control,
    ...(hint ? [h('span', { class: 'betterslack-gitlab-login__hint' }, [hint])] : []),
  ]);

  const address = input({ type: 'url', name: 'address', spellcheck: 'false', autocomplete: 'url', placeholder: 'https://gitlab.example.com' });
  const token = input({ type: 'password', name: 'token', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off' });
  const expired = h('p', { class: 'betterslack-gitlab-login__notice', role: 'status' }, [t('sessionInvalid')]);
  const error = h('p', { class: 'betterslack-gitlab-login__error', role: 'alert' });
  const submit = h('button', { type: 'submit', class: 'c-button c-button--primary c-button--medium' }, [t('submit')]);

  const form = h('form', { class: 'betterslack-gitlab-login', novalidate: '' }, [
    h('h2', { class: 'betterslack-gitlab-login__title' }, [t('loginTitle')]),
    h('p', { class: 'betterslack-gitlab-login__intro' }, [t('loginIntro')]),
    expired,
    field(t('fieldServer'), address),
    field(t('fieldToken'), token, t('tokenHint')),
    error,
    h('div', { class: 'betterslack-gitlab-login__actions' }, [submit]),
    h('p', { class: 'betterslack-gitlab-login__privacy' }, [t('privacy')]),
  ]);

  let sending = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (sending) return;
    const secret = token.value;
    token.value = '';
    sending = true;
    submit.setAttribute('disabled', '');
    setText(submit, t('submitting'));
    setText(error, '');
    let outcome;
    try {
      outcome = await store.signIn(address.value, secret);
    } catch {
      outcome = { ok: false, reason: 'unreachable' };
    }
    sending = false;
    submit.removeAttribute('disabled');
    setText(submit, t('submit'));
    if (outcome.ok) return;
    setText(error, t(`error_${outcome.reason}`));
    (outcome.reason === 'address' ? address : token).focus();
  });

  return {
    element: form,
    /** Brings what the form says up to date, leaving whatever is being typed alone. */
    update(state) {
      show(expired, state.invalid);
      // The address in the settings, until somebody has typed another.
      if (!address.value && !address.matches(':focus')) address.value = state.server ?? api.settings.get('gitUrl', '') ?? '';
    },
    focus() {
      (address.value ? token : address).focus();
    },
  };
}
