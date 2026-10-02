// One merge request: its title, its number, where it is going, and its pipeline.
//
// Four things in a grid, laid out by how wide the view is (gitlab.css): the title,
// where it is going, its pipeline and its number -- on one line when there is
// room for that, on two, or stacked.
//
// Built once and patched, keyed by the merge request's id, so a pipeline
// moving on is one icon changing in one row. Every address is the `web_url`
// GitLab sent, never one put together here.

import { setAttr, setText, show } from './dom.js';
import { createPipelineStrip } from './pipeline.js';

export function createMergeRequestRow({ api, t, format, onStage }) {
  const { h } = api.dom;

  const title = h('a', { class: 'betterslack-gitlab-mr__title', target: '_blank', rel: 'noopener noreferrer' });
  const draft = h('span', { class: 'betterslack-gitlab-mr__draft' }, [t('draft')]);
  const number = h('a', { class: 'betterslack-gitlab-mr__number', target: '_blank', rel: 'noopener noreferrer' });
  const branches = h('span', { class: 'betterslack-gitlab-mr__branches' });
  const updated = h('span', { class: 'betterslack-gitlab-mr__updated' });
  const strip = createPipelineStrip({ api, t, onStage });

  const row = h('li', { class: 'betterslack-gitlab-mr' }, [
    h('div', { class: 'betterslack-gitlab-mr__line' }, [title, draft]),
    h('div', { class: 'betterslack-gitlab-mr__meta' }, [branches, updated]),
    strip.element,
    number,
  ]);
  row.__dispose = () => strip.dispose();

  /** A merge request with no address of its own links to nothing. */
  const setHref = (node, href) => {
    setAttr(node, 'href', href);
    node.toggleAttribute('data-inert', !href);
  };

  return {
    element: row,
    /** @param {{ mr: object, pipeline: object | null, error: string | null }} item */
    update({ mr, pipeline, error }) {
      setText(title, mr.title);
      setHref(title, mr.webUrl);
      setAttr(title, 'aria-label', t('openMr', { iid: mr.iid }));
      setText(number, `!${mr.iid}`);
      setHref(number, mr.webUrl);
      show(draft, mr.draft);
      setText(branches, mr.targetBranch ? t('branches', { source: mr.sourceBranch, target: mr.targetBranch }) : mr.sourceBranch);
      setText(updated, format.ago(mr.updatedAt));
      setAttr(updated, 'title', mr.updatedAt ? new Date(mr.updatedAt).toLocaleString() : null);
      strip.update(pipeline, error);
    },
  };
}
