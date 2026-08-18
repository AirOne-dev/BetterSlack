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

const STRIP_ID = 'betterslack-account-strip';
const STRIP_HEIGHT = 52;
const BANNER_GAP = 8;

/** Slack's own gear, so the control reads as the settings it opens. */
const GEAR_ICON =
  '<svg viewBox="0 0 20 20" aria-hidden="true" style="height:18px;width:18px">' +
  '<path fill="currentColor" d="M8.32 2.5a.75.75 0 0 0-.74.63l-.2 1.2a5.9 5.9 0 0 0-1.1.64l-1.14-.44a.75.75 0 0 0-.92.33l-1.18 2.04a.75.75 0 0 0 .18.95l.95.76a6 6 0 0 0 0 1.28l-.95.76a.75.75 0 0 0-.18.95l1.18 2.04c.18.32.57.45.92.33l1.14-.44q.51.39 1.1.64l.2 1.2c.06.36.37.63.74.63h2.36c.37 0 .68-.27.74-.63l.2-1.2q.59-.25 1.1-.64l1.14.44c.35.12.74-.01.92-.33l1.18-2.04a.75.75 0 0 0-.18-.95l-.95-.76a6 6 0 0 0 0-1.28l.95-.76a.75.75 0 0 0 .18-.95l-1.18-2.04a.75.75 0 0 0-.92-.33l-1.14.44a5.9 5.9 0 0 0-1.1-.64l-.2-1.2a.75.75 0 0 0-.74-.63zM10 12.25a2.25 2.25 0 1 1 0-4.5 2.25 2.25 0 0 1 0 4.5"/></svg>';


const CSS = `
/* The sidebar becomes a column so the strip can sit under a scrolling list. */
.p-channel_sidebar { display: flex !important; flex-direction: column !important; }
.p-channel_sidebar__list { flex: 1 1 auto !important; min-height: 0 !important; }

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
  gap: 4px;
  height: 52px;
  padding: 0 8px;
  /* The same surface as a member list, so the two read as one family rather
     than as two add-ons that happened to land in the same window. */
  background: var(--dt_color-base-sec, rgba(var(--sk_foreground_min_solid, 248, 248, 248), 1));
}
#${STRIP_ID} .betterslack-me {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1 1 auto;
  min-width: 0;
  padding: 4px 6px;
  /* Not a control: it shows who you are, and the gear beside it is what you
     press. A hover state here would promise a click that does nothing. */
  cursor: default;
}
#${STRIP_ID} .betterslack-me__figure { position: relative; flex: 0 0 auto; }
#${STRIP_ID} .betterslack-me__dot {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 3px solid var(--dt_color-base-sec, #f8f8f8);
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.45);
}
/* Availability, in the theme's own colours rather than Discord's literals. */
#${STRIP_ID} .betterslack-me__dot--active { background: var(--dt_color-content-hgl-2, #007a5a); }
#${STRIP_ID} .betterslack-me__dot--dnd { background: var(--dt_color-content-imp, #c01343); }

#${STRIP_ID} .betterslack-me__settings {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 4px;
  border: 0;
  background: none;
  cursor: pointer;
  color: var(--dt_color-theme-content-inv-sec, rgba(255, 255, 255, 0.7));
}
#${STRIP_ID} .betterslack-me__settings:hover {
  background: var(--dt_color-base-pry-hover, rgba(var(--sk_foreground_low, 29, 28, 29), 0.1));
  color: var(--dt_color-theme-content-inv-pry, #fff);
}
#${STRIP_ID} .betterslack-me__avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: block;
  object-fit: cover;
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.2);
}
#${STRIP_ID} .betterslack-me__text { min-width: 0; line-height: 1.2; }
#${STRIP_ID} .betterslack-me__name,
#${STRIP_ID} .betterslack-me__status {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#${STRIP_ID} .betterslack-me__name {
  font-size: 14px;
  font-weight: var(--custom-font-weight-bold, 700);
  color: var(--dt_color-theme-content-inv-pry, #fff);
}
#${STRIP_ID} .betterslack-me__status {
  font-size: 12px;
  color: var(--dt_color-theme-content-inv-sec, rgba(255, 255, 255, 0.7));
}
`;

const STRINGS = {
  en: {
    account: 'Your account',
    settings: 'Account settings',
    available: 'Active',
    away: 'Away',
    dnd: 'Do not disturb',
  },
  fr: {
    account: 'Votre compte',
    settings: 'Réglages du compte',
    available: 'Disponible',
    away: 'Absent',
    dnd: 'Ne pas déranger',
  },
};

