// The view in Slack's rail: your open merge requests, by project.
//
//   Vision  dating                                   2
//     Feat: remove app logic in nav and tab bar   !1658
//     feature/nav → master · 3 h ago
//     (✓ #298850)  ✓ ─ ✓ ─ ◜ ─ ○     7/12
//
// Built once. Every change of state is a patch: the project sections and the
// rows are kept by key, and a pipeline moving on rewrites one icon. The login
// form is kept too, since it is the one thing in here somebody may be typing in.

import { groupByProject } from '../lib/model.js';
import { iconOf, kindOf } from '../lib/status.js';
import { describePipeline } from '../lib/headline.js';
import { icon, patchList, setAttr, setText, show } from './dom.js';
import { createMergeRequestRow } from './merge-request.js';

const REFRESH_ICON =
  '<svg viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M10 3.5a6.5 6.5 0 0 0-6.36 ' +
  '5.15.75.75 0 1 1-1.47-.3A8 8 0 0 1 16 5.07V3.75a.75.75 0 0 1 1.5 0v3.5c0 .41-.34.75-.75.75h-3.5a.75.75 ' +
  '0 0 1 0-1.5h1.78A6.5 6.5 0 0 0 10 3.5m7.24 7.3a.75.75 0 0 1 .59.88A8 8 0 0 1 4 14.93v1.32a.75.75 0 0 ' +
  '1-1.5 0v-3.5c0-.41.34-.75.75-.75h3.5a.75.75 0 0 1 0 1.5H4.97a6.5 6.5 0 0 0 11.39-3.11.75.75 0 0 1 ' +
  '.88-.59"/></svg>';

