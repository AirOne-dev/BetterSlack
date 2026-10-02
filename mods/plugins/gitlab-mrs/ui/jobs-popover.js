// The jobs of one stage, in a popover under the stage that was clicked.
//
//   checks
//   ✓ Code Quality: [eslint]        43s
//   ✓ Translations                  12s
//   ▶ Deploy                        Waiting for you
//
// Every job is a link to its GitLab page. It follows the store while it is
// open -- a job can finish under somebody's eyes -- through the layer's
// signature check, so nothing repaints unless something changed.

import { iconOf, kindOf, labelKey, toneOf } from '../lib/status.js';
import { effectiveStatus } from '../lib/stages.js';
import { icon, link } from './dom.js';

export function createJobsPopover({ api, t, format, layer, pipelineOf }) {
  const { h } = api.dom;

  const stageIn = (view, name) => view?.stages.find((stage) => stage.name === name) ?? null;

  const signature = (pipelineId, name) => () => {
    const stage = stageIn(pipelineOf(pipelineId), name);
    return stage ? stage.jobs.map((job) => `${job.id}:${job.status}:${job.duration ?? ''}`).join('|') : 'gone';
  };

  const row = (job) => {
    const status = effectiveStatus(job);
    const kind = kindOf(status);
    const word = t(labelKey(status));
    // How long it took when it ran; what it is waiting for when it did not.
    const meta = job.status === 'success' && job.duration !== null ? format.duration(job.duration)
      : kind === 'success' ? '' : word;
    const body = [
      icon(h, iconOf(status), 'betterslack-gitlab-job__icon'),
      h('span', { class: 'betterslack-gitlab-job__name' }, [job.name]),
      h('span', { class: 'betterslack-gitlab-job__meta' }, [meta]),
    ];
    const node = link(h, {
      href: job.webUrl,
      className: 'betterslack-gitlab-job',
      label: `${t('openJob', { name: job.name })} · ${word}`,
      children: body,
    });
    node.dataset.tone = toneOf(status);
    node.dataset.kind = kind;
    if (kind === 'manual') node.title = t('jobsManual');
    return node;
  };

  const render = (pipelineId, name) => () => {
    const view = pipelineOf(pipelineId);
    const stage = stageIn(view, name);
    if (!view || !stage) return [h('p', { class: 'betterslack-gitlab-popover__empty' }, [t('jobsEmpty')])];
    const head = h('header', { class: 'betterslack-gitlab-popover__head' }, [
      icon(h, iconOf(stage.status), 'betterslack-gitlab-popover__icon'),
      h('h2', { class: 'betterslack-gitlab-popover__title' }, [stage.name]),
      link(h, {
        href: view.pipeline.webUrl,
        className: 'betterslack-gitlab-popover__link',
        label: t('openPipeline', { id: view.pipeline.id }),
        children: [`#${view.pipeline.id}`],
      }),
    ]);
    head.dataset.tone = toneOf(stage.status);
    const list = h('div', { class: 'betterslack-gitlab-jobs' }, stage.jobs.map(row));
    return [head, list];
  };

  return {
    open(anchor, pipelineId, name) {
      layer.toggle({
        anchor,
        label: name,
        className: 'betterslack-gitlab-jobspopover',
        signature: signature(pipelineId, name),
        render: render(pipelineId, name),
      });
    },
  };
}
