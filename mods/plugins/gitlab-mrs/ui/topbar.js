// The pipeline in Slack's top bar.
//
//   ⑂  Vision !1658 feature/nav · build · 7/12   ✓ ✓ ◜ ○     (room to spare)
//   ⑂  Vision !1658 · 7/12   ✓ ✓ ◜ ○
//   ⑂  Vision !1658 · 7/12
//   ⑂  !1658 · 7/12
//   ⑂  7/12
//   ⑂                                                          (hardly any)
//
// Every part is always in the button, and `data-parts` says which are on screen:
// the merge request's branch goes first, then the stage's name, the row of
// stages, the project, the merge request and finally the count, leaving the icon
// -- a merge request tinted by how its pipeline is going. A failure keeps what
// failed longer than the project.
//
// What fits is *measured*, not guessed from the window's width: the room Slack's
// top bar leaves depends on Slack's own layout, and on whether another mod is in
// it. The choice of what to try, and in what order, is `lib/fit.js`.

import { iconOf, kindOf, labelKey, toneOf } from '../lib/status.js';
import { chooseLevel, levelsFor } from '../lib/fit.js';
import { icon, patchList, setAttr, setText } from './dom.js';

export const BAR_ID = 'betterslack-gitlab';

/**
 * The far left of Slack's top bar: `.p-ia4_top_nav__left_container--start`, an
 * empty flex container (`justify-content: flex-start`) that begins where the
 * space for the window's own buttons ends and runs to the history arrows --
 * 226px at 2560, measured on Slack 4.51. Nothing of Slack's is in it, so the bar
 * is the first thing in the top bar and nothing is moved to make room.
 *
 * Never in a row holding a coachmark wrapper: inserting beside one freezes the
 * renderer solid. The bar stays out, which is a bug report, rather than going
 * in, which is a frozen Slack.
 */
export const SLOT = '.p-ia4_top_nav__left_container--start:not(:has(> .c-coachmark-anchor))';

/**
 * A merge request: a branch that splits off and comes back. Tinted by how the
 * pipeline is going -- green, red, blue, grey -- which is the colour of the bar's
 * tone; the stages beside the count carry the same news as shapes.
 */
const MERGE = '<svg viewBox="0 0 16 16" aria-hidden="true" class="betterslack-gitlab-icon" data-kind="merge">'
  + '<circle cx="4.5" cy="3.5" r="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/>'
  + '<circle cx="4.5" cy="12.5" r="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/>'
  + '<circle cx="11.5" cy="3.5" r="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/>'
  + '<path d="M4.5 5.1v5.8M11.5 5.1v1.3a2.6 2.6 0 0 1-2.6 2.6H7.1a2.6 2.6 0 0 0-2.6 2.6" '
  + 'fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';

