// One keystroke for everything, in the shape Raycast made obvious.
//
// The first version was a flat list of identical rows, and it read as a wall:
// nothing said what kind of thing each line was, so scanning it took as long as
// reading it. What makes Raycast legible is not decoration -- it is that every
// row carries a picture of what it is, that rows are grouped under headings,
// that the right-hand side says the category so the left can stay short, and
// that a footer keeps telling you which key does what.
//
// Two things learned the hard way here:
//
//   * Slack binds keydown on `window` in the capture phase, which runs before
//     anything on `document`. Arrow keys were being eaten before they arrived.
//     This listens on `window`, in capture, like every other shortcut we bind.
//   * Moving the selection must not rebuild the list. Rebuilding two hundred
//     rows per keypress is slow enough to feel broken, and it drops the node
//     the pointer is over.

import { h, type Cleanup } from '../dom.js';

const HOST_ID = 'betterslack-palette';

export interface Command {
  /** Unique per mod; the runtime prefixes it with the mod id. */
  id: string;
  title: string;
  /** Where it comes from, shown on the right. */
  source?: string;
  subtitle?: string;
  /**
   * A picture of what this is: an image URL (an avatar), a single emoji, or a
   * short string like `#`. Anything else falls back to the first letter.
   */
  icon?: string;
  /** Heading to group it under. Entries with no section come first, ungrouped. */
  section?: string;
  run: () => void | Promise<void>;
}

export interface PaletteLabels {
  placeholder: string;
  empty: string;
  /** Footer hints, e.g. "open" and "close". */
  openHint?: string;
  closeHint?: string;
}

/**
 * Ranked by how well the words match, and by where they matched.
 *
 * Every word has to appear somewhere, in any order, so "theme build" finds
 * "Theme builder: open". A match on the title outranks one on the source,
 * because the title is what someone was typing at.
 */
