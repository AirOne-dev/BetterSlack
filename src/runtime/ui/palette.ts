// One keystroke for everything, in the shape Raycast made obvious.
//
// What makes that shape work is not decoration. Every row carries a picture of
// what it is, rows sit under headings, the category lives on the right so the
// title can stay short, and a footer keeps saying which key does what. A flat
// list of identical rows reads as a wall, which is what the first version was.
//
// Three things learned the hard way here:
//
//   * Slack binds keydown on `window` in the capture phase, which runs before
//     anything on `document`. Arrow keys were being eaten before they arrived.
//     This listens on `window`, in capture, like every other shortcut we bind.
//   * Moving the selection must not rebuild the list. Rebuilding two hundred
//     rows per keypress is slow enough to feel broken, and it drops the node
//     the pointer is over.
//   * A list that can only show what was loaded at boot is a list people stop
//     trusting: typing a colleague's name and being told nothing matches, when
//     Slack's own switcher finds them, is the end of it. So the source is a
//     function of the query, and `refresh()` lets whoever supplied it paint
//     again when the network answers.

import { h, type Cleanup } from '../dom.js';

const HOST_ID = 'betterslack-palette';

/**
 * A status after the title, when the row carries one.
 *
 * The emoji only when it resolved to a picture; the sentence is the part that
 * always carries meaning, and a shortcode nothing could draw is never printed
 * -- the same rule `api.slack.statusNode` follows, for the same reason.
 */
function statusFor(command: Command): HTMLElement | null {
  const status = command.status;
  if (!status || (!status.imageUrl && !status.text)) return null;
  return h('span', { class: 'betterslack-palette__status', title: status.text ?? '' }, [
    status.imageUrl
      ? h('img', { class: 'betterslack-palette__status_emoji', src: status.imageUrl, alt: status.emoji ?? '' })
      : null,
    status.text ? h('span', { class: 'betterslack-palette__status_text' }, [status.text]) : null,
  ].filter(Boolean) as Node[]);
}

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
  /**
   * Keep this entry whatever the query is.
   *
   * For rows a provider has already matched server-side: a person found by
   * their email would otherwise be filtered out again by a ranking that only
   * reads what is on screen.
   */
  always?: boolean;
  /**
   * Somebody's Slack status, drawn after the title the way Slack draws it.
   *
   * Separate from `subtitle` because it is a picture and a sentence rather than
   * a line of text, and separate from `icon` because that is already the
   * person's face. `api.slack.describeStatus` produces exactly this shape.
   */
  status?: { imageUrl?: string | null; emoji?: string | null; text?: string } | null;
  run: () => void | Promise<void>;
}

/**
 * A prefix that narrows the list to one kind of thing.
 *
 * Typing the prefix turns it into a chip in front of the field, so the mode is
 * visible rather than remembered, and Backspace on an empty query takes it off
 * again -- the same gesture that removes a word.
 */
export interface PaletteMode {
  id: string;
  /** One character, typed first: `/`, `@`, `#`. */
  prefix: string;
  /** The chip, and the empty-state hint. */
  label: string;
  placeholder?: string;
}

export interface PaletteLabels {
  placeholder: string;
  empty: string;
  /** Footer hints, e.g. "open" and "close". */
  openHint?: string;
  closeHint?: string;
  /** Shown while a source is still answering. */
  searching?: string;
  modes?: PaletteMode[];
}

/**
 * What to show: a fixed list, or a function of what has been typed.
 *
 * A function is called on every keystroke and may return a promise; only the
 * answer to the latest query is painted. Returning synchronously is what makes
 * a palette feel instant, so a provider that has local results should hand them
 * back at once and call `refresh()` when anything slower arrives.
 */
export type PaletteSource =
  | Command[]
  | ((query: string, mode: string | null) => Command[] | Promise<Command[]>);

/** The cleanup, with a way to paint again while it is open. */
export interface PaletteHandle extends Cleanup {
  refresh(): void;
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

  const scored: Array<{ command: Command; score: number; order: number }> = [];
  commands.forEach((command, order) => {
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
    // A provider that matched server-side keeps its row even when nothing on
    // screen contains the query -- an email, a real name behind a nickname.
    if (!matched && command.always) {
      matched = true;
      score = 1;
    }
    if (matched) scored.push({ command, score, order });
  });
  // Ties keep the order they were given in, so a provider still decides what
  // comes first among equals.
  return scored
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((entry) => entry.command);
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
    return h('img', { class: 'betterslack-palette__icon', src: icon, alt: '', loading: 'lazy' });
  }
  const box = h('span', { class: 'betterslack-palette__icon betterslack-palette__icon--glyph' });
  box.textContent = icon && icon.length <= 2 ? icon : command.title.slice(0, 1).toUpperCase();
  return box;
}

/**
 * Open the palette over Slack.
 *
 * Returns a cleanup, so a plugin being switched off takes its palette with it,
 * with `refresh()` on it for the answers that arrive late.
 */
