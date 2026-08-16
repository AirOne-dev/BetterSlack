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
  subtitle?: string;
  placement?: Placement;
  /** Hover delay in ms. Slack's own is ~150; keyboard focus skips it. */
  delayMs?: number;
}

const SHOW_DELAY_MS = 150;
const EDGE_OVERLAP = 4;
const VIEWPORT_MARGIN = 8;

export function attachTooltip(trigger: HTMLElement, options: TooltipOptions): Cleanup {
  const { title, subtitle, placement = 'right', delayMs = SHOW_DELAY_MS } = options;

  // A native title would show *as well as* this one.
  trigger.removeAttribute('title');
  trigger.setAttribute('aria-label', subtitle ? `${title}. ${subtitle}` : title);

  let layer: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const build = (): HTMLElement => {
    const tip = h('div', {
      class: `c-tooltip__tip c-tooltip__tip--${placement} c-tooltip__tip--small`,
      'data-qa': 'tooltip-tip',
      'data-sk': 'tooltip',
    }, [h('div', {}, [title])]);

    if (subtitle) tip.append(h('div', { class: 'c-tooltip__subtitle' }, [subtitle]));
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
    // Measure before placing, so the first frame is not drawn in the corner.
    layer.style.visibility = 'hidden';
    document.body.append(layer);
    position(layer);
    layer.style.visibility = '';
  };

  const hide = (): void => {
    clearTimeout(timer);
    timer = undefined;
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
  document.addEventListener('keydown', onKeyDown, true);
  // A scroll or resize would leave the layer stranded where it was.
  window.addEventListener('scroll', onLeave, true);
  window.addEventListener('resize', onLeave);

  return () => {
    hide();
    trigger.removeEventListener('mouseenter', onEnter);
    trigger.removeEventListener('mouseleave', onLeave);
    trigger.removeEventListener('mousedown', onLeave);
    trigger.removeEventListener('click', onLeave);
    trigger.removeEventListener('focus', onFocus);
    trigger.removeEventListener('blur', onLeave);
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('scroll', onLeave, true);
    window.removeEventListener('resize', onLeave);
  };
}
