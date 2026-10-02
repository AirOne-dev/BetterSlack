// The details, under the bar.
//
// Light DOM, painted with the tokens Slack's own menus are painted with --
// `--sk_primary_background` and friends, which every theme overrides -- so it
// follows the theme without a colour of its own. Not `api.ui.kit`: the kit is
// for a window a mod opens, where there is no stylesheet at all, and inside
// the client its fixed palette comes out wrong on half the themes.
//
// It is rebuilt whole on every repaint, which is cheap at this size and keeps
// one way of drawing it; the control that had focus is found again by its
// `data-action` and given focus back, so a repaint never drops a keyboard
// user.

import { hostOf } from '../quelio.js';

export const LAYER_ID = 'betterslack-quelio-details';

const REFRESH_ICON =
  '<svg viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M10 3.5a6.5 6.5 0 0 0-6.36 ' +
  '5.15.75.75 0 1 1-1.47-.3A8 8 0 0 1 16 5.07V3.75a.75.75 0 0 1 1.5 0v3.5c0 .41-.34.75-.75.75h-3.5a.75.75 ' +
  '0 0 1 0-1.5h1.78A6.5 6.5 0 0 0 10 3.5m7.24 7.3a.75.75 0 0 1 .59.88A8 8 0 0 1 4 14.93v1.32a.75.75 0 0 ' +
  '1-1.5 0v-3.5c0-.41.34-.75.75-.75h3.5a.75.75 0 0 1 0 1.5H4.97a6.5 6.5 0 0 0 11.39-3.11.75.75 0 0 1 ' +
  '.88-.59"/></svg>';

