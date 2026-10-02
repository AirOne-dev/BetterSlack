// The one popover this plugin has, shared by the view and the top bar.
//
// One at a time, so opening the top bar's list closes a stage's jobs and the
// other way round. Light DOM, painted with the tokens Slack's own menus are
// painted with (see gitlab.css), so it follows every theme. Not `api.ui.kit`:
// the kit is for a window a mod opens, where there is no stylesheet at all.
//
// It is refreshed in place while it is open, because a job can finish under
// somebody's eyes. `signature()` says whether anything changed; when it did not
// the content is left alone, so a poll that found nothing new repaints nothing
// and the pointer is never moved from under a button.

export const LAYER_ID = 'betterslack-gitlab-layer';

export function createLayer({ api }) {
  const { h } = api.dom;
  let layer = null;
  let panel = null;
  let anchor = null;
  /** Where the anchor was when the popover opened, for when the anchor has since left the page. */
  let anchorRect = null;
  let options = null;
  let signature = null;
  let arming;

  const place = () => {
    if (!layer) return;
    const view = layer.ownerDocument.defaultView ?? window;
    const width = layer.offsetWidth || 340;
    const rect = anchor?.isConnected ? anchor.getBoundingClientRect() : anchorRect;
    const left = Math.max(8, Math.min(rect ? rect.left : (view.innerWidth - width) / 2, view.innerWidth - width - 8));
    let top = rect ? rect.bottom + 6 : 48;
    // Under the anchor, unless there is more room above it.
    if (rect && top + 200 > view.innerHeight && rect.top > view.innerHeight - rect.bottom) {
      top = Math.max(8, rect.top - (layer.offsetHeight || 200) - 6);
    }
    layer.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
    panel.style.maxHeight = `${Math.max(160, view.innerHeight - top - 12)}px`;
  };

  const onDown = (event) => {
    if (!layer || layer.contains(event.target) || anchor?.contains(event.target)) return;
    close();
  };
  const onKey = (event) => {
    if (event.key !== 'Escape' || !layer) return;
    event.stopPropagation();
    const was = anchor;
    close();
    was?.focus?.();
  };

  function close() {
    if (!layer) return;
    clearTimeout(arming);
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', place);
    layer.remove();
    const done = options?.onClose;
    layer = null;
    panel = null;
    anchor = null;
    anchorRect = null;
    options = null;
    signature = null;
    done?.();
  }

  /** Draw again, only if what it would say is not what it says. */
  function refresh() {
    if (!layer || !options) return;
    const next = options.signature();
    if (next === signature) return;
    signature = next;
    const focused = document.activeElement?.closest?.(`#${LAYER_ID}`)
      ? document.activeElement.getAttribute('data-action')
      : null;
    panel.replaceChildren(...options.render());
    if (focused) panel.querySelector(`[data-action="${focused}"]`)?.focus();
    place();
  }

  /**
   * @param {{ anchor: HTMLElement, label: string, signature: () => string,
   *           render: () => Node[], onClose?: () => void, className?: string }} opts
   */
  function open(opts) {
    // Read before the previous popover goes: the anchor may be a control inside it,
    // which goes with it, and the new one still belongs under where it was.
    const rect = opts.anchor?.isConnected ? opts.anchor.getBoundingClientRect() : null;
    close();
    anchorRect = rect;
    anchor = opts.anchor;
    options = opts;
    panel = h('div', {
      class: `betterslack-gitlab-popover ${opts.className ?? ''}`.trim(),
      role: 'dialog',
      'aria-label': opts.label,
      tabindex: '-1',
    });
    layer = h('div', { id: LAYER_ID, class: 'betterslack-gitlab-layer' }, [panel]);
    document.body.append(layer);
    refresh();
    panel.focus();
    window.addEventListener('resize', place);
    // Next tick: the click that opened this is still travelling.
    arming = setTimeout(() => {
      document.addEventListener('mousedown', onDown, true);
      document.addEventListener('keydown', onKey, true);
    }, 0);
    return { close };
  }

  api.onDispose(close);

  return {
    open,
    close,
    refresh,
    isOpen: () => layer !== null,
    anchorIs: (node) => anchor === node,
    /** Open, or close if it is already open on this same anchor. */
    toggle(opts) {
      if (layer && anchor === opts.anchor) close();
      else open(opts);
    },
  };
}