export function openPalette(source: PaletteSource, labels: PaletteLabels): PaletteHandle {
  closePalette();

  const modes = labels.modes ?? [];
  let mode: PaletteMode | null = null;
  let query = '';
  let shown: Command[] = [];
  let index = 0;
  /** The row for each visible entry, so selection can move without rebuilding. */
  let rows: HTMLElement[] = [];
  /** Only the answer to the newest query is allowed to paint. */
  let generation = 0;

  const input = h('input', {
    class: 'betterslack-palette__input',
    type: 'text',
    placeholder: labels.placeholder,
    spellcheck: 'false',
    'aria-label': labels.placeholder,
  }) as HTMLInputElement;

  const chip = h('span', { class: 'betterslack-palette__chip', hidden: 'hidden' });
  const list = h('div', { class: 'betterslack-palette__list', role: 'listbox' });
  const footerAction = h('span', { class: 'betterslack-palette__hint' });
  const footerCount = h('span', { class: 'betterslack-palette__count' });

  const close = (() => {
    window.removeEventListener('keydown', onKey, true);
    document.getElementById(HOST_ID)?.remove();
  }) as PaletteHandle;

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
  };

  /*
   * The modes, as something to read rather than something to know.
   *
   * Under the list rather than inside it, so it does not scroll away and does
   * not move when results arrive: a hint that appears and disappears while you
   * type is a hint you learn to ignore. It is only up while there is nothing
   * typed -- once you are searching, the room belongs to the results.
   */
  const modesBar = h('div', { class: 'betterslack-palette__modes' },
    modes.map((entry) => {
      const button = h('button', { class: 'betterslack-palette__mode', type: 'button' }, [
        h('kbd', {}, [entry.prefix]),
        entry.label,
      ]);
      button.addEventListener('click', () => {
        input.value = entry.prefix;
        onInput();
        input.focus();
      });
      return button;
    }));
  if (modes.length === 0) modesBar.setAttribute('hidden', 'hidden');

  const paint = (entries: Command[]) => {
    shown = entries;
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
            h('span', { class: 'betterslack-palette__titleline' }, [
              h('span', { class: 'betterslack-palette__title' }, [command.title]),
              statusFor(command),
            ].filter(Boolean) as Node[]),
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
    footerAction.textContent = `↵ ${labels.openHint ?? 'open'} · esc ${labels.closeHint ?? 'close'}`;
    select(0);
  };

  /** Ask the source, then rank what it gave back against what was typed. */
  const update = () => {
    if (modes.length > 0) {
      if (!mode && query === '') modesBar.removeAttribute('hidden');
      else modesBar.setAttribute('hidden', 'hidden');
    }
    const mine = ++generation;
    const answer = typeof source === 'function' ? source(query, mode?.id ?? null) : source;

    if (Array.isArray(answer)) {
      paint(rank(answer, query));
      return;
    }
    // Still showing the previous answer, which is better than an empty list
    // that fills in: the rows under the pointer stop moving.
    footerCount.textContent = labels.searching ?? '…';
    void answer.then((entries) => {
      if (mine !== generation || !isPaletteOpen()) return;
      paint(rank(entries, query));
    });
  };

  /** Split what was typed into a mode and the rest of the query. */
  const onInput = () => {
    const raw = input.value;
    if (!mode) {
      const found = modes.find((entry) => raw.startsWith(entry.prefix));
      if (found) {
        mode = found;
        input.value = raw.slice(found.prefix.length);
        chip.textContent = found.label;
        chip.removeAttribute('hidden');
        input.placeholder = found.placeholder ?? labels.placeholder;
      }
    }
    query = input.value.trim();
    update();
  };

  const clearMode = () => {
    mode = null;
    chip.setAttribute('hidden', 'hidden');
    chip.textContent = '';
    input.placeholder = labels.placeholder;
    query = '';
    update();
  };

  function onKey(event: KeyboardEvent): void {
    if (!isPaletteOpen()) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      // Escape steps out of the mode first, then closes: one key, two depths,
      // the way every search field with a filter behaves.
      if (mode) clearMode();
      else close();
      return;
    }
    if (event.key === 'Backspace' && mode && input.value === '') {
      event.preventDefault();
      clearMode();
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
    if (event.key === 'Home' && !event.shiftKey && input.value === '') {
      select(0);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      run(shown[index]);
    }
  }

  input.addEventListener('input', onInput);

  const host = h('div', { id: HOST_ID, class: 'betterslack-palette', role: 'dialog', 'aria-modal': 'true' }, [
    h('div', { class: 'betterslack-palette__box' }, [
      h('div', { class: 'betterslack-palette__search' }, [
        h('span', { class: 'betterslack-palette__search_icon' }, ['⌘']),
        chip,
        input,
      ]),
      list,
      modesBar,
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
  update();
  queueMicrotask(() => input.focus());

  close.refresh = () => {
    if (isPaletteOpen()) update();
  };
  return close;
}
