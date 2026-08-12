// Your own avatar, name and availability at the bottom of the channel sidebar.
//
// Slack puts the user button in the rail, where it is an avatar and nothing
// else. Every other chat application of this shape puts a strip at the foot of
// the sidebar with the name and status spelled out, and that is what this adds.
//
// It is a plugin rather than part of a theme because a stylesheet can move a
// picture but cannot fetch a name: the display name comes from `users.info`,
// and the user id comes out of the avatar URL in the rail rather than the
// button's aria-label, which is prefixed differently in every language.
//
// The strip is our own markup and Slack's button is left where it is. Clicking
// the strip presses that button, so the menu that opens is Slack's own with all
// of its behaviour intact, and nothing here has to reimplement it.

const STRIP_ID = 'slackmod-account-strip';

const CSS = `
/* The sidebar becomes a column so the strip can sit under a scrolling list. */
.p-channel_sidebar { display: flex !important; flex-direction: column !important; }
.p-channel_sidebar__list { flex: 1 1 auto !important; min-height: 0 !important; }

/*
 * Slack's "jump to unread" pill is absolutely positioned 8px off the bottom of
 * the sidebar, which is now where the strip is. Lift it clear of it.
 */
.p-channel_sidebar__banner { bottom: 60px !important; }

/*
 * The same avatar twice -- once in the rail, once here -- so the rail's copy
 * goes. Collapsed rather than display:none, which is not cosmetic hair-
 * splitting: with display:none Slack's account menu does not open at all, while
 * collapsed it opens at exactly the same coordinates as when the button is
 * visible. Measured both ways against 4.51.
 *
 * This is CSS in the plugin's own sheet, so switching the plugin off puts the
 * rail back with nothing to undo.
 */
.p-control_strip [data-qa="user-button"] {
  visibility: hidden !important;
  height: 0 !important;
  margin: 0 !important;
  overflow: hidden !important;
}
/*
 * Collapsing the button leaves its wrapper in the strip's 16px flex gap, so the
 * buttons above it stopped short of the bottom by exactly that much. The
 * negative margin eats the gap, and everything sits where it would if the
 * avatar had never been there.
 */
.p-control_strip > *:has([data-qa="user-button"]) { margin-top: -16px !important; }

#${STRIP_ID} {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  height: 52px;
  padding: 0 8px;
  background: var(--dt_color-theme-base-inv-sec, var(--dt_color-base-sec, rgba(0, 0, 0, 0.16)));
}
#${STRIP_ID} .slackmod-me {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1 1 auto;
  min-width: 0;
  padding: 4px 6px;
  border-radius: 4px;
  cursor: pointer;
  text-align: left;
  background: none;
  border: 0;
  font: inherit;
  color: inherit;
}
#${STRIP_ID} .slackmod-me:hover {
  background: var(--dt_color-theme-surf-inv-ter, rgba(255, 255, 255, 0.08));
}
#${STRIP_ID} .slackmod-me__avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  flex: 0 0 auto;
  object-fit: cover;
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.2);
}
#${STRIP_ID} .slackmod-me__text { min-width: 0; line-height: 1.2; }
#${STRIP_ID} .slackmod-me__name,
#${STRIP_ID} .slackmod-me__status {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#${STRIP_ID} .slackmod-me__name {
  font-size: 14px;
  font-weight: var(--custom-font-weight-bold, 700);
  color: var(--dt_color-theme-content-inv-pry, #fff);
}
#${STRIP_ID} .slackmod-me__status {
  font-size: 12px;
  color: var(--dt_color-theme-content-inv-sec, rgba(255, 255, 255, 0.7));
}
`;

/** Slack serves avatars as `<base>-<size>`; the rail renders a 48. */
function avatarAt(url, size) {
  return typeof url === 'string' ? url.replace(/-\d+$/, `-${size}`) : null;
}

const STRINGS = {
  en: { account: 'Your account' },
  fr: { account: 'Votre compte' },
};

export default {
  async start(api) {
    const t = api.i18n.strings(STRINGS);
    api.css(CSS);

    api.dom.keepMounted('.p-channel_sidebar', STRIP_ID, () => {
      const image = document.querySelector('[data-qa="user-button"] img');
      const source = image?.getAttribute('src') ?? null;
      // The avatar URL carries the user id, identically in every language,
      // which the button's aria-label ("User: ...", "Utilisateur : ...") does not.
      const userId = source?.match(/\/T[A-Z0-9]+-(U[A-Z0-9]+)-/i)?.[1]?.toUpperCase() ?? null;

      const avatar = api.dom.h('img', { class: 'slackmod-me__avatar', alt: '' });
      const best = avatarAt(source, 72) ?? source;
      if (best) avatar.setAttribute('src', best);

      const name = api.dom.h('div', { class: 'slackmod-me__name' }, ['…']);
      // Slack's own screen-reader label for the presence indicator, so it is
      // already in the user's language.
      const presence = document
        .querySelector('[data-qa="user-button"] [data-qa="presence_indicator"]')
        ?.getAttribute('aria-label') ?? '';
      const status = api.dom.h('div', { class: 'slackmod-me__status' }, [presence]);

      const me = api.dom.h('button', { class: 'slackmod-me', type: 'button' }, [
        avatar,
        api.dom.h('div', { class: 'slackmod-me__text' }, [name, status]),
      ]);
      me.addEventListener('click', () => {
        document.querySelector('[data-qa="user-button"]')?.click();
      });

      if (userId && api.slack.web.available) {
        api.slack.web
          .userInfo(userId)
          .then((user) => {
            const profile = user.profile ?? {};
            name.textContent =
              profile.display_name || profile.real_name || user.real_name || user.name || '';
            if (profile.status_text) status.textContent = profile.status_text;
          })
          .catch((err) => {
            // Not worth a visible failure: the avatar and availability are most
            // of what the strip is for, and both are already on screen.
            api.log.warn('could not read your profile:', err.message);
            name.textContent = '';
          });
      } else {
        name.textContent = '';
      }

      api.helpers.tooltip(me, t('account'), presence || undefined);
      return api.dom.h('div', {}, [me]);
    });
  },
};
