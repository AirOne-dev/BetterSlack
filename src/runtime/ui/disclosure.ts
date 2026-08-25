/**
 * A thing that opens and closes, attached to an element somebody else owns.
 *
 * Slack marks an edited message with "(edited)" and a channel with a member
 * count; both are exactly where a reader would ask for more, and neither
 * answers. A mod with the answer wants to make that label the way in -- and
 * doing it by hand is four problems, every one of which was got wrong first:
 *
 * - **The element belongs to Slack, and Slack replaces it.** A listener bound
 *   to the node works exactly once: putting anything into the message makes
 *   React rebuild that subtree, so the node the second click lands on is not
 *   the node the listener was on. It looks intermittent rather than broken.
 *   So the click is delegated from the document and matched by selector, and
 *   nothing is ever remembered *on* the element.
 * - **What it opens gets torn out too**, by the same re-render, so it has to be
 *   put back rather than left to vanish under somebody who opened it.
 * - **Which thing is open has to survive that**, which means an identity that
 *   is not the node -- a key the caller derives from what the element is about.
 * - **It has to be dressed from a sweep, never from an observer.** This is the
 *   list Slack re-renders most, and an observer that reacts to Slack's own
 *   re-render by putting a node back into that list is the shape that has
 *   frozen this renderer twice.
 *
 * The caret is drawn with borders rather than typed as a glyph: a character
 * sits wherever its font puts it in the em box, which is never the middle, so
 * rotating one turns it about a point that is not its own centre and it lands
 * off to one side. Three borders make a triangle that fills its box exactly.
 *
 * **Nothing here animates.** The classes are stable so that Motion can, which
 * is the whole arrangement: installing a mod called Motion is a statement of
 * intent about animation, and a component that moves whether or not you asked
 * takes that decision away.
 */

import type { Cleanup } from '../dom.js';

/** The classes a disclosure wears. Motion styles these; so may a theme. */
export const DISCLOSURE_CLASS = {
  /** On the element that opens it. */
  trigger: 'betterslack-disclosure',
  /** On the wrapper holding what it opened. */
  panel: 'betterslack-disclosure__panel',
  /** Inside the wrapper. The pair is what makes an unfold animatable. */
  inner: 'betterslack-disclosure__inner',
  /**
   * On the wrapper between being closed and being gone.
   *
   * Closing has to be a state rather than a removal, or there is nothing left
   * on screen to animate. Nothing here decides how long that lasts: the panel
   * is asked what its own stylesheet says, and with no animation on it the
   * answer is zero and it goes at once -- a client without Motion must not
   * wait for something that is not happening.
   */
  closing: 'betterslack-disclosure__panel--closing',
};

/** A backstop, in case a browser never fires the end of an animation. */
const CLOSE_GRACE_MS = 80;

/** The longest of whatever the stylesheet put on it, in milliseconds. */
function animatedFor(element: Element): number {
  const style = getComputedStyle(element);
  const times = `${style.animationDuration},${style.transitionDuration}`
    .split(',')
    .map((part) => {
      const value = part.trim();
      if (value.endsWith('ms')) return Number.parseFloat(value);
      if (value.endsWith('s')) return Number.parseFloat(value) * 1000;
      return 0;
    })
    .filter((value) => Number.isFinite(value));
  return times.length ? Math.max(...times) : 0;
}

export interface DisclosureOptions {
  /**
   * The elements that open it, as a selector.
   *
   * A selector rather than an element: the one on screen now is not the one
   * that will be there after Slack's next render, and matching by selector is
   * what makes that a non-event.
   */
  trigger: string;
  /**
   * What this trigger is about, and null for one that opens nothing.
   *
   * The identity that survives the element being replaced. Returning null is
   * how a trigger says it has nothing to show -- Slack marks every edited
   * message, including ones a mod knows nothing about, and a control that
   * opens an empty panel is worse than a label that never looked like one.
   */
  keyFor(trigger: Element): string | null;
  /** What to show. Built on opening, and again whenever it has to be put back. */
  content(trigger: Element, key: string): Node | null;
  /**
   * Where it goes, which defaults to straight after the trigger.
   *
   * A message's wordings belong under the message rather than under the word
   * "(edited)" in the middle of it, so a caller says so.
   */
  anchor?(trigger: Element, key: string): Element | null;
  /** Tooltip and accessible name for the trigger. */
  label?: string;
  onToggle?(open: boolean, key: string): void;
}

