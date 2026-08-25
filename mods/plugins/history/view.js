/**
 * The view: everything that has happened, gathered under the thing it happened
 * to.
 *
 * Where it goes, how it gets a tab in Slack's rail, which tab is lit and what
 * closes it are all `api.slack.addView`, because none of that is about history:
 * it is Slack's chrome, and the runtime is where Slack's chrome is known. This
 * file builds the contents and nothing else.
 *
 * **A card, not a feed.** The watchers produce events, and a list of events is
 * the wrong shape to read: one message picking up ten reactions was ten rows,
 * each repeating the time, the channel and a count nobody can use, and not one
 * of them said which message. Nobody thinks "there were ten events" -- they
 * think "this message got reactions", which is one thing with a list under it.
 * So a card is a message: who wrote it, what it says, and underneath, what
 * happened to it. Anything with no message behind it -- a rename, a status,
 * somebody joining -- is a card of one line, because it has no subject to
 * gather under.
 *
 * Everything is painted from Slack's own tokens rather than borrowed from its
 * class names: `--dt_color-*` follows every theme, while a class like
 * `p-view_header__text` is compiler output that churns between builds. The
 * field and the buttons are the exception, where Slack's classes are stable BEM
 * and worth borrowing outright.
 */

import { foldReactions, group } from './store.js';

const SORTS = ['newest', 'oldest', 'where'];
const GROUP_KEYS = ['messages', 'reactions', 'names', 'people'];

