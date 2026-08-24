/**
 * The page: everything that has happened, in one place you can search and sort.
 *
 * Built out of Slack's own classes -- `c-input_text` for the search, `c-button`
 * for the actions, `c-menu` through `api.ui.menu` for the sort -- so it follows
 * every theme with no colours of its own. Two deliberate exceptions, both
 * measured rather than chosen:
 *
 * **It does not wear `.c-dialog`.** Slack ships that class at `opacity: 0` and
 * fades it in itself, so anything of ours wearing it renders in the document,
 * takes focus and shows nothing unless it says otherwise. `api.ui.modal` does
 * say otherwise -- but it also caps its content at 640px tall, which is a
 * dialog and not the page this is. Its own shell, its own opacity, no trap.
 *
 * **The sort is a button and a menu, never a `<select>`.** A native dropdown is
 * drawn by the operating system, so on a dark theme it opens as a white
 * rectangle in the middle of a dark page. Slack's own select is a bordered
 * button that opens a `c-menu`, and `api.ui.menu` is that menu.
 */

const SORTS = ['newest', 'oldest', 'kind', 'who', 'where'];
const GROUP_KEYS = ['messages', 'reactions', 'names', 'people'];

/** Which family a kind belongs to, for the colour on its badge. */
const FAMILY = {
  edited: 'messages', deleted: 'messages',
  'reaction-added': 'reactions', 'reaction-removed': 'reactions',
  'channel-renamed': 'names', 'section-renamed': 'names', 'name-changed': 'names',
  joined: 'people', left: 'people', 'status-changed': 'people',
};