export function rank(commands: Command[], query: string): Command[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return commands;

  const scored: Array<{ command: Command; score: number }> = [];
  for (const command of commands) {
    const title = command.title.toLowerCase();
    const rest = `${command.source ?? ''} ${command.subtitle ?? ''} ${command.section ?? ''}`.toLowerCase();
    let score = 0;
    let matched = true;
    for (const word of words) {
      if (title.startsWith(word)) score += 4;
      else if (new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(title)) score += 3;
      else if (title.includes(word)) score += 2;
      else if (rest.includes(word)) score += 1;
      else {
        matched = false;
        break;
      }
    }
    if (matched) scored.push({ command, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((entry) => entry.command);
}

export function closePalette(): void {
  document.getElementById(HOST_ID)?.remove();
}

export function isPaletteOpen(): boolean {
  return Boolean(document.getElementById(HOST_ID));
}

/** An avatar, an emoji, a glyph, or the first letter -- in that order. */
function iconFor(command: Command): HTMLElement {
  const icon = command.icon?.trim();
  if (icon && /^https?:\/\//.test(icon)) {
    const image = h('img', { class: 'betterslack-palette__icon', src: icon, alt: '', loading: 'lazy' });
    return image;
  }
  const box = h('span', { class: 'betterslack-palette__icon betterslack-palette__icon--glyph' });
  box.textContent = icon && icon.length <= 2 ? icon : command.title.slice(0, 1).toUpperCase();
  return box;
}

/**
 * Open the palette over Slack.
 *
 * Returns a cleanup, so a plugin being switched off takes its palette with it.
 */
export function openPalette(entries: Command[], labels: PaletteLabels): Cleanup {
  closePalette();

  let shown = rank(entries, '');
  let index = 0;
  /** The row for each visible entry, so selection can move without rebuilding. */
  let rows: HTMLElement[] = [];

  const input = h('input', {
    class: 'betterslack-palette__input',
    type: 'text',
    placeholder: labels.placeholder,
    spellcheck: 'false',
    'aria-label': labels.placeholder,
  }) as HTMLInputElement;

  const list = h('div', { class: 'betterslack-palette__list', role: 'listbox' });
  const footerAction = h('span', { class: 'betterslack-palette__hint' });
  const footerCount = h('span', { class: 'betterslack-palette__count' });

  const close = () => {
    window.removeEventListener('keydown', onKey, true);
    document.getElementById(HOST_ID)?.remove();
  };

  const run = (command: Command | undefined) => {
    if (!command) return;
    close();
    void Promise.resolve(command.run()).catch((err: Error) => {
      console.error(`[betterslack] "${command.title}" failed`, err);
    });
  };

  /** Move the highlight, and nothing else. */
  const select = (next: number) => {
    if (rows.length === 0) return;
    index = (next + rows.length) % rows.length;
    rows.forEach((row, position) => row.setAttribute('aria-selected', String(position === index)));
    rows[index]?.scrollIntoView({ block: 'nearest' });
    const command = shown[index];
    footerAction.textContent = command
      ? `↵ ${labels.openHint ?? 'open'} · esc ${labels.closeHint ?? 'close'}`
      : '';
  };

  const paint = () => {
    list.replaceChildren();
    rows = [];

    if (shown.length === 0) {
      list.append(h('div', { class: 'betterslack-empty' }, [labels.empty]));
      footerCount.textContent = '';
      footerAction.textContent = '';
      return;
    }

    /*
     * Grouped under headings, each heading once.
     *
     * Emitting one whenever the section changed looked right until the list
     * interleaved -- installed mods and catalogue mods alternate, and the
     * headings alternated with them. Sections keep the order they first appear
     * in, so whoever built the list still decides what comes first.
     */
    const grouped = new Map<string, Command[]>();
    for (const command of shown) {
      const key = command.section ?? '';
      const bucket = grouped.get(key);
      if (bucket) bucket.push(command);
      else grouped.set(key, [command]);
    }

    for (const [heading, commands] of grouped) {
      if (heading) list.append(h('div', { class: 'betterslack-palette__section' }, [heading]));
      for (const command of commands) {

        const row = h('button', {
          class: 'betterslack-palette__row',
          type: 'button',
          role: 'option',
        }, [
          iconFor(command),
          h('span', { class: 'betterslack-palette__text' }, [
            h('span', { class: 'betterslack-palette__title' }, [command.title]),
            command.subtitle
              ? h('span', { class: 'betterslack-palette__sub' }, [command.subtitle])
              : null,
          ].filter(Boolean) as Node[]),
          command.source ? h('span', { class: 'betterslack-palette__source' }, [command.source]) : null,
        ].filter(Boolean) as Node[]);

        const position = rows.length;
        row.addEventListener('click', () => run(command));
        // Hovering moves the selection, so the mouse and the keyboard never
        // disagree about what Enter would do.
        row.addEventListener('mouseenter', () => select(position));
        rows.push(row);
        list.append(row);
      }
    }

    // The order rows were painted in is the order the keyboard walks, which is
    // only true because the grouping above rewrote it.
    shown = [...grouped.values()].flat();

    footerCount.textContent = `${shown.length}`;
    select(0);
  };

  const onKey = (event: KeyboardEvent) => {
    if (!isPaletteOpen()) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === 'ArrowDown' || (event.ctrlKey && event.key === 'n')) {
      event.preventDefault();
      event.stopPropagation();
      select(index + 1);
      return;
    }
    if (event.key === 'ArrowUp' || (event.ctrlKey && event.key === 'p')) {
      event.preventDefault();
      event.stopPropagation();
      select(index - 1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      run(shown[index]);
    }
  };

  input.addEventListener('input', () => {
    shown = rank(entries, input.value);
    paint();
  });

  const host = h('div', { id: HOST_ID, class: 'betterslack-palette', role: 'dialog', 'aria-modal': 'true' }, [
    h('div', { class: 'betterslack-palette__box' }, [
      h('div', { class: 'betterslack-palette__search' }, [
        h('span', { class: 'betterslack-palette__search_icon' }, ['⌘']),
        input,
      ]),
      list,
      h('div', { class: 'betterslack-palette__footer' }, [footerAction, footerCount]),
    ]),
  ]);
  host.addEventListener('mousedown', (event) => {
    if (event.target === host) close();
  });

  document.body.append(host);
  // On `window`, in capture: Slack binds keydown there too, and anything on
  // `document` sees arrow keys only if Slack decides to pass them on.
  window.addEventListener('keydown', onKey, true);
  paint();
  queueMicrotask(() => input.focus());

  return close;
}