/** Which family a kind belongs to, for the colour of its mark. */
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
   * The day a run of cards belongs to, as Slack labels one.
   *
   * Slack breaks its own list with a date divider rather than stamping every
   * line, and a hundred rows each carrying the same day reads as a spreadsheet.
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

  const nameOf = (people, id, fallback) => (id
    ? (people.get(id)?.name ?? fallback ?? id)
    : (fallback ?? t('someone')));

  /** Somebody's text, with its emoji drawn rather than spelled. */
  const said = (text, extra = '') => {
    const line = h('div', { class: `bsh-said${extra}`, title: text }, []);
    // Nodes rather than a string: the emoji are `<img>`, and building HTML out
    // of somebody's message to get them there would put their words through an
    // HTML parser.
    line.append(deps.renderText ? deps.renderText(text) : document.createTextNode(text));
    return line;
  };

  const emojiNode = (event) => {
    const src = event.emojiUrl ?? deps.emojiUrl?.(event.emoji) ?? null;
    // Where nothing can draw it the emoji is left out rather than spelled: on
    // this line it is the whole content, and a shortcode there reads as a
    // rendering that failed. The name stays in the line's title.
    return src
      ? h('img', { class: 'bsh-emoji', src, alt: event.emoji ?? '' })
      : h('span', { class: 'bsh-emoji bsh-emoji--unknown', 'aria-hidden': 'true' }, ['·']);
  };

  /** One thing that happened, as the sentence a person reads. */
  const happening = (event, people) => {
    const family = FAMILY[event.kind] ?? 'messages';

    if (event.kind === 'reaction-added' || event.kind === 'reaction-removed') {
      // Alphabetical, and `localeCompare` rather than `<`: a code-point
      // compare files every accented name after Z, which reads as a list that
      // is nearly sorted and therefore as one that is broken.
      const names = event.people
        .map((person) => nameOf(people, person.id, person.who))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
      return h('div', { class: `bsh-did bsh-did--${family}`, title: event.emoji ?? '' }, [
        emojiNode(event),
        h('span', { class: 'bsh-verb' }, [t(event.kind === 'reaction-added' ? 'verbReacted' : 'verbUnreacted')]),
        // Named where Slack named them, and silent where it did not: on screen
        // it says who only in a hover tooltip, in the reader's language.
        h('span', { class: 'bsh-people' }, [names.length ? names.join(', ') : t('someone')]),
      ]);
    }

    if (event.kind === 'edited') {
      const both = h('div', { class: 'bsh-both' }, [said(event.before, ' bsh-was')]);
      if (event.after) both.append(said(event.after));
      return h('div', { class: 'bsh-did bsh-did--messages' }, [
        h('span', { class: 'bsh-verb' }, [t('verbEdited', { who: nameOf(people, event.userId, event.who) })]),
        both,
      ]);
    }

    if (event.kind === 'deleted') {
      return h('div', { class: 'bsh-did bsh-did--messages' }, [
        h('span', { class: 'bsh-verb bsh-verb--gone' }, [t('verbDeleted')]),
      ]);
    }

    // Everything with no message behind it: a rename, a status, an arrival.
    const verb = h('span', { class: 'bsh-verb' }, [
      t(`verb_${event.kind}`, { who: nameOf(people, event.userId, event.who) }),
    ]);
    if (!event.before && !event.after) {
      return h('div', { class: `bsh-did bsh-did--${family}` }, [verb]);
    }
    const both = h('div', { class: 'bsh-both' }, []);
    if (event.before) both.append(said(event.before, ' bsh-was'));
    if (event.after) both.append(said(event.after));
    return h('div', { class: `bsh-did bsh-did--${family}` }, [verb, both]);
  };

  /**
   * The channel, as a way back to it.
   *
   * A name that looks like a link and is not is worse than plain text, so where
   * there is no id to open there is no button either.
   */
  const channelLink = (card) => {
    const where = card.channelName ?? card.channelId;
    if (!where) return null;
    if (!card.channelId) return h('span', { class: 'bsh-where' }, [where]);
    const link = h('button', {
      class: 'c-button-unstyled bsh-where bsh-where--link',
      type: 'button',
      title: t('openChannel', { channel: where }),
    }, [where]);
    link.addEventListener('click', () => { close(); deps.openConversation(card.channelId); });
    return link;
  };

  const cardNode = (card, people) => {
    const { reactions, rest } = foldReactions(card.events);
    const family = FAMILY[card.events[0]?.kind] ?? 'messages';
    const author = card.subjectUser ? people.get(card.subjectUser) : null;
    const who = author?.name || card.subjectWho || card.events[0]?.who
      || nameOf(people, card.subjectUser, null) || t('someone');

    const face = author?.avatar
      ? h('img', { class: 'bsh-avatar', src: author.avatar, alt: '', loading: 'lazy' })
      : h('span', { class: `bsh-avatar bsh-avatar--none bsh-avatar--${family}` });

    const head = h('div', { class: 'bsh-card__head' }, [h('span', { class: 'bsh-who' }, [who])]);
    if (author?.status) head.append(api.slack.statusNode(author.status, author.profile, { showText: false }));
    head.append(h('span', { class: 'bsh-time' }, [time(card.at)]));
    const link = channelLink(card);
    if (link) head.append(h('span', { class: 'bsh-dim' }, ['·']), link);

    const body = h('div', { class: 'bsh-card__body' }, [head]);
    /*
     * The message itself, once, above everything that happened to it.
     *
     * Not repeated on every line, and not missing entirely, which is what a
     * reaction row used to be: an emoji and a count, with no way to tell which
     * message they belonged to. An edit is the exception -- it shows both
     * wordings, and the newer one is the message.
     */
    const edited = rest.some((event) => event.kind === 'edited');
    if (card.subject && !edited) body.append(said(card.subject, ' bsh-subject'));
    for (const event of rest) body.append(happening(event, people));
    for (const reaction of reactions) body.append(happening(reaction, people));

    const actions = h('div', { class: 'bsh-card__actions' });
    const gone = card.events.some((event) => event.kind === 'deleted');
    if (card.ts && card.channelId && !gone) {
      actions.append(api.helpers.iconButton({
        label: t('jump'),
        icon: '<svg viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M7.3 4.3a1 1 0 0 1 1.4 0l5 5a1 1 0 0 1 0 1.4l-5 5a1 1 0 1 1-1.4-1.4L11.6 10 7.3 5.7a1 1 0 0 1 0-1.4Z"/></svg>',
        onClick: () => { close(); deps.openMessage(card.channelId, card.ts); },
      }));
    }
    const copyable = card.subject ?? card.events.find((event) => event.before)?.before ?? null;
    if (copyable) {
      actions.append(api.helpers.iconButton({
        label: t('copy'),
        icon: '<svg viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M7 2.75A2.25 2.25 0 0 0 4.75 5v8A2.25 2.25 0 0 0 7 15.25h6A2.25 2.25 0 0 0 15.25 13V5A2.25 2.25 0 0 0 13 2.75H7Zm-.75 2.25A.75.75 0 0 1 7 4.25h6a.75.75 0 0 1 .75.75v8a.75.75 0 0 1-.75.75H7a.75.75 0 0 1-.75-.75V5Z"/><path fill="currentColor" d="M3.25 7.5a.75.75 0 0 0-1.5 0V15A3.25 3.25 0 0 0 5 18.25h6.5a.75.75 0 0 0 0-1.5H5A1.75 1.75 0 0 1 3.25 15V7.5Z"/></svg>',
        onClick: () => void api.helpers.copy(copyable, t('copied')),
      }));
    }

    return h('div', { class: `bsh-card bsh-card--${family}` }, [face, body, actions]);
  };

  const draw = async () => {
    if (!panel) return;
    const log = deps.getLog();
    const rows = deps.view(log, { query, sort, groups });
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
      // A filter that can only ever return nothing is a filter in the way.
      chip.toggleAttribute('hidden', key !== 'all' && (counts[key] ?? 0) === 0 && !groups.includes(key));
    }

    const cards = group(rows);
    if (count) count.textContent = t('countOf', { shown: cards.length, total: counts.all });

    if (cards.length === 0) {
      list.replaceChildren(h('div', { class: 'bsh-empty' }, [
        h('p', { class: 'bsh-empty__title' }, [log.length === 0 ? t('empty') : t('noMatch')]),
        h('p', { class: 'bsh-dim' }, [log.length === 0 ? t('emptyHint') : t('noMatchHint')]),
      ]));
      return;
    }

    // Drawn with what is known first, so the list is never blank while the
    // faces and the names are being fetched.
    const people = await deps.peopleFor(rows);
    if (!panel) return;

    const nodes = [];
    let day = null;
    for (const card of cards) {
      // Only where the order still means days: sorted by channel, a date
      // divider every other card is noise rather than structure.
      if (sort === 'newest' || sort === 'oldest') {
        const stamp = dayOf(card.at);
        if (stamp !== day) {
          day = stamp;
          nodes.push(h('div', { class: 'bsh-day' }, [h('span', { class: 'bsh-day__label' }, [dayLabel(stamp)])]));
        }
      }
      nodes.push(cardNode(card, people));
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
      // The header Slack puts on every view: the title on the left, what acts
      // on the whole view on the right, and a hairline under it.
      h('header', { class: 'bsh-header' }, [
        h('div', { class: 'bsh-header__titles' }, [
          h('h1', { class: 'bsh-header__title' }, [t('title')]),
          h('p', { class: 'bsh-header__hint bsh-dim' }, [t('subtitle')]),
        ]),
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