export function createPage(api, t, deps) {
  const { h } = api.dom;
  let host = null;
  let query = '';
  let groups = [];
  let sort = 'newest';

  const when = (at) => new Date(at).toLocaleString(api.i18n.locale, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });

  /** One event, as the sentence a person reads. */
  const change = (entry) => {
    if (entry.kind === 'reaction-added' || entry.kind === 'reaction-removed') {
      return h('div', { class: 'bsh-change' }, [
        h('code', { class: 'bsh-emoji' }, [entry.emoji ?? '?']),
        h('span', { class: 'bsh-muted' }, [t('reactionCount', { before: entry.before, after: entry.after })]),
      ]);
    }
    if (entry.kind === 'joined' || entry.kind === 'left') {
      return h('div', { class: 'bsh-change bsh-muted' }, [t(entry.kind === 'joined' ? 'joinedBody' : 'leftBody')]);
    }
    const before = entry.before ?? '';
    const after = entry.after ?? '';
    const rows = [];
    if (before) {
      rows.push(h('div', { class: 'bsh-before', title: before }, [before]));
    }
    if (after) {
      rows.push(h('div', { class: 'bsh-after', title: after }, [after]));
    } else if (entry.kind === 'deleted') {
      rows.push(h('div', { class: 'bsh-muted' }, [t('deletedBody')]));
    }
    return h('div', { class: 'bsh-change' }, rows);
  };

  const row = (entry, names) => {
    const who = entry.who || (entry.userId ? (names.get(entry.userId) ?? entry.userId) : t('someone'));
    const where = entry.channelName ?? entry.channelId ?? '';

    const cells = [
      h('div', { class: 'bsh-cell bsh-cell--when' }, [when(entry.at)]),
      h('div', { class: 'bsh-cell bsh-cell--kind' }, [
        h('span', { class: `bsh-badge bsh-badge--${FAMILY[entry.kind] ?? 'messages'}` }, [t(entry.kind)]),
      ]),
      h('div', { class: 'bsh-cell bsh-cell--who', title: who }, [who]),
      h('div', { class: 'bsh-cell bsh-cell--where', title: where }, [where]),
      h('div', { class: 'bsh-cell bsh-cell--what' }, [change(entry)]),
    ];

    const actions = h('div', { class: 'bsh-cell bsh-cell--do' });
    // Only where there is still something to land on: a button that opens a
    // message somebody deleted is a button that does nothing.
    if (entry.ts && entry.channelId && entry.kind !== 'deleted') {
      const jump = h('button', { class: 'c-button-unstyled bsh-link', type: 'button' }, [t('jump')]);
      jump.addEventListener('click', () => { close(); deps.openMessage(entry.channelId, entry.ts); });
      actions.append(jump);
    }
    if (entry.before) {
      const copy = h('button', { class: 'c-button-unstyled bsh-link', type: 'button' }, [t('copy')]);
      copy.addEventListener('click', () => void api.helpers.copy(entry.before, t('copied')));
      actions.append(copy);
    }
    cells.push(actions);

    return h('div', { class: 'bsh-row' }, cells);
  };

  const draw = async () => {
    if (!host) return;
    const log = deps.getLog();
    const rows = deps.view(log, { query, groups, sort });
    const counts = deps.tally(log);

    const body = host.querySelector('.bsh-body');
    const foot = host.querySelector('.bsh-foot__count');
    if (!body) return;

    for (const chip of host.querySelectorAll('.bsh-chip')) {
      const key = chip.getAttribute('data-group');
      chip.setAttribute('aria-pressed', String(key === 'all' ? groups.length === 0 : groups.includes(key)));
      const count = chip.querySelector('.bsh-chip__count');
      if (count) count.textContent = String(counts[key === 'all' ? 'all' : key] ?? 0);
    }

    if (rows.length === 0) {
      body.replaceChildren(h('div', { class: 'bsh-empty' }, [
        h('p', { class: 'bsh-empty__title' }, [log.length === 0 ? t('empty') : t('noMatch')]),
        h('p', { class: 'bsh-muted' }, [log.length === 0 ? t('emptyHint') : t('noMatchHint')]),
      ]));
      if (foot) foot.textContent = t('countOf', { shown: 0, total: log.length });
      return;
    }

    // Names for ids, in one request and cached per workspace. Drawn with what
    // is known first so the page is never blank while it waits.
    const names = await deps.namesFor(rows);
    if (!host) return;
    body.replaceChildren(...rows.map((entry) => row(entry, names)));
    if (foot) foot.textContent = t('countOf', { shown: rows.length, total: log.length });
  };

  const close = () => {
    host?.remove();
    host = null;
    document.removeEventListener('keydown', onKey, true);
  };

  const onKey = (event) => {
    if (event.key === 'Escape' && host) { event.stopPropagation(); close(); }
  };

  const open = () => {
    if (host) { void draw(); return; }

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

    const chips = h('div', { class: 'bsh-chips' });
    for (const key of ['all', ...GROUP_KEYS]) {
      const chip = h('button', {
        class: 'c-button-unstyled bsh-chip',
        type: 'button',
        'data-group': key,
        'aria-pressed': 'false',
      }, [
        h('span', {}, [t(`group_${key}`)]),
        h('span', { class: 'bsh-chip__count' }, ['0']),
      ]);
      chip.addEventListener('click', () => {
        if (key === 'all') groups = [];
        else if (groups.includes(key)) groups = groups.filter((other) => other !== key);
        else groups = [...groups, key];
        void draw();
      });
      chips.append(chip);
    }

    const sortButton = h('button', {
      class: 'c-button c-button--outline c-button--medium bsh-sort',
      type: 'button',
      'aria-haspopup': 'menu',
    }, [t('sortBy', { sort: t(`sort_${sort}`) })]);
    sortButton.addEventListener('click', () => {
      api.ui.menu(sortButton, SORTS.map((id) => ({
        label: t(`sort_${id}`),
        onClick: () => {
          sort = id;
          sortButton.textContent = t('sortBy', { sort: t(`sort_${id}`) });
          void draw();
        },
      })));
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

    const closeButton = h('button', {
      class: 'c-button-unstyled bsh-close',
      type: 'button',
      'aria-label': t('close'),
      title: t('close'),
    }, ['✕']);
    closeButton.addEventListener('click', close);

    const panel = h('div', { class: 'bsh-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('title') }, [
      h('header', { class: 'bsh-head' }, [
        h('div', { class: 'bsh-head__titles' }, [
          h('h1', { class: 'bsh-title' }, [t('title')]),
          h('p', { class: 'bsh-muted' }, [t('subtitle')]),
        ]),
        closeButton,
      ]),
      h('div', { class: 'bsh-tools' }, [search, chips, sortButton]),
      h('div', { class: 'bsh-columns' }, [
        h('div', { class: 'bsh-cell bsh-cell--when' }, [t('colWhen')]),
        h('div', { class: 'bsh-cell bsh-cell--kind' }, [t('colWhat')]),
        h('div', { class: 'bsh-cell bsh-cell--who' }, [t('colWho')]),
        h('div', { class: 'bsh-cell bsh-cell--where' }, [t('colWhere')]),
        h('div', { class: 'bsh-cell bsh-cell--what' }, [t('colChange')]),
        h('div', { class: 'bsh-cell bsh-cell--do' }, []),
      ]),
      h('div', { class: 'bsh-body' }),
      h('footer', { class: 'bsh-foot' }, [
        h('span', { class: 'bsh-foot__count bsh-muted' }, ['']),
        clear,
      ]),
    ]);

    host = h('div', { class: 'bsh-scrim' }, [panel]);
    host.addEventListener('mousedown', (event) => { if (event.target === host) close(); });
    document.body.append(host);
    document.addEventListener('keydown', onKey, true);
    search.focus();
    void draw();
  };

  return {
    open,
    close,
    isOpen: () => Boolean(host),
    refresh: () => { if (host) void draw(); },
  };
}
