// Full Links — keep a long link whole, in what you read and in what you send.
//
// Slack shortens a long URL in a message to its host and an ellipsis and keeps
// the link itself intact underneath. That is fine when a URL is noise and
// infuriating when it is the message -- a signed link, a query somebody wants
// to read, an id worth copying by eye.
//
// It marks them itself, which makes this mod short and exact rather than
// clever. Measured on a real message:
//
//   <a class="c-link c-link--underline"
//      data-stringify-link="http://imgr.prelinker.com/t/?c=31cd2a73-…"
//      data-truncated-link="true"
//      href="http://imgr.prelinker.com/t/?c=31cd2a73-…">imgr.prelinker.com/t?c=…</a>
//
// So there is no guessing at which labels are Slack's and which are somebody's
// own words: `data-truncated-link` says. `<https://example.com|read this>` has
// no such attribute and is left alone, which a heuristic on ellipses would
// eventually have got wrong.
//
// `data-stringify-link` is the full address, and it is the one to trust: it is
// what Slack itself puts on the clipboard when the message is copied.
//
// And the shortening is *stored*, not drawn -- which is why the second half of
// this mod exists. Read back from the API, the message on the wire is:
//
//   text:  <http://imgr.prelinker.com/t/?c=31cd2a73-…|imgr.prelinker.com/t?c=…>
//   block: { type: 'link', url: '…', text: 'imgr.prelinker.com/t?c=…', truncated: true }
//
// So everybody receives the short label, mod or no mod, and no amount of
// repainting the message list changes what the other person sees. The label is
// made when the link is pasted: the composer replaces it with a <ts-slug>
// carrying `data-label="imgr.prelinker.com/t?c=999…"`. Intercepting the paste
// and inserting the address as plain text stops the slug being made at all --
// measured, and the composer then holds an ordinary link whose text is the
// whole URL, still there three seconds later.
//
// The other thing measured, and worth writing down because it saved a file:
// the shortening is not CSS. On that anchor `text-overflow` is `clip`,
// `overflow` is `visible` and `max-width` is `none`. Nothing needs
// un-clipping; the label really is a different string.

import { STRINGS } from './strings.js';

const TRUNCATED = 'a[data-truncated-link="true"]';

/** The address Slack kept, preferring the one it copies to the clipboard. */
export function fullUrl(anchor) {
  return anchor.getAttribute('data-stringify-link')
    || anchor.getAttribute('href')
    || '';
}

/** The deepest text node, which is where the label lives however it is wrapped. */
export function labelNode(element) {
  let node = element;
  while (node && node.nodeType !== 3) {
    const next = [...node.childNodes].find((child) => (child.textContent ?? '').trim());
    if (!next) return null;
    node = next;
  }
  return node;
}

export default {
  /**
   * @param {import('../../../src/runtime/api.js').PluginApi} api
   */
  start(api) {
    const t = api.i18n.strings(STRINGS);
    // The composer, from the API rather than written out here: Slack's own
    // names churn, and a copy in a mod is a copy nobody updates when they do.
    const COMPOSER = api.slack.selectors.composer;
    api.css(api.assets.text('full-links.css'));

    const restore = (anchor) => {
      const url = fullUrl(anchor);
      if (!url) return false;
      const node = labelNode(anchor);
      if (!node || node.nodeValue === url) return false;

      /*
       * The value of a node that already exists, and nothing else.
       *
       * Adding or removing children of a node React is managing is what earns
       * a "removeChild on a node that is not a child" at its next re-render.
       * A changed string is something React will simply overwrite if it
       * disagrees -- and the sweep below puts it back.
       */
      node.nodeValue = url;
      return true;
    };

    const sweep = () => {
      let count = 0;
      for (const anchor of document.querySelectorAll(TRUNCATED)) {
        try {
          if (restore(anchor)) count += 1;
        } catch (err) {
          api.log.warn('could not restore a link', err);
        }
      }
      return count;
    };

    /*
     * The other half: stop one being made in the first place.
     *
     * Capture phase, so this runs before Slack's own handler, and only for a
     * clipboard holding exactly one bare URL -- pasting a paragraph, an image
     * or formatted text is left entirely alone. `execCommand('insertText')` is
     * what Quill picks up; a synthetic paste event would be ignored, which is
     * already written down in the composer helper for the same reason.
     */
    const onPaste = (event) => {
      const target = event.target;
      if (!target?.closest?.(COMPOSER)) return;
      const text = (event.clipboardData?.getData('text/plain') ?? '').trim();
      if (!/^https?:\/\/\S+$/i.test(text)) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      document.execCommand('insertText', false, text);
    };
    document.addEventListener('paste', onPaste, true);
    api.onDispose(() => document.removeEventListener('paste', onPaste, true));

    api.helpers.each(TRUNCATED, (anchor) => {
      try {
        restore(anchor);
      } catch (err) {
        api.log.warn('could not restore a link', err);
      }
    });

    /*
     * A second pass on a slow interval.
     *
     * `each` fires when a link first appears, which is most of them. The rest
     * are the ones Slack re-labels after the fact -- a message edited in place,
     * a re-render that puts the short form back -- and those are invisible to
     * an arrival observer because the node never left. A handful of
     * querySelector results compared against an attribute, every three seconds,
     * and stopped entirely while the window is hidden.
     */
    api.helpers.poll(sweep, 3000);

    api.commands.add({
      id: 'restore',
      title: t('command'),
      subtitle: t('commandSubtitle'),
      run: () => api.ui.toast(t('done', { count: sweep() }), { variant: 'success' }),
    });
  },

  stop() {},
};