/**
 * Move Slack's account menu next to the gear that opened it.
 *
 * Slack anchors that menu to the user button in the rail, which this plugin
 * hides -- so it opened at the bottom-left of the window, nowhere near the
 * control that summoned it. Slack positions it by writing inline `top` and
 * `left` on the ReactModal content wrapper, which is why this can move it and
 * why it stays moved: there is no layout pass waiting to put it back.
 *
 * Everything here fails quietly. A mis-placed menu is a small annoyance; a
 * plugin that throws while Slack is opening one is not.
 */
async function placeMenuBy(anchor) {
  const deadline = Date.now() + 1500;
  let panel = null;
  while (Date.now() < deadline && !panel) {
    await new Promise((resolve) => setTimeout(resolve, 40));
    const menu = document.querySelector('.c-menu');
    panel = menu?.closest('.ReactModal__Content') ?? null;
  }
  if (!panel) return;

  const gear = anchor.getBoundingClientRect();
  const box = panel.getBoundingClientRect();
  const margin = 8;

  // Above the gear, since the strip sits at the foot of the sidebar, and
  // clamped so a tall menu cannot end up off-screen.
  let top = gear.top - box.height - margin;
  if (top < margin) top = Math.min(gear.bottom + margin, window.innerHeight - box.height - margin);
  const left = Math.max(
    margin,
    Math.min(gear.right - box.width, window.innerWidth - box.width - margin),
  );

  panel.style.top = `${Math.round(Math.max(margin, top))}px`;
  panel.style.left = `${Math.round(left)}px`;
}

/**
 * Lift Slack's "jump to unread" pill clear of the strip.
 *
 * There are two of these pills -- one for unread above, one for unread below --
 * and they share every class except a hashed CSS-module name that changes with
 * each Slack build. So they are told apart by where they sit: only the one
 * anchored to the bottom half of the sidebar has the strip in its way, and
 * moving the other would stretch it between a top and a bottom offset.
 *
 * Nothing is measured against the window, so a resize changes nothing here.
 */
function liftBanner(el) {
  const sidebar = el.closest('.p-channel_sidebar');
  if (!sidebar) return;
  const bar = el.getBoundingClientRect();
  const area = sidebar.getBoundingClientRect();
  if (bar.top < area.top + area.height / 2) return; // the one for unread above
  el.style.bottom = `${STRIP_HEIGHT + BANNER_GAP}px`;
}

