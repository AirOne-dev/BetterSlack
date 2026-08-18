// The shortcuts the palette answers to, and the box for choosing them.
//
// One was never enough. ⌘K is the key everyone reaches for and it is also
// Slack's own quick switcher, so the honest offer is not "pick one of the two
// we thought of" -- it is "bind whatever you like, as many as you like, and if
// Slack has that key already you take it from it".
//
// Taking it is not a metaphor: `api.helpers.hotkey` listens in the capture
// phase on `window` and calls preventDefault, so the key never reaches the
// handlers Slack binds on document. That is what makes ⌘K work at all.

/** What a combo looks like once it is written down. */
const CLEAN = /^(mod\+|cmd\+|meta\+|ctrl\+|shift\+|alt\+|option\+)*[a-z0-9]+$|^(escape|enter|tab|space|f\d{1,2})$/i;

/** Split what is stored into combos, dropping anything that is not one. */
export function parseShortcuts(value, fallback = 'mod+k') {
  const list = String(value ?? '')
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part && CLEAN.test(part));
  // Never leave the palette unreachable: a setting emptied by hand or filled
  // with nonsense falls back to the one everybody knows.
  return list.length ? [...new Set(list)] : [fallback];
}

/** A keyboard event, as the combo string `api.helpers.hotkey` parses. */
export function comboOf(event) {
  const key = String(event.key ?? '').toLowerCase();
  // A modifier on its own is somebody still pressing the combination.
  if (['control', 'shift', 'alt', 'meta', 'os', 'dead'].includes(key)) return null;

  const parts = [];
  // `mod` is ⌘ on a Mac and Ctrl elsewhere, and the helper matches either --
  // which is what makes a shortcut somebody records here work on both.
  if (event.metaKey || event.ctrlKey) parts.push('mod');
  if (event.shiftKey) parts.push('shift');
  if (event.altKey) parts.push('alt');

  const named = { ' ': 'space', escape: 'escape', enter: 'enter', tab: 'tab' }[key];
  const name = named ?? (key.length === 1 ? key : /^f\d{1,2}$/.test(key) ? key : null);
  if (!name) return null;
  if (!parts.length && !['escape', 'tab'].includes(name) && !/^f\d/.test(name)) {
    // A bare letter would fire while somebody is typing a message.
    return null;
  }
  parts.push(name);
  return parts.join('+');
}

/**
 * The box where they are chosen.
 *
 * A text field would have been less code and worse: nobody knows whether this
 * project spells it `cmd+shift+p` or `Meta+Shift+P`, and finding out by trial
 * is a poor way to spend an evening. So the field records what you press.
 */
export function openShortcutEditor(api, t, { current, onSave }) {
  const list = [...current];
  const chips = api.dom.h('div', { class: 'sm-shortcut-chips' });
  const field = api.dom.h('button', { class: 'sm-shortcut-field', type: 'button' }, [t('recorderIdle')]);
  let recording = false;

  const paint = () => {
    chips.replaceChildren();
    for (const combo of list) {
      const remove = api.dom.h('button', {
        class: 'c-button-unstyled sm-shortcut-chip__remove',
        type: 'button',
        'aria-label': t('remove'),
      }, ['×']);
      remove.addEventListener('click', () => {
        list.splice(list.indexOf(combo), 1);
        paint();
      });
      chips.append(api.dom.h('span', { class: 'sm-shortcut-chip' }, [
        api.helpers.describeHotkey(combo),
        remove,
      ]));
    }
    if (!list.length) chips.append(api.dom.h('span', { class: 'betterslack-hint' }, [t('recorderEmpty')]));
  };
  paint();

  const onKey = (event) => {
    if (!recording) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === 'Escape') {
      recording = false;
      field.textContent = t('recorderIdle');
      return;
    }
    const combo = comboOf(event);
    if (!combo) return;
    recording = false;
    field.textContent = t('recorderIdle');
    if (!list.includes(combo)) list.push(combo);
    paint();
  };
  // Capture, and on window: the point is to catch keys Slack would otherwise
  // take, which is the whole reason somebody is in this box.
  window.addEventListener('keydown', onKey, true);

  field.addEventListener('click', () => {
    recording = true;
    field.textContent = t('recorderListening');
  });

  const dialog = api.ui.modal({
    title: t('shortcutsTitle'),
    subtitle: t('shortcutsHint'),
    content: api.dom.h('div', {}, [field, chips]),
    width: 460,
    actions: [
      { label: t('cancel'), onClick: () => true },
      {
        label: t('save'),
        variant: 'primary',
        onClick: () => {
          onSave(list.length ? list : ['mod+k']);
          return true;
        },
      },
    ],
    onClose: () => window.removeEventListener('keydown', onKey, true),
  });
  return dialog;
}
