// One keystroke for everything a mod can do.
//
// Every idea so far has meant another button in Slack's rail, and the rail is
// Slack's, not ours: three of them is already a lot and there is no room for
// twenty. A command palette is the answer every editor arrived at -- mods
// register what they can do, and ⌘K finds it by typing.
//
// It borrows Slack's own quick-switcher shape rather than inventing one, and
// renders in the light DOM with Slack's classes, so it follows every theme.

import { h, type Cleanup } from '../dom.js';

const HOST_ID = 'betterslack-palette';

export interface Command {
  /** Unique per mod; the runtime prefixes it with the mod id. */
  id: string;
  title: string;
  /** Where it comes from, shown beside the title. */
  source?: string;
  subtitle?: string;
  run: () => void | Promise<void>;
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
    const rest = `${command.source ?? ''} ${command.subtitle ?? ''}`.toLowerCase();
    let score = 0;
    let matched = true;
    for (const word of words) {
      if (title.startsWith(word)) score += 3;
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

/**
 * Open the palette over Slack.
 *
 * Arrow keys move, Enter runs, Escape closes -- and the list is rebuilt rather
 * than filtered in place, because the ordering changes with every keystroke and
 * a moving selection that stays on the same node is worse than none.
 */
export function openPalette(commands: Command[], labels: { placeholder: string; empty: string }): Cleanup {
  closePalette();

  let shown = rank(commands, '');
  let index = 0;

  const input = h('input', {
    class: 'betterslack-palette__input',
    type: 'text',
    placeholder: labels.placeholder,
    spellcheck: 'false',
    'aria-label': labels.placeholder,
  }) as HTMLInputElement;

  const list = h('div', { class: 'betterslack-palette__list', role: 'listbox' });

  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    document.getElementById(HOST_ID)?.remove();
  };

  const run = (command: Command | undefined) => {
    if (!command) return;
    close();
    void Promise.resolve(command.run()).catch((err: Error) => {
      console.error(`[betterslack] "${command.title}" failed`, err);
    });
  };

  const paint = () => {
    list.replaceChildren();
    if (shown.length === 0) {
      list.append(h('div', { class: 'betterslack-empty' }, [labels.empty]));
      return;
    }
    shown.forEach((command, position) => {
      const row = h('button', {
        class: 'c-button-unstyled betterslack-palette__row',
        type: 'button',
        role: 'option',
        'aria-selected': String(position === index),
      }, [
        h('span', { class: 'betterslack-palette__title' }, [command.title]),
        command.source ? h('span', { class: 'betterslack-palette__source' }, [command.source]) : null,
      ].filter(Boolean) as Node[]);
      if (command.subtitle) {
        row.append(h('span', { class: 'betterslack-palette__sub' }, [command.subtitle]));
      }
      row.addEventListener('click', () => run(command));
      // Hovering moves the selection, so the mouse and the keyboard never
      // disagree about what Enter would do.
      row.addEventListener('mouseenter', () => {
        index = position;
        for (const other of list.children) {
          other.setAttribute?.('aria-selected', String(other === row));
        }
      });
      list.append(row);
    });
  };

  const onKey = (event: KeyboardEvent) => {
    if (!isPaletteOpen()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (shown.length === 0) return;
      index = event.key === 'ArrowDown'
        ? (index + 1) % shown.length
        : (index - 1 + shown.length) % shown.length;
      paint();
      list.children[index]?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      run(shown[index]);
    }
  };

  input.addEventListener('input', () => {
    shown = rank(commands, input.value);
    index = 0;
    paint();
  });

  const host = h('div', { id: HOST_ID, class: 'betterslack-palette', role: 'dialog', 'aria-modal': 'true' }, [
    h('div', { class: 'betterslack-palette__box' }, [input, list]),
  ]);
  host.addEventListener('mousedown', (event) => {
    if (event.target === host) close();
  });

  document.body.append(host);
  document.addEventListener('keydown', onKey, true);
  paint();
  queueMicrotask(() => input.focus());

  return close;
}
