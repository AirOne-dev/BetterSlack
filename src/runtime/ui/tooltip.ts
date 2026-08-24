// Slack-style tooltips.
//
// Slack's own tooltips are rendered by React through a portal, so there is no
// way to register a foreign element with them. What can be done is reproduce
// the markup exactly and let Slack's stylesheet do the painting:
//
//   .c-tooltip__tip        background, radius, 13px type, --arrow-size
//   .c-tooltip__subtitle   the dimmer second line
//   .c-tooltip__tip__arrow the little pointer
//   .c-popover__content    the positioned layer (z-index 1001)
//
// All four are stable class names, not hashed CSS-module ones, and they read
// from --dt_color-* — so these tooltips follow the active theme like Slack's.
//
// Measured against Slack 4.51 by driving a real pointer over its own buttons
// (CDP Input.dispatchMouseEvent): the tooltip lands ~177ms after the pointer
// enters, and the layer sits 4px into the trigger's edge — the tip's own 8px
// margin makes the visible gap.
//
// Synthetic mouseenter events give a very different figure. Slack's tooltip
// code takes another path for untrusted events, and measuring that way
// suggested a 1s delay, which is what this file originally shipped with. If you
// change the timing, measure it with a real pointer.

import { h, type Cleanup } from '../dom.js';

export type Placement = 'right' | 'left' | 'top' | 'bottom';

export interface TooltipOptions {
  title: string;
  /**
   * The dimmer line under the title, or several of them.
   *
   * An array because a status tooltip has two things to say under the sentence
   * -- when it runs out, and what clicking it does -- and joining them with a
   * separator makes one long line out of two short ones.
   */
  subtitle?: string | string[];
  placement?: Placement;
  /** Hover delay in ms. Slack's own is ~150; keyboard focus skips it. */
  delayMs?: number;
  /**
   * A node drawn before the title, on the same line.
   *
   * For the one thing Slack puts inside a tooltip that is not words: the emoji
   * of a status, which is how its own sidebar answers "what does that little
   * picture mean". Cloned on every build rather than moved, since one trigger
   * can show its tooltip many times and a node can only be in one place.
   */
  icon?: Node;
}

const SHOW_DELAY_MS = 150;
const EDGE_OVERLAP = 4;
const VIEWPORT_MARGIN = 8;

/**
 * One tooltip per element, so attaching twice replaces rather than stacks.
 *
 * A caller with a node it keeps and re-describes -- the strip in Slack's rail
 * re-attaches when the status changes -- would otherwise leave the old
 * listeners on it, and hovering after five changes would open five layers.
 * A WeakMap so an element that goes out of the document takes its entry with
 * it.
 */
const attached = new WeakMap<HTMLElement, Cleanup>();