export function createDetails({ api, t, format, session, onSignOut, onSettings, onToggle }) {
  const { h } = api.dom;
  let layer = null;
  let panel = null;
  let anchor = null;
  let arming;
  let last = null;

  const button = (label, action, onClick, className = 'c-button c-button--outline c-button--small') => {
    const node = h('button', { type: 'button', class: className, 'data-action': action }, [label]);
    node.addEventListener('click', onClick);
    return node;
  };
  const row = (label, value, className = '') =>
    h('div', { class: `betterslack-quelio-details__row ${className}`.trim() }, [
      h('span', { class: 'betterslack-quelio-details__key' }, [label]),
      h('span', { class: 'betterslack-quelio-details__value' }, [value]),
    ]);
  const section = (title, children) =>
    h('section', { class: 'betterslack-quelio-details__section' }, [
      h('h2', { class: 'betterslack-quelio-details__heading' }, [title]),
      ...children,
    ]);
  const notice = (text, tone) =>
    h('p', { class: 'betterslack-quelio-details__notice', 'data-tone': tone }, [text]);
  const meter = (fraction, tone) => {
    const fill = h('span', { class: 'betterslack-quelio__fill' });
    fill.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 1000) / 10}%`;
    return h('span', { class: 'betterslack-quelio-details__meter', 'data-tone': tone, 'aria-hidden': 'true' }, [fill]);
  };

  const clockOf = (ms) => {
    const date = new Date(ms);
    return format.clock(date.getHours() * 60 + date.getMinutes());
  };

  /** "Updated at 09:42", or why there is nothing newer. */
  const freshness = (view) => {
    if (view.busy) return t('updating');
    if (!view.fetchedAt) return '';
    const time = clockOf(view.fetchedAt);
    if (view.offline) return t('offlineSince', { time });
    const read = new Date(view.fetchedAt);
    return read.toDateString() === new Date().toDateString()
      ? t('updatedAt', { time })
      : t('updatedOn', { day: format.day(read), time });
  };

  /** Why the last attempt failed, and when the next one is. */
  const failureText = (failure) => {
    if (!failure) return '';
    const text = failure.reason === 'rateLimited'
      ? t('error_rateLimited', { left: format.duration(Math.ceil(Math.max(0, failure.retryAt - Date.now()) / 60_000)) })
      : t(`error_${failure.reason}`);
    return Number.isFinite(failure.retryAt) && failure.reason !== 'rateLimited'
      ? `${text} ${t('retryAt', { time: clockOf(failure.retryAt) })}`
      : text;
  };

  const header = (view) => {
    const wait = session.manualWait();
    const refresh = h('button', {
      type: 'button',
      class: 'c-button-unstyled c-icon_button c-icon_button--size_small c-icon_button--default betterslack-quelio-details__refresh',
      'data-action': 'refresh',
      'aria-label': wait > 0 && Number.isFinite(wait)
        ? t('refreshIn', { left: format.duration(Math.ceil(wait / 60_000)) })
        : t('refresh'),
    });
    refresh.innerHTML = REFRESH_ICON;
    if (view.busy || wait > 0) refresh.setAttribute('disabled', '');
    refresh.addEventListener('click', () => { void session.refreshNow(); });
    return h('header', { class: 'betterslack-quelio-details__head' }, [
      h('div', { class: 'betterslack-quelio-details__titles' }, [
        h('h1', { class: 'betterslack-quelio-details__title' }, [t('title')]),
        h('p', { class: 'betterslack-quelio-details__sub' }, [
          [view.username, hostOf(view.address), freshness(view)].filter(Boolean).join(' · '),
        ]),
      ]),
      refresh,
    ]);
  };

  const weekSection = (view) => {
    const { week } = view;
    let objective = format.duration(week.target);
    const off = week.daysOff + (week.afternoonsOff ?? 0) / 2;
    if (off === 0.5) objective = t('objectiveHalfOff', { target: objective });
    else if (off === 1) objective = t('objectiveOneOff', { target: objective });
    else if (off > 1) objective = t('objectiveManyOff', { target: objective, count: format.number(off) });
    else if (!view.objectiveReported) objective = t('objectiveAssumed', { target: objective });
    const children = [
      meter(week.progress, view.tone),
      row(t('rowDone'), format.duration(week.done)),
      row(t('rowObjective'), objective),
      row(t('rowRemaining'), format.duration(week.remaining)),
      row(t('rowProgress'), format.percent(week.progress)),
    ];
    if (week.status === 'insufficientCapacity') {
      children.push(notice(t('insufficientDetail', { shortfall: format.duration(week.shortfall) }), 'danger'));
    } else if (week.status === 'reached' && week.today && !week.today.closed) {
      children.push(view.day.half
        ? notice(t('reachedDetailNow'), 'success')
        : notice(t('reachedDetail', { from: format.clock(view.day.leaveFrom) }), 'success'));
    }
    return section(t('sectionWeek'), children);
  };

  const todaySection = (view) => {
    const plan = view.week.today;
    const status = h('p', { class: 'betterslack-quelio-details__status', 'data-tone': view.status.tone }, [
      format.sentence(view.status),
    ]);
    if (plan.off) return section(t('sectionToday'), [status]);
    const { lunch, badges, day } = view;
    let lunchText = t('none');
    if (!day.takesLunch) lunchText = t('lunchAfternoonOff');
    else if (lunch?.open) lunchText = t('lunchOngoing', { from: format.clock(lunch.from), duration: format.duration(lunch.duration) });
    else if (lunch) lunchText = t('lunchSpan', { from: format.clock(lunch.from), to: format.clock(lunch.to), duration: format.duration(lunch.duration) });
    else if (badges.length && badges[0] < day.lunchStartBy) lunchText = t('lunchNotYet');
    const rows = [
      row(t('rowArrival'), badges.length ? format.clock(badges[0]) : t('none')),
      row(t('rowWorked'), format.duration(plan.paid)),
      row(t('rowLunch'), lunchText),
    ];
    if (!plan.closed) {
      rows.push(
        row(t('rowLeft'), format.duration(plan.toDo)),
        row(t('rowDeparture'), format.clock(plan.departure), 'betterslack-quelio-details__row--strong'),
        row(t('rowWindow'), day.half
          ? t('until', { to: format.clock(plan.leaveBy) })
          : t('range', { from: format.clock(day.leaveFrom), to: format.clock(plan.leaveBy) })),
      );
    }
    rows.push(row(t('rowDay'), format.percent(plan.progress)));
    return section(t('sectionToday'), [status, ...rows]);
  };

  const daysSection = (view) => {
    const list = h('ul', { class: 'betterslack-quelio-details__days' });
    view.days.forEach((day, index) => {
      const isToday = index === view.weekday;
      const summary = view.week.days[index];
      let value = t('none');
      if (summary.off) value = t('dayOff');
      else if (isToday && day.badges.length % 2 === 1) value = t('dayOngoing', { paid: format.duration(summary.paid) });
      else if (!summary.future && (day.badges.length || summary.paid)) value = format.duration(summary.paid);
      if (summary.half) value = t('dayHalf', { value });
      const item = h('li', { class: `betterslack-quelio-details__day${isToday ? ' is-today' : ''}` }, [
        h('span', { class: 'betterslack-quelio-details__key' }, [format.day(day.date)]),
        h('span', { class: 'betterslack-quelio-details__value' }, [value]),
      ]);
      const link = (label, action, onClick, hint) => {
        const toggle = button(label, action, onClick, 'c-button-unstyled betterslack-quelio-details__link');
        toggle.setAttribute('title', hint);
        item.append(toggle);
      };
      // Only a day nobody worked can be called a day off; any day can lose its afternoon.
      if (!day.badges.length && !(day.paid > 0) && !summary.half) {
        link(summary.off ? t('unmarkOff') : t('markOff'), `off-${index}`,
          () => session.toggleDayOff(index), t('markOffHint'));
      }
      if (!summary.off) {
        link(summary.half ? t('unmarkHalf') : t('markHalf'), `half-${index}`,
          () => session.toggleAfternoonOff(index), t('markHalfHint'));
      }
      list.append(item);
    });
    return section(t('sectionDays'), [list]);
  };

  const build = (view) => {
    const nodes = [header(view)];
    if (view.phase === 'loading') nodes.push(notice(t('loading'), 'muted'));
    else if (view.phase === 'unavailable') nodes.push(notice(failureText(view.failure), 'warning'));
    else if (view.phase === 'ready') {
      if (view.offline && view.failure) nodes.push(notice(failureText(view.failure), 'warning'));
      nodes.push(weekSection(view));
      if (view.week.today) nodes.push(todaySection(view));
      nodes.push(daysSection(view));
    }
    nodes.push(h('footer', { class: 'betterslack-quelio-details__foot' }, [
      button(t('signOut'), 'sign-out', () => { close(); onSignOut(); }),
      button(t('settings'), 'settings', () => { close(); onSettings(); },
        'c-button-unstyled betterslack-quelio-details__link'),
    ]));
    return nodes;
  };

  /**
   * Under the bar, kept inside the window. Without one -- opened from the
   * palette while Slack has no top bar to put it in -- at the top, centred.
   */
  const place = () => {
    if (!layer) return;
    const view = layer.ownerDocument.defaultView ?? window;
    const width = layer.offsetWidth || 340;
    const rect = anchor?.isConnected ? anchor.getBoundingClientRect() : null;
    const left = Math.max(8, Math.min(rect ? rect.left : (view.innerWidth - width) / 2, view.innerWidth - width - 8));
    const top = rect ? rect.bottom + 6 : 48;
    layer.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
    panel.style.maxHeight = `${Math.max(160, view.innerHeight - top - 12)}px`;
  };

  const onDown = (event) => {
    if (!layer || layer.contains(event.target) || anchor?.contains(event.target)) return;
    close();
  };
  const onKey = (event) => {
    if (event.key !== 'Escape' || !layer) return;
    event.stopPropagation();
    close();
    anchor?.focus();
  };

  function close() {
    if (!layer) return;
    clearTimeout(arming);
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', place);
    layer.remove();
    layer = null;
    panel = null;
    onToggle(false);
  }

  const update = (view) => {
    if (view) last = view;
    if (!layer || !last) return;
    view = last;
    const focused = document.activeElement?.closest?.(`#${LAYER_ID}`)
      ? document.activeElement.getAttribute('data-action')
      : null;
    panel.replaceChildren(...build(view));
    if (focused) panel.querySelector(`[data-action="${focused}"]`)?.focus();
    place();
  };

  const open = (target, view) => {
    close();
    anchor = target;
    panel = h('div', {
      class: 'betterslack-quelio-details',
      role: 'dialog',
      'aria-label': t('title'),
      tabindex: '-1',
    });
    layer = h('div', { id: LAYER_ID, class: 'betterslack-quelio-layer' }, [panel]);
    document.body.append(layer);
    update(view ?? last);
    panel.focus();
    onToggle(true);
    window.addEventListener('resize', place);
    // Next tick: the click that opened this is still travelling.
    arming = setTimeout(() => {
      document.addEventListener('mousedown', onDown, true);
      document.addEventListener('keydown', onKey, true);
    }, 0);
  };

  return {
    open,
    close,
    update,
    toggle(target, view) {
      if (layer && anchor === target) close();
      else open(target, view);
    },
  };
}
