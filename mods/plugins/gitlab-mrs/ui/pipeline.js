// A pipeline as a row of its stages -- the picture GitLab draws, in Slack's
// own colours -- with the pipeline's number and how far it is.
//
//   (✓ #298850)  ✓ ── ✓ ── ◜ ── ○     7/12
//
// Each stage is a button: a click opens its jobs. Built once per merge request
// and then only patched, so a job finishing changes one icon and nothing else.

import { iconOf, kindOf, labelKey, toneOf } from '../lib/status.js';
import { icon, patchList, setAttr, setText, show } from './dom.js';

export function createPipelineStrip({ api, t, onStage }) {
  const { h } = api.dom;

  const chip = h('a', { class: 'betterslack-gitlab-chip', target: '_blank', rel: 'noopener noreferrer' });
  const chipIcon = icon(h, '');
  const chipNumber = h('span', { class: 'betterslack-gitlab-chip__number' });
  chip.append(chipIcon, chipNumber);

  const stages = h('div', { class: 'betterslack-gitlab-stages', role: 'group' });
  const progress = h('span', { class: 'betterslack-gitlab-progress' });
  const note = h('span', { class: 'betterslack-gitlab-note' });
  const root = h('div', { class: 'betterslack-gitlab-pipeline' }, [chip, stages, progress, note]);

  const createStage = () => {
    const button = h('button', { type: 'button', class: 'betterslack-gitlab-stage' });
    const glyph = icon(h, '');
    button.append(glyph);
    button.__glyph = glyph;
    button.addEventListener('click', () => onStage(button, Number(button.dataset.pipeline), button.dataset.stage));
    return button;
  };

  const updateStage = (button, { stage, pipelineId }) => {
    button.dataset.pipeline = String(pipelineId);
    if (button.dataset.stage !== stage.name) {
      button.dataset.stage = stage.name;
      // The tooltip is the stage's name, which does not change under a button
      // that is keyed by it.
      button.__dispose?.();
      button.__dispose = api.helpers.tooltip(button, stage.name);
    }
    if (button.dataset.status !== stage.status) {
      button.dataset.status = stage.status;
      button.__glyph.innerHTML = iconOf(stage.status);
    }
    setAttr(button, 'data-tone', toneOf(stage.status));
    setAttr(button, 'data-kind', kindOf(stage.status));
    setAttr(button, 'aria-label', t('stageLabel', { stage: stage.name, status: t(labelKey(stage.status)) }));
  };

  return {
    element: root,

    /**
     * @param {object | null} view  `describePipeline`'s answer, or null when the
     *                              merge request has no pipeline
     * @param {string | null} error why its pipelines could not be read, if they could not
     */
    update(view, error = null) {
      if (!view) {
        show(chip, false);
        show(stages, false);
        show(progress, false);
        setText(note, error ? t(`error_${error}`) : t('noPipeline'));
        setAttr(note, 'data-tone', error ? 'warning' : 'muted');
        show(note, true);
        return;
      }
      show(chip, true);
      const word = t(labelKey(view.status));
      if (chipIcon.dataset.status !== view.status) {
        chipIcon.dataset.status = view.status;
        chipIcon.innerHTML = iconOf(view.status);
      }
      setText(chipNumber, `#${view.pipeline.id}`);
      setAttr(chip, 'data-tone', toneOf(view.status));
      setAttr(chip, 'data-kind', kindOf(view.status));
      setAttr(chip, 'aria-label', `${t('openPipeline', { id: view.pipeline.id })} · ${word}`);
      setAttr(chip, 'href', view.pipeline.webUrl);
      chip.toggleAttribute('data-inert', !view.pipeline.webUrl);

      show(stages, view.stages.length > 0);
      patchList(stages, view.stages.map((stage) => ({ stage, pipelineId: view.pipeline.id })), {
        key: ({ stage }) => stage.name,
        create: createStage,
        update: updateStage,
      });

      if (view.progress && view.progress.total > 0) {
        const extra = view.progress.manual > 0 ? ` · ${t('progressManual', { count: view.progress.manual })}` : '';
        setText(progress, `${t('progressLabel', { done: view.progress.done, total: view.progress.total })}${extra}`);
        setAttr(progress, 'title', t('progressTitle', { done: view.progress.done, total: view.progress.total }));
        show(progress, true);
      } else {
        show(progress, false);
      }

      // Stages not here yet: the pipeline's own status stands in for them.
      setText(note, view.hydrated ? '' : t('pipelineLoading'));
      setAttr(note, 'data-tone', 'muted');
      show(note, !view.hydrated);
    },

    dispose() {
      for (const child of stages.children) child.__dispose?.();
    },
  };
}
