// Widgets mods can use without writing any CSS: toasts, modals, confirmations.
//
// These live in a shadow root rather than borrowing Slack's modal classes.
// Slack's dialogs are React-driven with hashed class names, so anything built
// on them would break on a Slack release and could be knocked out by a badly
// written theme. A shadow root is immune to both. Colours still come from
// Slack's --dt_color-* tokens, which cross the shadow boundary, so widgets
// follow the active theme.

import { h, type Cleanup } from '../dom.js';
import { WIDGET_CSS } from './styles.js';

const TOAST_HOST_ID = 'slackmod-toast-host';

function makeHost(id: string): { host: HTMLElement; root: ShadowRoot } {
  const existing = document.getElementById(id);
  if (existing?.shadowRoot) return { host: existing, root: existing.shadowRoot };
  const host = h('div', { id });
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = WIDGET_CSS;
  root.append(style);
  document.body.append(host);
  return { host, root };
}

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface ToastOptions {
  variant?: ToastVariant;
  /** Milliseconds on screen. 0 keeps it up until dismissed. */
  duration?: number;
  /** Optional button, e.g. Undo. Dismisses the toast after running. */
  action?: { label: string; onClick: () => void };
}

export interface ToastHandle {
  dismiss(): void;
}

/** Small transient message at the bottom of the window. */
export function toast(message: string, options: ToastOptions = {}): ToastHandle {
  const { variant = 'info', duration = 2200, action } = options;
  const { root } = makeHost(TOAST_HOST_ID);

  let stack = root.querySelector('.toast-stack');
  if (!stack) {
    stack = h('div', { class: 'toast-stack', role: 'status', 'aria-live': 'polite' });
    root.append(stack);
  }

  const node = h('div', { class: `toast toast--${variant}` }, [
    h('span', { class: 'toast__text' }, [message]),
  ]);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const dismiss = () => {
    clearTimeout(timer);
    node.dataset.leaving = 'true';
    setTimeout(() => node.remove(), 160);
  };

  if (action) {
    const button = h('button', { class: 'toast__action', type: 'button' }, [action.label]);
    button.addEventListener('click', () => {
      action.onClick();
      dismiss();
    });
    node.append(button);
  }

  stack.append(node);
  // Next frame, so the entry transition has a starting state to move from.
  requestAnimationFrame(() => {
    node.dataset.shown = 'true';
  });
  if (duration > 0) timer = setTimeout(dismiss, duration);

  return { dismiss };
}

export interface ModalAction {
  label: string;
  /** `primary` is filled, `danger` is destructive, `default` is outlined. */
  variant?: 'primary' | 'danger' | 'default';
  /** Return false to keep the modal open. */
  onClick?: () => void | boolean | Promise<void | boolean>;
}

export interface ModalOptions {
  title: string;
  subtitle?: string;
  /** String is inserted as text; pass a Node to build your own content. */
  content?: string | Node;
  actions?: ModalAction[];
  /** Width in pixels. Default 520. */
  width?: number;
  /** Allow closing with Escape or a click on the backdrop. Default true. */
  dismissible?: boolean;
  onClose?: () => void;
}

export interface ModalHandle {
  close(): void;
  /** The element holding `content`, for mods that update it live. */
  readonly body: HTMLElement;
}

/** A dialog. Returns a handle rather than a promise, so it can be updated. */
export function modal(options: ModalOptions): ModalHandle {
  const {
    title,
    subtitle,
    content,
    actions = [],
    width = 520,
    dismissible = true,
    onClose,
  } = options;

  // Its own host per modal: two modals must not share a stacking context.
  const host = h('div', { class: 'slackmod-modal-host' });
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = WIDGET_CSS;
  root.append(style);
  document.body.append(host);

  const body = h('div', { class: 'modal__body' });
  if (typeof content === 'string') body.append(h('p', { class: 'modal__text' }, [content]));
  else if (content) body.append(content);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeyDown, true);
    host.remove();
    onClose?.();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && dismissible) {
      event.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', onKeyDown, true);

  const footer = h('div', { class: 'modal__footer' });
  for (const action of actions) {
    const button = h(
      'button',
      { class: `btn btn--${action.variant ?? 'default'}`, type: 'button' },
      [action.label],
    );
    button.addEventListener('click', async () => {
      const keepOpen = (await action.onClick?.()) === false;
      if (!keepOpen) close();
    });
    footer.append(button);
  }

  const closeButton = h('button', { class: 'modal__close', type: 'button', 'aria-label': 'Close' }, ['×']);
  closeButton.addEventListener('click', close);

  const header = h('div', { class: 'modal__header' }, [
    h('div', { class: 'modal__titles' }, [
      h('h2', { class: 'modal__title' }, [title]),
      ...(subtitle ? [h('p', { class: 'modal__subtitle' }, [subtitle])] : []),
    ]),
  ]);
  if (dismissible) header.append(closeButton);

  const dialog = h('div', {
    class: 'modal',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': title,
    style: `width: min(${width}px, 92vw)`,
  }, [header, body, ...(actions.length > 0 ? [footer] : [])]);

  const backdrop = h('div', { class: 'modal__backdrop' }, [dialog]);
  if (dismissible) {
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) close();
    });
  }
  root.append(backdrop);

  queueMicrotask(() => root.querySelector<HTMLElement>('.btn, .modal__close')?.focus());

  return { close, body };
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

/** Yes/no dialog. Resolves false if dismissed. */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  const { title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false } = options;
  return new Promise((resolve) => {
    let answered = false;
    const settle = (value: boolean) => {
      if (answered) return;
      answered = true;
      resolve(value);
    };
    modal({
      title,
      content: message,
      width: 420,
      actions: [
        { label: cancelLabel, variant: 'default', onClick: () => settle(false) },
        { label: confirmLabel, variant: danger ? 'danger' : 'primary', onClick: () => settle(true) },
      ],
      onClose: () => settle(false),
    });
  });
}

/** Remove any widget host left behind, e.g. when a plugin is disabled. */
export function disposeWidgets(): Cleanup {
  return () => {
    document.getElementById(TOAST_HOST_ID)?.remove();
    for (const node of document.querySelectorAll('.slackmod-modal-host')) node.remove();
  };
}