export function createBar({ api, t, onOpen }) {
  const { h } = api.dom;
  const part = (name, node) => { node.classList.add('betterslack-gitlab-bar__part', `betterslack-gitlab-bar__${name}`); return node; };

  const glyph = part('icon', icon(h, MERGE));
  const project = part('project', h('span'));
  const mr = part('mr', h('span'));
  const branch = part('branch', h('span'));
  const note = part('note', h('span'));
  const progress = part('progress', h('span'));
  const dots = part('dots', h('span'));
  const stale = part('stale', h('span', { 'aria-hidden': 'true' }));
  // Says the bar opens: drawn with borders, and turned when it is open.
  const caret = h('span', { class: 'betterslack-gitlab-bar__caret', 'aria-hidden': 'true' });

  const button = h('button', {
    id: BAR_ID,
    type: 'button',
    class: 'c-button-unstyled betterslack-gitlab-bar',
    'aria-haspopup': 'dialog',
    'aria-expanded': 'false',
  }, [glyph, project, mr, branch, note, progress, dots, stale, caret]);
  button.addEventListener('click', () => onOpen(button));

  let levels = levelsFor({ failed: false });
  const overflows = (node) => node.scrollWidth > node.clientWidth + 1;

  /*
   * How far left of Slack's own start the bar may go.
   *
   * Slack keeps `.p-ia4_top_nav__native_ui_spacer` -- 76px at 2560 -- empty at the
   * left of the top bar for the window's own buttons. In a window that is full
   * screen they are not there, and the bar can use that room, leaving a small
   * margin to the edge; in one that is not, they are, and it must not go near.
   * Read from the spacer's own width, so a platform with no such room (nothing
   * reserved) is not moved at all.
   */
  const EDGE = 14;
  const fullScreen = () => Boolean(window.matchMedia?.('(display-mode: fullscreen)').matches)
    || (window.screen && window.innerWidth === window.screen.width && window.innerHeight === window.screen.height);
  const applyBleed = () => {
    const spacer = document.querySelector('.p-ia4_top_nav__native_ui_spacer');
    const room = fullScreen() && spacer ? Math.max(0, spacer.offsetWidth - EDGE) : 0;
    const value = `${room}px`;
    if (button.style.getPropertyValue('--gl-bleed') !== value) button.style.setProperty('--gl-bleed', value);
  };

  const show = (level) => { setAttr(button, 'data-parts', level.join(' ')); };

  /*
   * Tried from the richest down, and left on the first that fits or on the
   * icon. The answer depends only on the room and the text, so watching the
   * bar settles after one more look instead of chasing itself.
   */
  const fit = () => {
    if (!button.isConnected) return;
    applyBleed();
    show(chooseLevel(levels, (level) => {
      show(level);
      return !overflows(button);
    }));
  };

  // Again whenever the room changes: the window, Slack laying its own bar out
  // around ours, or the sidebar being dragged. The button's own width does not
  // move when it is already as small as it gets, so its parent is watched too.
  const watcher = typeof ResizeObserver === 'function' ? new ResizeObserver(() => fit()) : null;
  let watching = null;
  const watch = () => {
    const parent = button.parentElement;
    if (!watcher || parent === watching) return;
    if (watching) watcher.unobserve(watching);
    watching = parent;
    if (parent) watcher.observe(parent);
  };
  watcher?.observe(button);
  window.addEventListener('resize', fit);
  api.onDispose(() => {
    window.removeEventListener('resize', fit);
    watcher?.disconnect();
  });

  const only = (levelParts) => { levels = levelParts; };

  return {
    element: button,

    /** @param {object} model  `buildHeadline`'s answer */
    update(model) {
      setAttr(button, 'data-phase', model.phase);
      setAttr(button, 'title', model.phase === 'ready' ? t('barUnfold') : null);
      const words = {
        signedOut: t('barSignIn'),
        invalid: t('barInvalid'),
        loading: t('barLoading'),
        empty: t('barEmpty'),
      };

      if (model.phase !== 'ready' || !model.headline) {
        const word = model.phase === 'ready' ? t('barNoPipeline', { count: model.count }) : words[model.phase];
        only([['icon', 'note'], ['icon']]);
        setAttr(button, 'data-tone', model.phase === 'invalid' ? 'warning' : 'muted');
        setAttr(button, 'data-kind', null);
        setText(note, word);
        for (const node of [project, mr, branch, progress, dots, stale]) setText(node, '');
        dots.replaceChildren();
        setAttr(button, 'aria-label', word);
        setAttr(stale, 'title', null);
        fit();
        watch();
        return;
      }

      const { headline } = model;
      const failed = kindOf(headline.status) === 'failed';
      only(levelsFor({ failed }));
      setAttr(button, 'data-tone', toneOf(headline.status));
      setAttr(button, 'data-kind', kindOf(headline.status));
      setText(project, headline.projectName);
      setText(mr, `!${headline.mr.iid}`);
      setText(branch, headline.mr.sourceBranch);
      setAttr(branch, 'title', headline.mr.sourceBranch || null);
      // What failed, else the stage that is going, else nothing: a finished
      // pipeline has no stage to name.
      setText(note, failed && headline.failedJob
        ? t('barFailed', { job: headline.failedJob.name })
        : headline.stage?.name ?? '');
      const counts = headline.progress;
      setText(progress, counts && counts.total > 0 ? t('progressLabel', { done: counts.done, total: counts.total }) : '');
      setAttr(progress, 'title', counts && counts.total > 0 ? t('progressTitle', { done: counts.done, total: counts.total }) : null);
      // Stages not read yet: the pipeline's own status stands in for them.
      const marks = headline.stages.length > 0 ? headline.stages : [{ name: '-', status: headline.status }];
      patchList(dots, marks, {
        key: (stage) => stage.name,
        create: () => {
          const dot = h('span', { class: 'betterslack-gitlab-dot' });
          dot.__glyph = icon(h, '');
          dot.append(dot.__glyph);
          return dot;
        },
        update: (dot, stage) => {
          if (dot.dataset.status !== stage.status) {
            dot.dataset.status = stage.status;
            dot.__glyph.innerHTML = iconOf(stage.status);
          }
          setAttr(dot, 'data-tone', toneOf(stage.status));
          setAttr(dot, 'data-kind', kindOf(stage.status));
        },
      });
      setText(stale, model.stale ? '•' : '');
      setAttr(stale, 'title', model.stale ? t('barStale') : null);
      setAttr(button, 'aria-label', [
        t('barLabel', { project: headline.projectName, iid: headline.mr.iid, status: t(labelKey(headline.status)) }),
        counts && counts.total > 0 ? t('progressTitle', { done: counts.done, total: counts.total }) : '',
        model.stale ? t('barStale') : '',
      ].filter(Boolean).join(' · '));
      fit();
      watch();
    },

    setExpanded(open) {
      setAttr(button, 'aria-expanded', open ? 'true' : 'false');
    },
  };
}
