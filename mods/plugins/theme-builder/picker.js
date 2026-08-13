// A colour picker with an alpha channel.
//
// `<input type="color">` has no alpha and opens the operating system's dialog,
// which lands on top of the app you are trying to look at. Slack's own palette
// is full of translucent colours -- every hover state is one -- so a picker
// without alpha cannot express what the app already does.
//
// Built against a document rather than the global one: this runs in the
// builder's window, which is a separate document with its own event loop.

import { formatCss, fromHsv, parseColour, toHsv } from './colour.js';

export const CHECKER =
  'linear-gradient(45deg,rgba(0,0,0,.25) 25%,transparent 25%),' +
  'linear-gradient(-45deg,rgba(0,0,0,.25) 25%,transparent 25%),' +
  'linear-gradient(45deg,transparent 75%,rgba(0,0,0,.25) 75%),' +
  'linear-gradient(-45deg,transparent 75%,rgba(0,0,0,.25) 75%)';

/** Paint `colour` over the checkerboard, so its transparency is visible. */
export function paintSwatch(node, css) {
  node.style.backgroundImage = `linear-gradient(${css}, ${css}), ${CHECKER}`;
}

/** Pointer dragging over a strip or a square, clamped to it, in 0..1. */
function drag(surface, onMove) {
  const handle = (event) => {
    const rect = surface.getBoundingClientRect();
    onMove(
      Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    );
  };
  surface.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    surface.setPointerCapture(event.pointerId);
    handle(event);
    const move = (e) => handle(e);
    const up = () => {
      surface.removeEventListener('pointermove', move);
      surface.removeEventListener('pointerup', up);
    };
    surface.addEventListener('pointermove', move);
    surface.addEventListener('pointerup', up);
  });
}

/**
 * Build the picker.
 *
 * `onChange` fires on every drag frame, not on release: the point of the tool
 * is that Slack repaints while the colour is moving, so the value has to be
 * live. Returns { node, show, colour }.
 */
export function createPicker(doc, onChange) {
  const el = (tag, props = {}) => Object.assign(doc.createElement(tag), props);

  const node = el('div', { className: 'picker' });
  const sv = el('div', { className: 'sv' });
  const svKnob = el('div', { className: 'knob' });
  sv.append(svKnob);
  const hue = el('div', { className: 'slider hue' });
  const hueKnob = el('div', { className: 'knob' });
  hue.append(hueKnob);
  const alpha = el('div', { className: 'slider' });
  const alphaKnob = el('div', { className: 'knob' });
  alpha.append(alphaKnob);
  const field = el('input', { type: 'text', spellcheck: false, className: 'hex' });
  const label = el('div', { className: 'picker-label' });

  node.append(label, sv, hue, alpha, field);

  let colour = { r: 0, g: 0, b: 0, a: 1 };
  // Hue and saturation have no meaning at the extremes -- every black is hue 0,
  // saturation 0 -- so dragging value to the bottom and back would otherwise
  // snap the hue to red. Keeping the last real one makes the square behave.
  let hsv = { h: 0, s: 0, v: 0 };

  const draw = () => {
    sv.style.background =
      'linear-gradient(to top, #000, rgba(0,0,0,0)), ' +
      `linear-gradient(to right, #fff, hsl(${hsv.h}, 100%, 50%))`;
    svKnob.style.left = `${hsv.s * 100}%`;
    svKnob.style.top = `${(1 - hsv.v) * 100}%`;
    svKnob.style.background = formatCss({ ...colour, a: 1 });
    hueKnob.style.left = `${(hsv.h / 360) * 100}%`;
    hueKnob.style.background = `hsl(${hsv.h}, 100%, 50%)`;
    alpha.style.backgroundImage =
      `linear-gradient(to right, rgba(${colour.r},${colour.g},${colour.b},0), ` +
      `rgb(${colour.r},${colour.g},${colour.b})), ${CHECKER}`;
    alphaKnob.style.left = `${colour.a * 100}%`;
    alphaKnob.style.background = formatCss(colour);
    if (doc.activeElement !== field) field.value = formatCss(colour);
  };

  const emit = (next) => {
    colour = next;
    draw();
    onChange(next);
  };

  drag(sv, (x, y) => {
    hsv = { ...hsv, s: x, v: 1 - y };
    emit(fromHsv({ ...hsv, a: colour.a }));
  });
  drag(hue, (x) => {
    hsv = { ...hsv, h: x * 360 };
    emit(fromHsv({ ...hsv, a: colour.a }));
  });
  drag(alpha, (x) => emit({ ...colour, a: Math.round(x * 100) / 100 }));

  field.addEventListener('input', () => {
    const parsed = parseColour(field.value);
    if (!parsed) return;
    hsv = toHsv(parsed);
    emit(parsed);
  });

  return {
    node,
    /** Point the picker at a value, with a caption saying what is being edited. */
    show(value, caption) {
      const parsed = parseColour(value) ?? { r: 0, g: 0, b: 0, a: 1 };
      colour = parsed;
      const next = toHsv(parsed);
      // Only take hue and saturation when they mean something.
      hsv = { h: next.v === 0 || next.s === 0 ? hsv.h : next.h, s: next.v === 0 ? hsv.s : next.s, v: next.v };
      label.textContent = caption;
      node.setAttribute('data-open', 'true');
      draw();
    },
    hide() {
      node.setAttribute('data-open', 'false');
    },
    colour: () => colour,
  };
}