export interface DisclosureHandle extends Cleanup {
  /** Dress whatever is on screen now, and put back any panel that was torn out. */
  refresh(): void;
  /**
   * Build the content of every open panel again.
   *
   * For when what it shows has changed under somebody looking at it -- a
   * message edited a second time while its earlier wordings are unfolded.
   * `refresh` deliberately leaves a panel that is still on screen alone, since
   * rebuilding one on every sweep would restart its animation.
   */
  rebuild(): void;
  isOpen(key: string): boolean;
  close(key: string): void;
  /** Close every one of them, without touching what the caller remembers. */
  closeAll(): void;
}

export function createDisclosure(options: DisclosureOptions): DisclosureHandle {
  /** Which keys are open. Not which nodes: nodes do not last. */
  const open = new Set<string>();
  /** The panels on screen, so one can be taken back or put back. */
  const panels = new Map<string, HTMLElement>();

  const hit = (target: EventTarget | null): { element: Element; key: string } | null => {
    // Duck-typed: the target of a keydown can be the document itself.
    const from = target as { closest?: (selector: string) => Element | null } | null;
    const element = typeof from?.closest === 'function' ? from.closest(options.trigger) : null;
    if (!element) return null;
    /*
     * Asked of the caller, never of the class this put on the element.
     *
     * The class is styling and a sweep applies it, so a trigger Slack has just
     * rebuilt is one the sweep has not reached -- and requiring the class
     * would make a click do nothing until it had, which is the same
     * intermittency delegating the listener is here to end.
     */
    const key = options.keyFor(element);
    return key ? { element, key } : null;
  };

  /**
   * Panels on their way out, still on screen while they fold away.
   *
   * Kept as `mine` for the sweep below, or the next refresh would tear one out
   * mid-animation -- which is the snap this exists to remove.
   */
  const closing = new Map<HTMLElement, () => void>();

  const takeAway = (panel: HTMLElement): void => {
    closing.get(panel)?.();
    closing.delete(panel);
    panel.remove();
  };

  const fold = (key: string, now = false): void => {
    const panel = panels.get(key);
    panels.delete(key);
    if (!panel) return;
    if (now || !panel.isConnected) { takeAway(panel); return; }

    /*
     * Closed, then gone -- and the stylesheet says how long that takes.
     *
     * Removing it outright leaves nothing on screen to animate, which is why
     * opening moved and closing snapped. The class is what a stylesheet keys
     * the fold on, and the panel is then asked what it is actually running:
     * zero means nothing is, and it goes in the same breath.
     */
    panel.classList.add(DISCLOSURE_CLASS.closing);
    const ms = animatedFor(panel);
    if (ms <= 0) { takeAway(panel); return; }

    const done = () => takeAway(panel);
    panel.addEventListener('animationend', done, { once: true });
    panel.addEventListener('transitionend', done, { once: true });
    const timer = setTimeout(done, ms + CLOSE_GRACE_MS);
    closing.set(panel, () => {
      clearTimeout(timer);
      panel.removeEventListener('animationend', done);
      panel.removeEventListener('transitionend', done);
    });
  };

  const unfold = (element: Element, key: string): void => {
    // Opened again before it finished closing: the one folding away goes at
    // once rather than being left to disappear from under the new one.
    fold(key, true);
    const content = options.content(element, key);
    if (!content) return;
    const where = options.anchor?.(element, key) ?? element;
    if (!where.parentNode) return;
    const inner = document.createElement('div');
    inner.className = DISCLOSURE_CLASS.inner;
    inner.append(content);
    const panel = document.createElement('div');
    panel.className = DISCLOSURE_CLASS.panel;
    // Two nodes, and this is the one thing here shaped by the animation that
    // is not written here: a wrapper whose rows go from 0fr to 1fr unfolds
    // something whose height nobody had to measure. One node cannot.
    panel.append(inner);
    where.after(panel);
    panels.set(key, panel);
  };

  const toggle = (event: Event): void => {
    const found = hit(event.target);
    if (!found) return;
    event.preventDefault();
    event.stopPropagation();
    if (open.has(found.key)) {
      open.delete(found.key);
      fold(found.key);
    } else {
      open.add(found.key);
      unfold(found.element, found.key);
    }
    found.element.setAttribute('aria-expanded', String(open.has(found.key)));
    options.onToggle?.(open.has(found.key), found.key);
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (!hit(event.target)) return;
    toggle(event);
  };

  // Capture, for the same reason Slack's own handlers are: whatever the
  // surface around the trigger does with a click, this has already decided.
  document.addEventListener('click', toggle, true);
  document.addEventListener('keydown', onKey, true);

  const refresh = (): void => {
    /*
     * A panel this instance did not put there is one from a previous life.
     *
     * A mod is stopped and started again whenever its files change, and it is
     * switched off and on by hand -- and what it left inside Slack's own
     * markup is not something Slack will ever clean up. Two of them appeared
     * in a real client this way, one per reload, and read as the same content
     * printed twice.
     */
    const mine = new Set([...panels.values(), ...closing.keys()]);
    for (const stray of document.querySelectorAll(`.${DISCLOSURE_CLASS.panel}`)) {
      if (!mine.has(stray as HTMLElement)) stray.remove();
    }

    const wanted = new Set<string>();
    for (const element of document.querySelectorAll(options.trigger)) {
      const key = options.keyFor(element);
      if (!key) continue;
      wanted.add(key);
      /*
       * Dressed every time, with nothing remembered on the element.
       *
       * Anything remembered about a node Slack is going to replace is
       * remembered about a node on its way out, and setting the same four
       * attributes again costs nothing and is always right.
       */
      element.classList.add(DISCLOSURE_CLASS.trigger);
      element.setAttribute('role', 'button');
      element.setAttribute('tabindex', '0');
      if (options.label) element.setAttribute('title', options.label);
      element.setAttribute('aria-expanded', String(open.has(key)));
      // Put back what the re-render took, rather than making somebody who
      // opened it click twice.
      if (open.has(key) && !panels.get(key)?.isConnected) unfold(element, key);
    }
    // A trigger that scrolled away takes its panel with it and keeps its place
    // in the set, so coming back to it opens it again.
    for (const key of [...panels.keys()]) if (!wanted.has(key)) fold(key);
  };

  const dispose = (): void => {
    document.removeEventListener('click', toggle, true);
    document.removeEventListener('keydown', onKey, true);
    for (const key of [...panels.keys()]) fold(key, true);
    for (const panel of [...closing.keys()]) takeAway(panel);
    open.clear();
    // Everything, not only what was tracked: this is putting somebody else's
    // markup back, and a panel left behind is one nothing else can remove.
    for (const stray of document.querySelectorAll(`.${DISCLOSURE_CLASS.panel}`)) stray.remove();
    for (const element of document.querySelectorAll(`.${DISCLOSURE_CLASS.trigger}`)) {
      // Somebody else's element, put back as theirs.
      element.classList.remove(DISCLOSURE_CLASS.trigger);
      element.removeAttribute('aria-expanded');
      element.removeAttribute('role');
      element.removeAttribute('tabindex');
    }
  };

  return Object.assign(dispose, {
    refresh,
    rebuild: () => {
      for (const [key, panel] of panels) {
        const inner = panel.querySelector(`.${DISCLOSURE_CLASS.inner}`);
        const trigger = [...document.querySelectorAll(options.trigger)]
          .find((element) => options.keyFor(element) === key);
        if (!inner || !trigger) continue;
        const content = options.content(trigger, key);
        // Nothing to show any more is a panel with nothing in it; the sweep
        // takes it away on its next pass, when `keyFor` answers null.
        inner.replaceChildren(...(content ? [content] : []));
      }
    },
    isOpen: (key: string) => open.has(key),
    close: (key: string) => { open.delete(key); fold(key); refresh(); },
    closeAll: () => { for (const key of [...open]) { open.delete(key); fold(key); } refresh(); },
  });
}

/**
 * The base look: a caret, a pointer, and a wrapper that can be unfolded.
 *
 * Deliberately without a transition. Motion is what animates it, and a
 * component that moves whether or not somebody installed Motion takes that
 * decision away from them.
 */
export const DISCLOSURE_CSS = `
.${DISCLOSURE_CLASS.trigger} { cursor: pointer; }
.${DISCLOSURE_CLASS.trigger}:hover { color: var(--dt_color-content-highlight, #1d9bd1); }
.${DISCLOSURE_CLASS.trigger}::after {
  content: '';
  display: inline-block;
  width: 0;
  height: 0;
  margin-left: 4px;
  vertical-align: .12em;
  border-left: 3.5px solid transparent;
  border-right: 3.5px solid transparent;
  border-top: 4px solid currentColor;
}
.${DISCLOSURE_CLASS.trigger}[aria-expanded="true"]::after { transform: rotate(180deg); }
.${DISCLOSURE_CLASS.panel} { display: grid; grid-template-rows: 1fr; }
.${DISCLOSURE_CLASS.inner} { overflow: hidden; min-height: 0; }
`;
