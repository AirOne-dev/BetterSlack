// The latest pipelines, in a popover under the top bar.
//
//   Vision · !1658
//   Pipeline #298850
//   ◜ Running · 7/12
//   ✓ checks  ◜ build  ○ deploy
//   ─────────────────────────
//   Portals Builder · !1723 …
//   ─────────────────────────
//   See more
//
// The newest pipeline of each of the three branches most recently worked on --
// one per branch, not three of the one somebody pushed to three times. "See
// more" opens the view in the rail, which is where the rest is.

import { iconOf, kindOf, labelKey, toneOf } from '../lib/status.js';
import { icon, link } from './dom.js';

const EXTERNAL =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5M12 9v3.5a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1H7" '
  + 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function createRecent({ api, t, layer, getModel, onSeeMore, onStage }) {
  const { h } = api.dom;

  const signature = () => {
    const model = getModel();
    if (model.phase !== 'ready') return model.phase;
    return `${model.stale}|${model.recent.map((view) => [
      view.pipeline.id, view.status, view.pipeline.updatedAt, view.hydrated, view.mr.title,
      view.stages.map((stage) => stage.status).join(','), view.progress?.done, view.progress?.total,
    ].join(':')).join('|')}`;
  };

  /** A button that opens a page on GitLab: a link wearing Slack's own button, with the way out drawn on it. */
  const action = (href, label, aria) => link(h, {
    href,
    className: 'c-button c-button--outline c-button--small betterslack-gitlab-action',
    label: aria,
    children: [icon(h, EXTERNAL, 'betterslack-gitlab-action__icon'), h('span', {}, [label])],
  });

  const entry = (view) => {
    const word = t(labelKey(view.status));
    const progress = view.progress && view.progress.total > 0
      ? ` · ${t('progressLabel', { done: view.progress.done, total: view.progress.total })}` : '';
    const stages = view.stages.map((stage) => {
      const chip = h('button', {
        type: 'button',
        class: 'betterslack-gitlab-recent__stage',
        'data-tone': toneOf(stage.status),
        'data-kind': kindOf(stage.status),
        'aria-label': t('stageLabel', { stage: stage.name, status: t(labelKey(stage.status)) }),
      }, [icon(h, iconOf(stage.status)), h('span', {}, [stage.name])]);
      // The jobs of a stage are one click away from here too.
      chip.addEventListener('click', () => onStage(chip, view.pipeline.id, stage.name));
      return chip;
    });
    return h('article', { class: 'betterslack-gitlab-recent__entry' }, [
      h('div', { class: 'betterslack-gitlab-recent__title' }, [`${view.projectName} · !${view.mr.iid}`]),
      h('div', { class: 'betterslack-gitlab-recent__mrtitle', title: view.mr.title }, [view.mr.title]),
      ...(view.mr.sourceBranch ? [h('div', { class: 'betterslack-gitlab-recent__branch' }, [view.mr.sourceBranch])] : []),
      h('div', { class: 'betterslack-gitlab-recent__status', 'data-tone': toneOf(view.status), 'data-kind': kindOf(view.status) }, [
        icon(h, iconOf(view.status)),
        h('span', {}, [`${word}${progress}`]),
        h('span', { class: 'betterslack-gitlab-recent__number' }, [`#${view.pipeline.id}`]),
      ]),
      ...(view.failedJob ? [h('div', { class: 'betterslack-gitlab-recent__failed' }, [t('barFailed', { job: view.failedJob.name })])] : []),
      ...(stages.length > 0 ? [h('div', { class: 'betterslack-gitlab-recent__stages' }, stages)] : []),
      h('div', { class: 'betterslack-gitlab-recent__actions' }, [
        action(view.mr.webUrl, t('actionMr'), t('openMr', { iid: view.mr.iid })),
        action(view.pipeline.webUrl, t('actionPipeline'), t('openPipeline', { id: view.pipeline.id })),
      ]),
    ]);
  };

  const render = () => {
    const model = getModel();
    const nodes = [h('h2', { class: 'betterslack-gitlab-popover__title betterslack-gitlab-popover__title--lone' }, [t('recentTitle')])];
    if (model.phase !== 'ready' || model.recent.length === 0) {
      nodes.push(h('p', { class: 'betterslack-gitlab-popover__empty' }, [t('recentEmpty')]));
    } else {
      model.recent.forEach((view, index) => {
        if (index > 0) nodes.push(h('hr', { class: 'betterslack-gitlab-popover__rule' }));
        nodes.push(entry(view));
      });
    }
    const more = h('button', { type: 'button', class: 'c-button c-button--outline c-button--small betterslack-gitlab-recent__more',
      'data-action': 'see-more' }, [t('seeMore')]);
    more.addEventListener('click', () => { layer.close(); onSeeMore(); });
    nodes.push(h('hr', { class: 'betterslack-gitlab-popover__rule' }), more);
    return nodes;
  };

  return {
    toggle(anchor, onClose) {
      layer.toggle({ anchor, label: t('recentTitle'), className: 'betterslack-gitlab-recentpopover', signature, render, onClose });
    },
  };
}
