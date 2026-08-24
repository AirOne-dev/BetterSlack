// The design system, as components any mod can build with.
//
// Slack's own classes are the right answer inside the client -- the Mods panel
// wears `.c-dialog` and `.c-button` and follows every theme for free. They are
// not available anywhere else: a mod that opens a window of its own gets a
// blank document with no stylesheet in it, and the theme builder rebuilt a
// button, an input, a card, a popover and a dialog from scratch to fill it.
//
// That is one copy of Slack's design system per mod, each drifting on its own.
// So it lives here instead, as a kit bound to whatever document you hand it,
// with `KIT_CSS` to inject alongside. It is a deliberate copy, measured off the
// app: the 36px button with its 4px radius and 900-weight label, the input that
// grows a blue ring on focus, the preferences rail, the 8px card.
//
// Everything is prefixed `sm-`, so nothing here can collide with Slack's own
// classes if a mod injects the stylesheet into the client itself.

import { createCodeEditor, type CodeEditor, type CodeEditorOptions } from './code.js';

export type Child = HTMLElement | string | null | undefined | false;

export interface ButtonOptions {
  /** `primary` is Slack's confirm green, `danger` its red, `ghost` an outline. */
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  icon?: string;
  title?: string;
  wide?: boolean;
  onClick?: () => void;
  onHover?: HoverHandlers;
}

export interface IconButtonOptions {
  onClick?: () => void;
  title?: string;
  danger?: boolean;
}

export interface HoverHandlers {
  enter: () => void;
  leave: () => void;
}

export interface Option {
  value: string;
  label: string;
  title?: string;
  count?: number;
}

export interface SelectOptions {
  onChange?: (value: string) => void;
  title?: string;
}

export interface SegmentedOptions {
  onChange?: (value: string) => void;
}

export interface Segmented {
  node: HTMLElement;
  set(value: string): void;
  value(): string;
}

export interface CardOptions {
  actions?: Child[];
  subtitle?: string;
}

export interface ConfirmOptions {
  title: string;
  body: string;
  action: string;
  cancel: string;
  danger?: boolean;
}

export interface Popover {
  node: HTMLElement;
  close(): void;
  place(): void;
}

export interface Kit {
  el(tag: string, props?: Record<string, unknown>, children?: Child[]): HTMLElement;
  button(label: string, options?: ButtonOptions): HTMLButtonElement;
  iconButton(glyph: string, options?: IconButtonOptions): HTMLButtonElement;
  field(label: string, control: HTMLElement, hint?: string): HTMLElement;
  input(props?: Record<string, unknown>): HTMLInputElement;
  select(options: Option[], config?: SelectOptions): HTMLSelectElement;
  segmented(options: Option[], config?: SegmentedOptions): Segmented;
  card(title: string | null, children: Child[], options?: CardOptions): HTMLElement;
  emptyState(title: string, body: string, action?: HTMLElement): HTMLElement;
  swatch(css: string, options?: { size?: 'sm' | 'md' | 'lg' }): HTMLElement;
  popover(content: HTMLElement, anchor: HTMLElement, options?: { onClose?: () => void }): Popover;
  confirm(options: ConfirmOptions): Promise<boolean>;
  copyText(text: string): Promise<boolean>;
  hoverable<T extends HTMLElement>(node: T, handlers: HoverHandlers): T;
  /** A CSS editor that colours what you type. */
  code(options?: CodeEditorOptions): CodeEditor;
  /** The checkerboard, so a translucent colour reads as translucent. */
  CHECKER: string;
}

