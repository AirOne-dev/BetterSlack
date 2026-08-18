// Code Highlight — colour the ``` blocks in messages, and work out what they
// are on the way.
//
// Slack sends a code block as grey text and gives the sender no way to say what
// it contains: there is no language selector in the composer, and nothing in
// the markup to read. So the language is guessed from the code itself
// (detect.js) and the code is coloured by a small lexer (tokenise.js), both
// written here because Slack's CSP has no 'unsafe-eval' and every highlighter
// that compiles its grammars at runtime needs it.
//
// The one thing worth being careful about is the DOM. A message belongs to
// React, and replacing the children of a node React is managing earns a
// "removeChild on a node that is not a child" the next time that message
// updates -- which, in a virtualised list that re-renders on every arriving
// message, is soon. So nothing is removed: the highlighted copy is *appended*,
// and the original children are hidden by a stylesheet. If React discards our
// node we lose a colour and gain nothing worse, and `each` puts it back when
// the block next mounts.

import { STRINGS } from './strings.js';
import { detect } from './detect.js';
import { highlight } from './tokenise.js';

const BLOCK = 'pre.c-mrkdwn__pre';
const MARK = 'data-betterslack-lang';
const CLASS = 'betterslack-hl';

/**
 * Slack linkifies URLs inside code blocks, so a block's text is not always its
 * textContent -- but it is close enough, and textContent is what someone
 * copying the block would get anyway.
 */
function codeOf(pre) {
  return pre.textContent ?? '';
}

export default {
  /**
   * @param {import('../../../src/runtime/api.js').PluginApi} api
   */
  start(api) {
    const t = api.i18n.strings(STRINGS);
    api.css(api.assets.text('highlight.css'));

    const paint = (pre) => {
      if (pre.hasAttribute(MARK)) return false;
      const code = codeOf(pre);
      const language = detect(code);
      // Null is a real answer: a stack trace, a table of numbers or a
      // paragraph is not code, and painting keywords through it looks like a
      // bug rather than a limitation.
      if (!language) return false;

      const node = api.dom.h('code', { class: CLASS });
      node.innerHTML = highlight(code, language);
      pre.append(node);
      pre.setAttribute(MARK, language);
      return true;
    };

    api.helpers.each(BLOCK, (pre) => {
      try {
        paint(pre);
      } catch (err) {
        // One unlucky block must not take the observer down with it.
        api.log.warn('could not colour a code block', err);
      }
    });

    api.onDispose(() => {
      for (const pre of document.querySelectorAll(`[${MARK}]`)) {
        pre.removeAttribute(MARK);
        // Ours to remove -- we made it. Slack's own children were only ever
        // hidden, and the stylesheet doing that goes with the plugin.
        for (const node of pre.querySelectorAll(`.${CLASS}`)) node.remove();
      }
    });

    api.commands.add({
      id: 'repaint',
      title: t('command'),
      subtitle: t('commandSubtitle'),
      run: () => {
        let count = 0;
        for (const pre of document.querySelectorAll(BLOCK)) {
          pre.removeAttribute(MARK);
          for (const node of pre.querySelectorAll(`.${CLASS}`)) node.remove();
          if (paint(pre)) count += 1;
        }
        api.ui.toast(t('done', { count }), { variant: 'success' });
      },
    });
  },

  stop() {},
};
