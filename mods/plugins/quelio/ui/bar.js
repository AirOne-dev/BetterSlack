// The bar in Slack's top bar.
//
// A thin meter for the week, a thinner one under it for today -- or, at lunch,
// for the hour lunch has to last -- the week's total, and one sentence about
// right now. That is all it ever shows; everything else is a click away.
//
// Every piece of text is always rendered, and `data-fit` says which are on
// screen. It starts from the reader's choice in the settings and steps down --
// the sentence goes first, then the total, the meter last -- while the bar
// does not fit the room Slack's top bar leaves it. Measured rather than
// guessed from the window's width: that room depends on Slack's own layout,
// and a guess made a bar that showed nothing but a clipped meter.

export const BAR_ID = 'betterslack-quelio';

/**
 * Where the bar lives: in the top bar's right-hand side, after Slack's own
 * first item there and before its buttons -- the free space beside the
 * search. Measured on Slack 4.51 at 2560px: that side is a flex row holding
 * `.p-ia4_top_nav__right_container--start` and then the button group, and
 * spans everything from the search's edge to the window's.
 *
 * Anchored on the button group rather than prepended: first in the row, the
 * bar's auto margin pushed Slack's own first item over to the buttons.
 *
 * And never in a row holding a coachmark wrapper: inserting next to one
 * freezes the renderer solid. The bar stays out, which is a bug report, rather
 * than going in, which is a frozen Slack.
 */
export const SLOT = '.p-ia4_top_nav__right_container:not(:has(> .c-coachmark-anchor))';
export const BEFORE = '.p-ia4_top_nav__right_container > .display_flex.align_items_center';

/** From the most to the least, for each choice in the settings. */
const FITS = {
  full: ['full', 'total', 'percent', 'meter'],
  week: ['week', 'total', 'percent', 'meter'],
  compact: ['percent', 'meter'],
};

export function createBar({ api, t, format, onOpen }) {
  const { h } = api.dom;
  const weekFill = h('span', { class: 'betterslack-quelio__fill' });
  const dayFill = h('span', { class: 'betterslack-quelio__fill' });
  const meter = h('span', { class: 'betterslack-quelio__meter', 'aria-hidden': 'true' }, [
    h('span', { class: 'betterslack-quelio__track betterslack-quelio__track--week' }, [weekFill]),
    h('span', { class: 'betterslack-quelio__track betterslack-quelio__track--day' }, [dayFill]),
  ]);
  const total = h('span', { class: 'betterslack-quelio__total' });
  const remaining = h('span', { class: 'betterslack-quelio__remaining' });
  const percent = h('span', { class: 'betterslack-quelio__percent' });
  const note = h('span', { class: 'betterslack-quelio__note' });
  const offline = h('span', { class: 'betterslack-quelio__offline', 'aria-hidden': 'true' });

  const fits = FITS[api.settings.get('display', 'full')] ?? FITS.full;
  const button = h('button', {
    id: BAR_ID,
    type: 'button',
    class: 'c-button-unstyled betterslack-quelio',
    'aria-haspopup': 'dialog',
    'aria-expanded': 'false',
    'data-fit': fits[0],
  }, [meter, total, remaining, percent, note, offline]);
  button.addEventListener('click', () => onOpen(button));

  /**
   * The most that fits. Nothing to measure while the bar is not on screen, or
   * under a test's DOM, which lays nothing out: it then keeps the most, which
   * is what the reader asked for.
   */
  const overflows = (node) => node.scrollWidth > node.clientWidth + 1;
  /*
   * Tried from the most down, and left on the first that fits, or on the
   * meter. The answer depends only on the room and the text, so watching the
   * bar's size settles after one more look rather than chasing itself.
   */
  const fit = () => {
    if (!button.isConnected) return;
    for (const level of fits) {
      button.dataset.fit = level;
      // A sentence cut short loses its end, which is where the time is: it
      // either fits whole or goes, and the details have it.
      const cut = (level === 'full' && overflows(note)) || (level === 'week' && overflows(remaining));
      if (!cut && !overflows(button)) return;
    }
  };
  // Again whenever the room changes -- the window, or Slack laying its own
  // top bar out again around it -- not only when the text does.
  window.addEventListener('resize', fit);
  const watcher = typeof ResizeObserver === 'function' ? new ResizeObserver(() => fit()) : null;
  watcher?.observe(button);
  api.onDispose(() => {
    window.removeEventListener('resize', fit);
    watcher?.disconnect();
  });

  const setText = (node, text) => {
    if (node.textContent !== text) node.textContent = text;
  };
  const fill = (node, fraction) => {
    node.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 1000) / 10}%`;
  };

  return {
    element: button,

    update(view) {
      button.dataset.phase = view.phase;
      if (view.phase !== 'ready') {
        const word = {
          signedOut: t('barSignIn'),
          expired: t('barSignInAgain'),
          loading: t('barLoading'),
          unavailable: t('barUnavailable'),
        }[view.phase];
        button.dataset.tone = view.phase === 'expired' || view.phase === 'unavailable' ? 'warning' : 'muted';
        button.dataset.dayTone = 'muted';
        setText(total, word);
        for (const node of [remaining, percent, note, offline]) setText(node, '');
        fill(weekFill, 0);
        fill(dayFill, 0);
        button.setAttribute('aria-label', word);
        fit();
        return;
      }

      const { week, status } = view;
      const done = format.duration(week.done);
      const target = format.duration(week.target);
      const sentence = format.sentence(status);
      button.dataset.tone = view.tone;
      button.dataset.dayTone = status.tone;
      setText(total, t('weekTotal', { done, target }));
      setText(remaining, t('weekRemaining', { remaining: format.duration(week.remaining) }));
      setText(percent, format.percent(week.progress));
      setText(note, sentence);
      setText(offline, view.offline ? t('barOffline') : '');
      fill(weekFill, week.progress);
      fill(dayFill, status.progress ?? week.today?.progress ?? 0);
      button.setAttribute('aria-label', [
        t('barLabel', { done, target, status: sentence }),
        view.offline ? t('barOffline') : '',
      ].filter(Boolean).join(' · '));
      fit();
    },

    setExpanded(open) {
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
    },
  };
}