/** Build the primitives against one document. */
export function createKit(doc: Document = document): Kit {
  const el = (tag: string, props: Record<string, unknown> = {}, children: Child[] = []): HTMLElement => {
    const node = doc.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null) continue;
      if (key === 'class') node.className = String(value);
      else if (key === 'html') node.innerHTML = String(value);
      else if (key.includes('-')) node.setAttribute(key, String(value));
      else (node as unknown as Record<string, unknown>)[key] = value;
    }
    for (const child of children) {
      if (child === null || child === undefined || child === false) continue;
      node.append(typeof child === 'string' ? doc.createTextNode(child) : (child as Node));
    }
    return node;
  };

  /**
   * Slack's button, in its three weights.
   *
   * `primary` is Slack's confirm green rather than its brand aubergine: in the
   * app, aubergine is chrome and green is what you press.
   */
  const button = (label: string, { variant = 'default', icon, onClick, title, wide, onHover }: ButtonOptions = {}): HTMLButtonElement => {
    const node = el('button', { class: `sm-btn sm-btn--${variant}`, title, type: 'button' }, [
      icon ? el('span', { class: 'sm-btn__icon', html: icon }) : null,
      el('span', { textContent: label }),
    ]);
    if (wide) node.classList.add('sm-btn--wide');
    if (onClick) node.addEventListener('click', onClick);
    if (onHover) hoverable(node, onHover);
    return node as HTMLButtonElement;
  };

  /** A quiet square button holding nothing but a glyph. */
  const iconButton = (glyph: string, { onClick, title, danger }: IconButtonOptions = {}): HTMLButtonElement => {
    const node = el('button', {
      class: `sm-icon-btn${danger ? ' sm-icon-btn--danger' : ''}`,
      title,
      type: 'button',
      'aria-label': title ?? '',
      html: glyph,
    });
    if (onClick) node.addEventListener('click', onClick);
    return node as HTMLButtonElement;
  };

  /**
   * Run something while the pointer is over a node, and undo it when it leaves.
   *
   * Bound on focus as well: the highlight is information, and information that
   * only exists for a mouse is information a keyboard cannot have.
   */
  const hoverable = <T extends HTMLElement>(node: T, { enter, leave }: HoverHandlers): T => {
    node.addEventListener('mouseenter', enter);
    node.addEventListener('focus', enter);
    node.addEventListener('mouseleave', leave);
    node.addEventListener('blur', leave);
    return node;
  };

  /** Label, control, and the sentence under it that explains the control. */
  const field = (label: string, control: HTMLElement, hint?: string): HTMLElement =>
    el('div', { class: 'sm-field' }, [
      el('label', { class: 'sm-field__label', textContent: label }),
      control,
      hint ? el('p', { class: 'sm-field__hint', textContent: hint }) : null,
    ]);

  /**
   * A class passed in is added to the component's own rather than replacing it.
   * Overwriting is what a spread would do, and losing every rule the kit
   * carries because a caller wanted one extra class is a trap, not a feature.
   */
  const input = (props: Record<string, unknown> = {}): HTMLInputElement => {
    const { class: extra, ...rest } = props;
    return el('input', {
      class: extra ? `sm-input ${String(extra)}` : 'sm-input',
      type: 'text',
      spellcheck: false,
      ...rest,
    }) as HTMLInputElement;
  };

  const select = (options: Option[], { onChange, title }: SelectOptions = {}): HTMLSelectElement => {
    const node = el('select', { class: 'sm-input sm-select', title }) as HTMLSelectElement;
    for (const option of options) {
      node.append(el('option', { value: option.value, textContent: option.label }));
    }
    if (onChange) node.addEventListener('change', () => onChange(node.value));
    return node;
  };

  /**
   * Slack's segmented control: a row of tabs that behaves like a select and
   * reads like a filter. Returns { node, value, set }.
   */
  const segmented = (options: Option[], { onChange }: SegmentedOptions = {}): Segmented => {
    const node = el('div', { class: 'sm-segmented', role: 'tablist' });
    let value = options[0]?.value ?? '';
    const buttons = new Map<string, HTMLElement>();
    const set = (next: string) => {
      value = next;
      for (const [key, item] of buttons) item.setAttribute('aria-selected', String(key === next));
    };
    for (const option of options) {
      const item = el('button', {
        class: 'sm-segmented__item',
        type: 'button',
        role: 'tab',
        title: option.title,
      }, [
        el('span', { textContent: option.label }),
        option.count === undefined ? null : el('em', { textContent: String(option.count) }),
      ]);
      item.addEventListener('click', () => { set(option.value); onChange?.(option.value); });
      buttons.set(option.value, item);
      node.append(item);
    }
    set(value);
    return { node, set, value: () => value };
  };

  /** A titled block. Everything in a view lives in one of these. */
  const card = (title: string | null, children: Child[], { actions, subtitle }: CardOptions = {}): HTMLElement =>
    el('section', { class: 'sm-card' }, [
      title
        ? el('header', { class: 'sm-card__head' }, [
          el('div', {}, [
            el('h2', { textContent: title }),
            subtitle ? el('p', { textContent: subtitle }) : null,
          ]),
          actions ? el('div', { class: 'sm-card__actions' }, actions) : null,
        ])
        : null,
      el('div', { class: 'sm-card__body' }, children),
    ]);

  /** What a view shows before it has anything to show. */
  const emptyState = (title: string, body: string, action?: HTMLElement): HTMLElement =>
    el('div', { class: 'sm-empty' }, [
      el('h3', { textContent: title }),
      el('p', { textContent: body }),
      action ?? null,
    ]);

  /** The checkerboard, so a translucent colour reads as translucent. */
  const CHECKER =
    'linear-gradient(45deg,rgba(0,0,0,.28) 25%,transparent 25%),' +
    'linear-gradient(-45deg,rgba(0,0,0,.28) 25%,transparent 25%),' +
    'linear-gradient(45deg,transparent 75%,rgba(0,0,0,.28) 75%),' +
    'linear-gradient(-45deg,transparent 75%,rgba(0,0,0,.28) 75%)';

  const swatch = (css: string, { size = 'md' }: { size?: 'sm' | 'md' | 'lg' } = {}): HTMLElement => {
    const node = el('span', { class: `sm-swatch sm-swatch--${size}` });
    node.style.backgroundImage = `linear-gradient(${css}, ${css}), ${CHECKER}`;
    return node;
  };

  /**
   * A popover anchored to whatever was clicked.
   *
   * Anchoring rather than docking is the difference between a tool and a form:
   * the editor appears next to the colour it edits, and the colour stays in
   * view while it changes. Kept inside the window by flipping when it would
   * hang off the bottom.
   */
  const popover = (content: HTMLElement, anchor: HTMLElement, { onClose }: { onClose?: () => void } = {}): Popover => {
    const node = el('div', { class: 'sm-popover' }, [content]);
    doc.body.append(node);

    const place = () => {
      const box = anchor.getBoundingClientRect();
      const own = node.getBoundingClientRect();
      const margin = 8;
      let top = box.bottom + 6;
      if (top + own.height > doc.documentElement.clientHeight - margin) {
        top = Math.max(margin, box.top - own.height - 6);
      }
      let left = box.left;
      if (left + own.width > doc.documentElement.clientWidth - margin) {
        left = Math.max(margin, doc.documentElement.clientWidth - own.width - margin);
      }
      node.style.top = `${top}px`;
      node.style.left = `${left}px`;
    };
    place();

    const close = () => {
      doc.removeEventListener('mousedown', outside as EventListener, true);
      doc.removeEventListener('keydown', escape as EventListener, true);
      doc.defaultView!.removeEventListener('resize', place);
      node.remove();
      onClose?.();
    };
    const outside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!node.contains(target) && !anchor.contains(target)) close();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };

    doc.addEventListener('mousedown', outside as EventListener, true);
    doc.addEventListener('keydown', escape as EventListener, true);
    doc.defaultView!.addEventListener('resize', place);

    return { node, close, place };
  };

  /**
   * Slack's confirm dialog: a scrim, a card, cancel on the left of the action.
   *
   * Resolves false when dismissed, so a caller can await it and do nothing --
   * dismissing has to mean no, not "ask again".
   */
  const confirm = ({ title, body, action, cancel: cancelLabel, danger }: ConfirmOptions): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
    const scrim = el('div', { class: 'sm-scrim' });
    const cancel = button(cancelLabel, { variant: 'ghost' });
    const go = button(action, { variant: danger ? 'danger' : 'primary' });
    const dialog = el('div', { class: 'sm-dialog', role: 'dialog', 'aria-modal': 'true' }, [
      el('h2', { textContent: title }),
      el('p', { textContent: body }),
      el('div', { class: 'sm-dialog__actions' }, [cancel, go]),
    ]);
    scrim.append(dialog);
    doc.body.append(scrim);

    const close = (answer: boolean) => {
      doc.removeEventListener('keydown', key as EventListener, true);
      scrim.remove();
      resolve(answer);
    };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') close(false); };
    cancel.addEventListener('click', () => close(false));
    go.addEventListener('click', () => close(true));
    scrim.addEventListener('mousedown', (event) => { if (event.target === scrim) close(false); });
    doc.addEventListener('keydown', key as EventListener, true);
    go.focus();
  });

  /**
   * Copy, with the fallback that makes it work everywhere.
   *
   * The clipboard API needs the document to be focused, and this window loses
   * focus the moment anything is clicked in Slack. execCommand is deprecated
   * and still the only thing that always works here.
   */
  const copyText = async (text: string): Promise<boolean> => {
    try {
      await doc.defaultView!.navigator.clipboard.writeText(text);
      return true;
    } catch {
      const scratch = el('textarea', { value: text }) as HTMLTextAreaElement;
      scratch.style.position = 'fixed';
      scratch.style.opacity = '0';
      doc.body.append(scratch);
      scratch.select();
      const done = doc.execCommand('copy');
      scratch.remove();
      return done;
    }
  };

  return {
    el, button, iconButton, field, input, select, segmented, card, emptyState,
    swatch, popover, confirm, copyText, hoverable, CHECKER,
    code: (options: CodeEditorOptions = {}) => createCodeEditor(doc, options),
  };
}
