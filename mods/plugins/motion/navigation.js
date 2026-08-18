// Knowing when the view changed, and making an animation run again.
//
// Everything else in this mod is CSS, because dialogs, menus and hover states
// are mounted at the moment they should animate. Switching channel is the one
// thing that is not: the URL changes, the message pane repaints in place, and
// nothing remounts. So it is watched here and stamped by hand.

/**
 * What counts as "a different view": the team and conversation, and nothing
 * after them.
 *
 * Slack keeps more than that in the path -- opening a thread appends to it --
 * and a thread opening beside the conversation is not the conversation being
 * replaced. Animating it would dip the whole column for something that did not
 * change.
 */
export function viewKey() {
  const conversation = location.pathname.match(/^\/client\/[^/]+\/[^/]+/);
  return conversation ? conversation[0] : location.pathname;
}

/**
 * Call `handler` when the client moves to another conversation, as early as it
 * can possibly be known.
 *
 * This is timed rather than assumed, and the timings are the reason the mod is
 * written this way. Clicking a channel in Slack 4.51, measured from the click:
 *
 *   +9ms    navigation.currententrychange   (and history.pushState, same tick)
 *   +50ms   the conversation column starts repainting
 *   +291ms  it stops
 *   +286ms  a 250ms poll comparing location.pathname notices
 *
 * The first version polled, so the entrance animation began *after* Slack had
 * finished painting the new conversation: the content appeared instantly and
 * then faded in from nothing, which reads as a blink and was reported as one.
 * The Navigation API fires 40ms before the first pixel changes, which is early
 * enough to cover the swap instead of arriving after it -- and it is a standard
 * event, so nothing of Slack's has to be patched to get it.
 *
 * The poll stays as the fallback for a client without the API. It is worse,
 * and it is better than nothing.
 */
export function onViewChange(api, handler, everyMs = 250) {
  let last = viewKey();
  const fire = () => {
    const now = viewKey();
    if (now === last) return;
    last = now;
    handler(now);
  };

  const nav = typeof window === 'undefined' ? null : window.navigation;
  if (typeof nav?.addEventListener === 'function') {
    // Fires for pushState and replaceState alike; `viewKey` is what decides
    // whether either of them actually changed the view.
    nav.addEventListener('currententrychange', fire);
    const off = () => nav.removeEventListener('currententrychange', fire);
    api.onDispose(off);
    return off;
  }

  return api.helpers.poll(fire, everyMs);
}

/**
 * Put a class back on an element so its animation runs a second time.
 *
 * Removing and re-adding in the same task is coalesced by the browser into no
 * change at all, and the animation does not restart -- which shows up as every
 * channel switch after the first one being instant. Reading a layout property
 * in between forces the style to be flushed, so the two writes are seen as two
 * changes. It is the standard trick and it is load-bearing here.
 */
export function restartAnimation(element, className) {
  if (!element) return null;
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);

  // Taken off again at the end so nothing is left wearing a class it is not
  // using, and so a plugin switched off mid-animation leaves a clean DOM.
  const done = () => element.classList.remove(className);
  element.addEventListener('animationend', done, { once: true });
  element.addEventListener('animationcancel', done, { once: true });
  return () => {
    element.removeEventListener('animationend', done);
    element.removeEventListener('animationcancel', done);
    element.classList.remove(className);
  };
}