export function createView({ api, t, format, store, login, onStage, onSignOut }) {
  const { h } = api.dom;

  // -- the header ---------------------------------------------------------
  const subtitle = h('p', { class: 'betterslack-gitlab-header__hint' });
  const refresh = h('button', { type: 'button', class: 'c-button c-button--outline c-button--small betterslack-gitlab-refresh' });
  const refreshLabel = h('span', {}, [t('refresh')]);
  refresh.append(icon(h, REFRESH_ICON, 'betterslack-gitlab-refresh__icon'), refreshLabel);
  refresh.addEventListener('click', () => { void store.refresh({ force: true }); });
  const foldAll = h('button', { type: 'button', class: 'c-button c-button--outline c-button--small' }, [t('collapseAll')]);
  const signOut = h('button', { type: 'button', class: 'c-button c-button--outline c-button--small' }, [t('signOut')]);
  signOut.addEventListener('click', () => onSignOut());
  const header = h('header', { class: 'betterslack-gitlab-header' }, [
    h('div', { class: 'betterslack-gitlab-header__titles' }, [
      h('h1', { class: 'betterslack-gitlab-header__title' }, [t('viewTitle')]),
      subtitle,
    ]),
    h('div', { class: 'betterslack-gitlab-header__actions' }, [foldAll, refresh, signOut]),
  ]);

  // -- the notes, the list, and the ways it can be empty --------------------
  const stale = h('p', { class: 'betterslack-gitlab-banner', 'data-tone': 'warning', role: 'status' });
  const partial = h('p', { class: 'betterslack-gitlab-banner', 'data-tone': 'muted', role: 'status' });
  const message = h('div', { class: 'betterslack-gitlab-message' }, [
    h('p', { class: 'betterslack-gitlab-message__title' }),
    h('p', { class: 'betterslack-gitlab-message__hint' }),
  ]);
  const projects = h('div', { class: 'betterslack-gitlab-projects' });
  const scroll = h('div', { class: 'betterslack-gitlab-scroll' }, [stale, partial, message, projects]);
  const loginPane = h('div', { class: 'betterslack-gitlab-scroll betterslack-gitlab-scroll--login' }, [login.element]);

  const root = h('div', { class: 'betterslack-gitlab-view' }, [header, scroll, loginPane]);

  // -- projects and rows ----------------------------------------------------
  const rowOptions = { api, t, format, onStage };

  // -- folding -----------------------------------------------------------------
  //
  // Which projects are folded is a preference, kept by project id -- numbers,
  // and nothing about what is in them. It is written through `api.settings`,
  // which the plugin may do without being restarted (only the panel restarts
  // it), and read once here.
  const kept = api.settings.get('collapsed', []);
  const collapsed = new Set(Array.isArray(kept) ? kept.filter(Number.isFinite) : []);
  const persist = () => Promise.resolve()
    .then(() => api.settings.set('collapsed', [...collapsed].slice(-200)))
    .catch(() => undefined);
  let groups = [];

  /** Draw a section as folded or open, from the set. */
  const fold = (section) => {
    const { list, toggle, name } = section.__parts;
    const closed = collapsed.has(Number(section.dataset.key));
    show(list, !closed);
    setAttr(section, 'data-collapsed', closed ? '' : null);
    setAttr(toggle, 'aria-expanded', String(!closed));
    setAttr(toggle, 'aria-label', t(closed ? 'expandProject' : 'collapseProject', { name: name.textContent }));
  };
  const foldAllLabel = () => {
    const every = groups.length > 0 && groups.every((group) => collapsed.has(group.projectId));
    setText(foldAll, t(every ? 'expandAll' : 'collapseAll'));
    show(foldAll, groups.length > 1);
    return every;
  };
  foldAll.addEventListener('click', () => {
    const every = foldAllLabel();
    for (const group of groups) {
      if (every) collapsed.delete(group.projectId); else collapsed.add(group.projectId);
    }
    for (const section of projects.children) fold(section);
    foldAllLabel();
    persist();
  });

  /** What is going on inside a folded project: how many of its pipelines failed, how many are running. */
  const summarise = (group, state) => {
    let failed = 0;
    let running = 0;
    for (const mr of group.mergeRequests) {
      const head = state.pipelines[mr.id]?.list?.[0];
      const kind = head ? kindOf(head.status) : null;
      if (kind === 'failed') failed += 1;
      else if (kind === 'running') running += 1;
    }
    return { failed, running };
  };

  const createSection = () => {
    // A project is a place, not a line of the list: it has a mark of its own.
    const initial = h('span', { class: 'betterslack-gitlab-project__initial', 'aria-hidden': 'true' });
    const name = h('a', { class: 'betterslack-gitlab-project__name', target: '_blank', rel: 'noopener noreferrer' });
    const namespace = h('span', { class: 'betterslack-gitlab-project__namespace' });
    const count = h('span', { class: 'betterslack-gitlab-project__count' });
    const list = h('ul', { class: 'betterslack-gitlab-mrs' });
    const toggle = h('button', { type: 'button', class: 'betterslack-gitlab-project__toggle', 'aria-expanded': 'true' });
    const summary = h('span', { class: 'betterslack-gitlab-project__summary' });
    const head = h('header', { class: 'betterslack-gitlab-project__head' }, [toggle, initial, name, namespace, summary, count]);
    const section = h('section', { class: 'betterslack-gitlab-project' }, [head, list]);
    section.__parts = { toggle, summary, initial, name, namespace, count, list };
    // Anywhere on the band folds it, except the project's own link.
    head.addEventListener('click', (event) => {
      if (event.target.closest('a')) return;
      const id = Number(section.dataset.key);
      if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
      fold(section);
      foldAllLabel();
      persist();
    });
    section.__dispose = () => { for (const row of list.children) row.__dispose?.(); };
    return section;
  };

  const updateSection = (section, { group, state }) => {
    const { initial, name, namespace, count, list, summary } = section.__parts;
    setText(initial, (group.name.match(/[\p{L}\p{N}]/u)?.[0] ?? '#').toUpperCase());
    setText(name, group.name);
    setAttr(name, 'href', group.webUrl);
    name.toggleAttribute('data-inert', !group.webUrl);
    setAttr(name, 'aria-label', t('openProject', { name: group.name }));
    setText(namespace, group.namespace);
    show(namespace, Boolean(group.namespace));
    setText(count, String(group.mergeRequests.length));
    // Redrawn only when a count moved.
    const { failed, running } = summarise(group, state);
    const summaryKey = `${failed}/${running}`;
    if (section.__summaryKey !== summaryKey) {
      section.__summaryKey = summaryKey;
      const chip = (status, tone, word) => {
        const node = h('span', { class: 'betterslack-gitlab-summary', 'data-tone': tone, title: word, 'aria-label': word });
        node.append(icon(h, iconOf(status)), String(word.match(/\d+/)?.[0] ?? ''));
        return node;
      };
      summary.replaceChildren(
        ...(failed > 0 ? [chip('failed', 'danger', t('summaryFailed', { count: failed }))] : []),
        ...(running > 0 ? [chip('running', 'info', t('summaryRunning', { count: running }))] : []),
      );
    }
    patchList(list, group.mergeRequests.map((mr) => ({ mr, state })), {
      key: ({ mr }) => mr.id,
      create: () => {
        const row = createMergeRequestRow(rowOptions);
        row.element.__row = row;
        return row.element;
      },
      update: (element, { mr }) => {
        const entry = state.pipelines[mr.id];
        const head = entry?.list?.[0];
        element.__row.update({
          mr,
          pipeline: head ? describePipeline({ mr, pipeline: head }, state) : null,
          error: entry?.error ?? null,
        });
      },
    });
    fold(section);
  };

  const say = (title, hint) => {
    setText(message.firstElementChild, title);
    setText(message.lastElementChild, hint);
    show(message, Boolean(title));
  };

  return {
    element: root,

    /** Bring the whole view up to date with the store. Cheap when little changed. */
    update(state) {
      const signedIn = state.ready && state.signedIn;
      show(header, signedIn);
      show(scroll, signedIn || !state.ready);
      show(loginPane, state.ready && !state.signedIn);
      login.update(state);
      if (!signedIn) {
        say(state.ready ? '' : t('loading'), '');
        show(stale, false);
        show(partial, false);
        show(projects, false);
        // Signed out: the lists are not kept in the page either.
        if (projects.firstElementChild) {
          for (const section of projects.children) section.__dispose?.();
          projects.replaceChildren();
        }
        return;
      }

      // The header: who, how many, how fresh.
      const who = state.user ? t('connectedAs', { name: state.user.name, username: state.user.username }) : '';
      const fresh = state.fetchedAt ? t('updatedAt', { time: format.ago(state.fetchedAt) }) : '';
      setText(subtitle, [who, state.mergeRequests.length > 0 ? format.count(state.mergeRequests.length) : '', fresh]
        .filter(Boolean).join(' · '));
      setText(refreshLabel, state.busy ? t('refreshing') : t('refresh'));
      setAttr(refresh, 'aria-busy', state.busy ? 'true' : null);
      refresh.toggleAttribute('data-busy', state.busy);

      // The last known state, said to be that.
      if (state.failure && state.fetchedAt) {
        setText(stale, t('staleNote', { reason: t(`error_${state.failure.reason}`), time: format.clock(state.fetchedAt) }));
        show(stale, true);
      } else {
        show(stale, false);
      }
      if (state.partial) {
        setText(partial, t('partialNote', { reason: t(state.partial === 'pagination' ? 'error_pagination' : `error_${state.partial}`) }));
        show(partial, true);
      } else {
        show(partial, false);
      }

      const known = state.fetchedAt > 0 || state.mergeRequests.length > 0;
      if (!known) say(state.failure ? t(`error_${state.failure.reason}`) : t('loading'), '');
      else if (state.mergeRequests.length === 0) say(t('empty'), t('emptyHint'));
      else say('', '');

      show(projects, state.mergeRequests.length > 0);
      const grouped = groupByProject(state.mergeRequests, state.projects).map((group) => ({ group, state }));
      patchList(projects, grouped, {
        key: ({ group }) => group.projectId,
        create: createSection,
        update: updateSection,
      });
      groups = grouped.map(({ group }) => group);
      foldAllLabel();
    },

    focusLogin: () => login.focus(),
    dispose() { for (const section of projects.children) section.__dispose?.(); },
  };
}