export default {
  async start(api) {
    const t = api.i18n.strings(STRINGS);

    // Slack mounts and unmounts these as you scroll, so every one that appears
    // gets the same treatment.
    api.dom.onEach('.p-channel_sidebar__banner', liftBanner);

    // And again on resize: which half of the sidebar a pill sits in is a
    // measurement, and a shorter window can move it across the middle.
    const onResize = () => {
      for (const el of document.querySelectorAll('.p-channel_sidebar__banner')) liftBanner(el);
    };
    window.addEventListener('resize', onResize);
    api.onDispose(() => window.removeEventListener('resize', onResize));
    api.css(CSS);

    api.dom.keepMounted('.p-channel_sidebar', STRIP_ID, () => {
      const image = document.querySelector('[data-qa="user-button"] img');
      const source = image?.getAttribute('src') ?? null;
      // The avatar URL carries the user id, identically in every language,
      // which the button's aria-label ("User: ...", "Utilisateur : ...") does not.
      const userId = source?.match(/\/T[A-Z0-9]+-(U[A-Z0-9]+)-/i)?.[1]?.toUpperCase() ?? null;

      const avatar = api.dom.h('img', { class: 'betterslack-me__avatar', alt: '' });
      // The rail renders a 48; this one has room for a 72.
      const best = api.slack.avatarUrl(source, 72) ?? source;
      if (best) avatar.setAttribute('src', best);

      const name = api.dom.h('div', { class: 'betterslack-me__name' }, ['…']);
      // Filled in by paintDot, which is the only thing that writes this line.
      // It used to be read once here, from Slack's screen-reader label, and
      // then never again -- so it kept saying whatever was true at the moment
      // the strip happened to be built, which is the whole bug.
      const status = api.dom.h('div', { class: 'betterslack-me__status' }, ['']);

      const dot = api.dom.h('span', { class: 'betterslack-me__dot' });
      const me = api.dom.h('div', { class: 'betterslack-me' }, [
        api.dom.h('span', { class: 'betterslack-me__figure' }, [avatar, dot]),
        api.dom.h('div', { class: 'betterslack-me__text' }, [name, status]),
      ]);

      // The gear is the control. Pressing it opens Slack's own account menu,
      // which is what clicking the whole strip used to do.
      const settings = api.dom.h('button', {
        class: 'betterslack-me__settings',
        type: 'button',
        'aria-label': t('settings'),
      });
      settings.innerHTML = GEAR_ICON;
      settings.addEventListener('click', () => {
        document.querySelector('[data-qa="user-button"]')?.click();
        void placeMenuBy(settings);
      });
      api.helpers.tooltip(settings, t('settings'));

      /*
       * Availability, copied from the indicator Slack already draws on your own
       * avatar in the rail -- `.c-presence--active` on
       * `[data-qa="user-button"] .c-presence`.
       *
       * It used to ask users.getPresence once a minute, and that is why the dot
       * so often said away while the app plainly said available: the API answer
       * lags the client, most of all just after the window comes back to the
       * front, and until the next tick a whole minute later the strip kept
       * showing the stale one. Slack's own node is instant, always agrees with
       * the app it sits in, and costs no request at all.
       *
       * Do-not-disturb is not in that class, so it still comes from the API --
       * but a DND window changes rarely, so it is asked for slowly.
       */
      let dnd = false;
      /** A status someone set for themselves, which outranks the presence word. */
      let customStatus = '';
      /** True once either source has actually answered about availability. */
      let resolved = false;
      // waitFor resolves whenever Slack gets round to drawing the rail, which
      // can be after this plugin has been switched off. Touching the document
      // then is how a disabled plugin ends up throwing into a page it no longer
      // belongs to.
      let gone = false;
      api.onDispose(() => { gone = true; });

      /**
       * The dot and the word beside it, from the same reading.
       *
       * They are one thing: a green dot next to "Absent" is worse than
       * either being wrong on its own, and that is what happened while the text
       * was written once at mount and the dot was polled.
       */
      const paintDot = () => {
        if (gone) return;
        const mine = document.querySelector('[data-qa="user-button"] .c-presence');
        const active = mine ? mine.classList.contains('c-presence--active') : null;

        dot.classList.toggle('betterslack-me__dot--dnd', dnd);
        // Null means Slack has not drawn it yet -- leave both as they are rather
        // than claiming away, which is the wrong answer more often than not.
        if (active !== null) dot.classList.toggle('betterslack-me__dot--active', active && !dnd);

        if (active !== null) resolved = true;

        // A status someone wrote is what they want shown; the presence word is
        // what Slack falls back to, so this does too. Nothing is written before
        // something has answered: an empty line for a moment is honest, "away"
        // is a guess, and guessing wrong is the bug this whole thing is about.
        const word = dnd
          ? t('dnd')
          : dot.classList.contains('betterslack-me__dot--active') ? t('available') : t('away');
        const next = customStatus || (resolved ? word : '');
        if (status.textContent !== next) status.textContent = next;
      };

      // Watch the rail rather than poll it: Slack swaps the class the moment
      // your availability changes, and the strip should change with it.
      const railWatcher = new MutationObserver(paintDot);
      void api.dom.waitFor('[data-qa="user-button"]').then((button) => {
        if (!button || gone) return;
        railWatcher.observe(button, {
          attributes: true,
          attributeFilter: ['class'],
          subtree: true,
          childList: true,
        });
        paintDot();
      });
      api.onDispose(() => railWatcher.disconnect());
      paintDot();

      api.helpers.poll(async () => {
        if (gone || !userId || !api.slack.web.available) return;
        const availability = await api.slack.web.availability(userId);
        if (gone) return;
        dnd = availability.state === 'dnd';
        // Only when Slack draws no indicator of its own: an older layout, or
        // the rail not built yet. Otherwise the app's own answer wins.
        if (!document.querySelector('[data-qa="user-button"] .c-presence')) {
          dot.classList.toggle('betterslack-me__dot--active', availability.state === 'active');
          if (availability.state !== 'unknown') resolved = true;
        }
        paintDot();
      }, 300_000);

      if (userId && api.slack.web.available) {
        api.slack.web
          .users([userId])
          .then((users) => {
            const user = users.get(userId);
            const profile = user?.profile ?? {};
            name.textContent =
              profile.display_name || profile.real_name || user?.real_name || user?.name || '';
            // Slack shows the emoji beside it; the shortcode would read as
            // ":coffee:", so only the text is taken.
            customStatus = profile.status_text ?? '';
            paintDot();
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

      return api.dom.h('div', {}, [me, settings]);
    });
  },
};