export function attachTooltip(trigger: HTMLElement, options: TooltipOptions): Cleanup {
  attached.get(trigger)?.();
  const { title, subtitle, placement = 'right', delayMs = SHOW_DELAY_MS, icon } = options;

  // A native title would show *as well as* this one.
  trigger.removeAttribute('title');
  const lines = (subtitle === undefined ? [] : [subtitle].flat()).filter((line) => line !== '');
  trigger.setAttribute('aria-label', [title, ...lines].join('. '));

  let layer: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const build = (): HTMLElement => {
    const heading = icon
      ? h('div', { class: 'betterslack-tooltip__heading' }, [
        h('span', { class: 'betterslack-tooltip__icon' }, [icon.cloneNode(true)]),
        h('span', {}, [title]),
      ])
      : h('div', {}, [title]);

    const tip = h('div', {
      // `--large` rather than `--small`, which is not a class Slack styles at
      // all: the only rule either of them has is `--large { max-width: 400px }`,
      // and without it a long status ran off the edge of the window in one line
      // where Slack's own tooltip wraps. Read out of the live stylesheet.
      class: `c-tooltip__tip c-tooltip__tip--${placement} c-tooltip__tip--large`,
      'data-qa': 'tooltip-tip',
      'data-sk': 'tooltip',
    }, [heading]);

    for (const line of lines) tip.append(h('div', { class: 'c-tooltip__subtitle' }, [line]));
    tip.append(h('div', { class: 'c-tooltip__tip__arrow', 'data-qa': 'tooltip-tip-arrow' }));

    // The outer layer is ours, not Slack's `.c-popover__content`: that class
    // pins `top` in a way that survives even an inline !important, so the
    // tooltip stuck to the top of the window. Only the inner tip wears Slack's
    // classes, which is where all the visual styling lives anyway.
    return h('div', {
      class: 'betterslack-tooltip',
      role: 'tooltip',
      'data-qa': 'tooltip-popover',
      style:
        'position: fixed; top: 0; left: 0; z-index: 1001; pointer-events: none;' +
        ' will-change: transform; transition: opacity 80ms ease;',
    }, [h('div', { role: 'presentation' }, [tip])]);
  };

  const position = (node: HTMLElement): void => {
    const t = trigger.getBoundingClientRect();
    const { width: w, height: hgt } = node.getBoundingClientRect();
    let left: number;
    let top: number;

    switch (placement) {
      case 'left':
        left = t.left - w + EDGE_OVERLAP;
        top = t.top + t.height / 2 - hgt / 2;
        break;
      case 'top':
        left = t.left + t.width / 2 - w / 2;
        top = t.top - hgt + EDGE_OVERLAP;
        break;
      case 'bottom':
        left = t.left + t.width / 2 - w / 2;
        top = t.bottom - EDGE_OVERLAP;
        break;
      default:
        left = t.right - EDGE_OVERLAP;
        top = t.top + t.height / 2 - hgt / 2;
    }

    // Keep it on screen; the strip sits at the very bottom of the window.
    left = Math.min(Math.max(left, VIEWPORT_MARGIN), window.innerWidth - w - VIEWPORT_MARGIN);
    top = Math.min(Math.max(top, VIEWPORT_MARGIN), window.innerHeight - hgt - VIEWPORT_MARGIN);

    // `position: fixed` + transform, so there is no scroll arithmetic and
    // nothing in Slack's stylesheet to fight over top/left.
    node.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
  };

  const show = (): void => {
    if (layer || !trigger.isConnected) return;
    layer = build();
    /*
     * The listeners that are not on the trigger go on here, and come off in
     * `hide()`.
     *
     * Never once per tooltip for the life of the trigger: `attachTooltip` is
     * called per element and `statusNode` attaches one per row, so every redraw
     * of a member column would leave twenty more capture-phase `scroll`
     * handlers on `window` that nothing ever removes. Measured on a live
     * client: four channel changes put 38 of them there, on a page that scrolls
     * constantly.
     *
     * One tooltip is visible at a time, so this way there is at most one set,
     * and none at all while nothing is hovered.
     */
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', onLeave, true);
    window.addEventListener('resize', onLeave);
    // Measure before placing, so the first frame is not drawn in the corner.
    layer.style.visibility = 'hidden';
    document.body.append(layer);
    position(layer);
    layer.style.visibility = '';
  };

  const hide = (): void => {
    clearTimeout(timer);
    timer = undefined;
    if (layer) {
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('scroll', onLeave, true);
      window.removeEventListener('resize', onLeave);
    }
    layer?.remove();
    layer = null;
  };

  const scheduleShow = (immediate = false): void => {
    if (layer) return;
    clearTimeout(timer);
    timer = setTimeout(show, immediate ? 0 : delayMs);
  };

  const onEnter = () => scheduleShow();
  const onLeave = () => hide();
  const onFocus = (event: FocusEvent) => {
    // Only keyboard focus; a click already has the pointer there.
    if (trigger.matches(':focus-visible')) scheduleShow(true);
    else void event;
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') hide();
  };

  trigger.addEventListener('mouseenter', onEnter);
  trigger.addEventListener('mouseleave', onLeave);
  trigger.addEventListener('mousedown', onLeave);
  trigger.addEventListener('click', onLeave);
  trigger.addEventListener('focus', onFocus);
  trigger.addEventListener('blur', onLeave);
  // A scroll or resize would leave the layer stranded where it was, so those
  // are watched -- but only while there is a layer. See `show`.

  const detach = (): Cleanup => () => {
    // `hide` takes the global ones off, if this tooltip is the one showing.
    hide();
    trigger.removeEventListener('mouseenter', onEnter);
    trigger.removeEventListener('mouseleave', onLeave);
    trigger.removeEventListener('mousedown', onLeave);
    trigger.removeEventListener('click', onLeave);
    trigger.removeEventListener('focus', onFocus);
    trigger.removeEventListener('blur', onLeave);
    // Only if this one is still the element's: a later attach has already
    // replaced the entry, and clearing it would drop that one instead.
    if (attached.get(trigger) === cleanup) attached.delete(trigger);
  };

  const cleanup = detach();
  attached.set(trigger, cleanup);
  return cleanup;
}
