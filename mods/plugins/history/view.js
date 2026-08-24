/**
 * The view: everything that has happened, laid out.
 *
 * Where it goes, how it gets a tab in Slack's rail, which tab is lit and what
 * closes it are all `api.slack.addView`, because none of that is about
 * history: it is Slack's chrome, and the runtime is where Slack's chrome is
 * known. This file builds the contents and nothing else.
 *
 * Everything it draws is painted from Slack's own tokens rather than borrowed
 * from Slack's own class names: `--dt_color-*` follows every theme, while a
 * class like `p-view_header__text` is compiler output that churns between
 * builds. The one exception is the field and the buttons, where Slack's classes
 * are stable BEM and worth borrowing outright.
 */

const SORTS = ['newest', 'oldest', 'kind', 'who', 'where'];
const GROUP_KEYS = ['messages', 'reactions', 'names', 'people'];

/** Which family a kind belongs to, for the colour of its dot. */
const FAMILY = {
  edited: 'messages', deleted: 'messages',
  'reaction-added': 'reactions', 'reaction-removed': 'reactions',
  'channel-renamed': 'names', 'section-renamed': 'names', 'name-changed': 'names',
  joined: 'people', left: 'people', 'status-changed': 'people',
};

export function createView(api, t, deps) {
  const { h } = api.dom;
  let view = null;
  let panel = null;
  let query = '';
  let groups = [];
  let sort = 'newest';

  const time = (at) => new Date(at).toLocaleTimeString(api.i18n.locale, { hour: '2-digit', minute: '2-digit' });

  /**
   * The day a run of entries belongs to, as Slack labels one.
   *
   * Slack breaks its own message list with a date divider rather than putting a
   * date on every line, and a list of a hundred rows each stamped with the same
   * day reads as a spreadsheet. Today and yesterday are named, because that is
   * what people say.
   */
  const dayOf = (at) => {
    const day = new Date(at);
    day.setHours(0, 0, 0, 0);
    return day.getTime();
  };
  const dayLabel = (stamp) => {
    const today = dayOf(Date.now());
    if (stamp === today) return t('today');
    if (stamp === today - 86400000) return t('yesterday');
    return new Date(stamp).toLocaleDateString(api.i18n.locale, { weekday: 'long', day: 'numeric', month: 'long' });
  };

  /** One event, as the sentence a person reads. */
  const change = (entry) => {
    if (entry.kind === 'reaction-added' || entry.kind === 'reaction-removed') {
      return [h('div', { class: 'bsh-line' }, [
        h('span', { class: 'bsh-emoji' }, [entry.emoji ?? '?']),
        h('span', { class: 'bsh-dim' }, [t('reactionCount', { before: entry.before, after: entry.after })]),
      ])];
    }
    if (entry.kind === 'joined' || entry.kind === 'left') {
      return [h('div', { class: 'bsh-line bsh-dim' }, [t(entry.kind === 'joined' ? 'joinedBody' : 'leftBody')])];
    }
    const lines = [];
    if (entry.before) lines.push(h('div', { class: 'bsh-line bsh-was', title: entry.before }, [entry.before]));
    if (entry.after) lines.push(h('div', { class: 'bsh-line', title: entry.after }, [entry.after]));
    else if (entry.kind === 'deleted') lines.push(h('div', { class: 'bsh-line bsh-dim' }, [t('deletedBody')]));
    return lines;
  };

  const row = (entry, names) => {
    const who = entry.who || (entry.userId ? (names.get(entry.userId) ?? entry.userId) : t('someone'));
    const where = entry.channelName ?? entry.channelId ?? null;

    const actions = h('div', { class: 'bsh-row__actions' });
    // Only where there is still something to land on: a button that opens a
    // message somebody deleted is a button that does nothing.
    if (entry.ts && entry.channelId && entry.kind !== 'deleted') {
      const jump = api.helpers.iconButton({
        label: t('jump'),
        icon: '<svg viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M7.3 4.3a1 1 0 0 1 1.4 0l5 5a1 1 0 0 1 0 1.4l-5 5a1 1 0 1 1-1.4-1.4L11.6 10 7.3 5.7a1 1 0 0 1 0-1.4Z"/></svg>',
        onClick: () => { close(); deps.openMessage(entry.channelId, entry.ts); },
      });
      actions.append(jump);
    }
    if (entry.before) {
      const copy = api.helpers.iconButton({
        label: t('copy'),
        icon: '<svg viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M7 2.75A2.25 2.25 0 0 0 4.75 5v8A2.25 2.25 0 0 0 7 15.25h6A2.25 2.25 0 0 0 15.25 13V5A2.25 2.25 0 0 0 13 2.75H7Zm-.75 2.25A.75.75 0 0 1 7 4.25h6a.75.75 0 0 1 .75.75v8a.75.75 0 0 1-.75.75H7a.75.75 0 0 1-.75-.75V5Z"/><path fill="currentColor" d="M3.25 7.5a.75.75 0 0 0-1.5 0V15A3.25 3.25 0 0 0 5 18.25h6.5a.75.75 0 0 0 0-1.5H5A1.75 1.75 0 0 1 3.25 15V7.5Z"/></svg>',
        onClick: () => void api.helpers.copy(entry.before, t('copied')),
      });
      actions.append(copy);
    }

    const meta = h('div', { class: 'bsh-row__meta' }, [
      h('span', { class: 'bsh-who' }, [who]),
      h('span', { class: `bsh-kind bsh-kind--${FAMILY[entry.kind] ?? 'messages'}` }, [t(entry.kind)]),
    ]);
    if (where) {
      meta.append(h('span', { class: 'bsh-dim' }, ['·']), h('span', { class: 'bsh-where' }, [where]));
    }

    return h('div', { class: 'bsh-row' }, [
      h('span', { class: 'bsh-row__time' }, [time(entry.at)]),
      h('span', { class: `bsh-dot bsh-dot--${FAMILY[entry.kind] ?? 'messages'}`, 'aria-hidden': 'true' }),
      h('div', { class: 'bsh-row__body' }, [meta, ...change(entry)]),
      actions,
    ]);
  };

  const draw = async () => {
    if (!panel) return;
    const log = deps.getLog();
    const rows = deps.view(log, { query, groups, sort });
    const counts = deps.tally(log);

    const list = panel.querySelector('.bsh-list');
    const count = panel.querySelector('.bsh-count');
    if (!list) return;

    for (const chip of panel.querySelectorAll('.bsh-tab')) {
      const key = chip.getAttribute('data-group');
      const on = key === 'all' ? groups.length === 0 : groups.includes(key);
      chip.setAttribute('aria-selected', String(on));
      const badge = chip.querySelector('.bsh-tab__count');
      if (badge) badge.textContent = String(counts[key] ?? 0);
    }
    if (count) count.textContent = t('countOf', { shown: rows.length, total: log.length });

    if (rows.length === 0) {
      list.replaceChildren(h('div', { class: 'bsh-empty' }, [
        h('p', { class: 'bsh-empty__title' }, [log.length === 0 ? t('empty') : t('noMatch')]),
        h('p', { class: 'bsh-dim' }, [log.length === 0 ? t('emptyHint') : t('noMatchHint')]),
      ]));
      return;
    }

    // Drawn with what is known first, so the list is never blank while the
    // names are being fetched.
    const names = await deps.namesFor(rows);
    if (!panel) return;

    const nodes = [];
    let day = null;
    for (const entry of rows) {
      // Only where the order still means days: sorted by who or by what, a
      // date divider every other line is noise rather than structure.
      if (sort === 'newest' || sort === 'oldest') {
        const stamp = dayOf(entry.at);
        if (stamp !== day) {
          day = stamp;
          nodes.push(h('div', { class: 'bsh-day' }, [h('span', { class: 'bsh-day__label' }, [dayLabel(stamp)])]));
        }
      }
      nodes.push(row(entry, names));
    }
    list.replaceChildren(...nodes);
  };

  const close = () => view?.close();

  const build = () => {
    const search = h('input', {
      class: 'c-input_text bsh-search',
      type: 'text',
      placeholder: t('search'),
      spellcheck: 'false',
      'aria-label': t('search'),
    });
    search.value = query;
    // Its own listener rather than a redraw of everything: typing must not take
    // the focus back off the box it is being typed into.
    search.addEventListener('input', api.helpers.debounce(() => { query = search.value; void draw(); }, 120));

    const tabs = h('div', { class: 'bsh-tabs', role: 'tablist' });
    for (const key of ['all', ...GROUP_KEYS]) {
      const tab = h('button', {
        class: 'c-button-unstyled bsh-tab',
        type: 'button',
        role: 'tab',
        'data-group': key,
        'aria-selected': 'false',
      }, [
        h('span', {}, [t(`group_${key}`)]),
        h('span', { class: 'bsh-tab__count' }, ['0']),
      ]);
      tab.addEventListener('click', () => {
        if (key === 'all') groups = [];
        else if (groups.includes(key)) groups = groups.filter((other) => other !== key);
        else groups = [...groups, key];
        void draw();
      });
      tabs.append(tab);
    }

    const sortButton = h('button', {
      class: 'c-button c-button--outline c-button--medium bsh-sort',
      type: 'button',
      'aria-haspopup': 'menu',
    }, [t('sortBy', { sort: t(`sort_${sort}`) })]);
    sortButton.addEventListener('click', () => {
      // `onSelect`, which is what api.ui.menu reads. An `onClick` here parses,
      // renders and silently does nothing at all.
      api.ui.menu(sortButton, SORTS.map((id) => ({
        label: t(`sort_${id}`),
        onSelect: () => {
          sort = id;
          sortButton.textContent = t('sortBy', { sort: t(`sort_${id}`) });
          void draw();
        },
      })), { align: 'right' });
    });

    const clear = h('button', { class: 'c-button c-button--danger c-button--medium', type: 'button' }, [t('clear')]);
    clear.addEventListener('click', async () => {
      const total = deps.getLog().length;
      const sure = await api.ui.confirm({
        title: t('clearTitle'),
        message: t('clearBody', { count: total }),
        confirmLabel: t('clear'),
        danger: true,
      });
      if (!sure) return;
      await deps.clear();
      api.ui.toast(t('cleared'), { variant: 'success' });
      void draw();
    });

    const node = h('div', { class: 'bsh-view' }, [
      // The header Slack puts on every view: a title on the left, what acts on
      // the whole view on the right, and a hairline under it.
      h('header', { class: 'bsh-header' }, [
        h('div', { class: 'bsh-header__titles' }, [
          h('h1', { class: 'bsh-header__title' }, [t('title')]),
          h('p', { class: 'bsh-header__hint bsh-dim' }, [t('subtitle')]),
        ]),
        // No close button: this is a view, and you leave a view by going
        // somewhere else, exactly as you leave Activité.
        h('div', { class: 'bsh-header__actions' }, [clear]),
      ]),
      h('div', { class: 'bsh-bar' }, [tabs, h('div', { class: 'bsh-bar__right' }, [search, sortButton])]),
      h('div', { class: 'bsh-list', role: 'list' }),
      h('footer', { class: 'bsh-footer' }, [h('span', { class: 'bsh-count bsh-dim' }, [''])]),
    ]);

    panel = node;
    queueMicrotask(() => search.focus());
    void draw();
    return node;
  };

  view = api.slack.addView({
    id: 'log',
    label: t('title'),
    icon: deps.icon,
    render: build,
    onOpen: () => deps.onOpen?.(),
    onClose: () => { panel = null; deps.onClose?.(); },
  });

  return {
    open: () => view.open(),
    close,
    isOpen: () => view.isOpen(),
    refresh: () => { if (panel) void draw(); },
    /** Where the runtime put the tab, so the badge does not guess at it. */
    tabSelector: view.tabSelector,
  };
}
