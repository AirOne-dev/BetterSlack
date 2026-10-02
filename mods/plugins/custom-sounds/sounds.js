/**
 * What Custom Sounds knows about Slack's sounds, and the rules that decide
 * which one carries a custom sound. Pure: no DOM, no api, so every rule here
 * is a unit test rather than a hope.
 *
 * How it works, in one paragraph. Slack plays every notification sound in the
 * page, with `new Audio(url)` and `.play()`, from one table of thirteen files
 * -- and at that moment it says *which file*, never *what for*. So a custom
 * sound rides on a Slack sound: the slot's preference is set to a "carrier"
 * that no other slot in that workspace uses, and when the carrier is about to
 * play, the custom file plays instead. The carrier is the slot's previous sound
 * whenever that is free, which is what makes it the fallback too: a client
 * without this plugin -- another computer -- plays what you had before.
 */

/**
 * The six places in Preferences → Notifications where a sound is chosen, by
 * the name of the preference behind each. Read out of Slack's own bundle,
 * where each is a select with this `selectId`.
 */
export const SLOTS = [
  'desktop_sound',
  'priority_desktop_sound',
  'dm_arrival_sound',
  'dm_sent_sound',
  'huddle_invite_sound',
  'calendar_desktop_notification_sound',
];

/**
 * Slack's table, in Slack's order, with the names Slack gives them. `b2.mp3`
 * is "Ding" -- the file names and the labels have little to do with each other.
 */
export const SLACK_SOUNDS = [
  { value: 'b2.mp3', label: 'Ding' },
  { value: 'animal_stick.mp3', label: 'Boing' },
  { value: 'been_tree.mp3', label: 'Drop' },
  { value: 'complete_quest_requirement.mp3', label: 'Ta-da' },
  { value: 'confirm_delivery.mp3', label: 'Plink' },
  { value: 'flitterbug.mp3', label: 'Wow' },
  { value: 'here_you_go_lighter.mp3', label: 'Here you go' },
  { value: 'hi_flowers_hit.mp3', label: 'Hi' },
  { value: 'knock_brush.mp3', label: 'Knock Brush' },
  { value: 'save_and_checkout.mp3', label: 'Whoa!' },
  { value: 'item_pickup.mp3', label: 'Yoink' },
  { value: 'hummus.mp3', label: 'Hummus' },
  { value: 'boop.mp3', label: 'Boop' },
];

/*
 * What Slack calls each option, by index, in the languages BetterSlack
 * speaks -- read off Slack's own lists in Preferences, not translated here.
 * Index 0 is "None" (VIP's says "Same as messages sound" instead), 14 the
 * huddles' extra. Known labels are what lets a picker open without opening
 * Slack's list first, and what lets a select's own text say which option it
 * holds. A language not listed falls back to English and, where Slack's text
 * does not match, to reading Slack's list.
 */
export const OPTION_LABELS = {
  en: ['None', 'Ding', 'Boing', 'Drop', 'Ta-da', 'Plink', 'Wow', 'Here you go', 'Hi',
    'Knock Brush', 'Whoa!', 'Yoink', 'Hummus', 'Boop', 'Boop Plus'],
  fr: ['Aucun', 'Ding', 'Boing', 'Chute', 'Ta-da', 'Plink', 'Oh !', 'Et voilà', 'Bonjour',
    'Knock Brush', 'Waouh !', 'Yoink', 'Houmous', 'Bip', 'Bip plus'],
};
export const SAME_AS_MESSAGES = { en: 'Same as messages sound', fr: 'Identique au son des messages' };

/** Slack writes "Oh !" with a no-break space; compare words, not spacing. */
export const normalise = (text) => String(text ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/** The indices a slot's list has: huddles have one more. */
export function indicesFor(slot) {
  const last = slot === 'huddle_invite_sound' ? 14 : 13;
  return Array.from({ length: last + 1 }, (_, index) => index);
}

/** An option's label in `language`, English where that language is not listed. */
export function optionLabel(index, slot, language) {
  const lang = OPTION_LABELS[language] ? language : 'en';
  if (index === 0 && slot === 'priority_desktop_sound') return SAME_AS_MESSAGES[lang];
  return OPTION_LABELS[lang][index];
}

/** Which option a select's own text names, in any known language; null if none. */
export function indexFromText(text, slot) {
  const wanted = normalise(text);
  if (!wanted) return null;
  for (const language of Object.keys(OPTION_LABELS)) {
    for (const index of indicesFor(slot)) {
      if (normalise(optionLabel(index, slot, language)) === wanted) return index;
    }
  }
  return null;
}

/** Huddles offer one more, at the end of their list. */
export const HUDDLE_ONLY = { value: 'boop_remix.mp3', label: 'Boop Plus' };

export const NONE = 'none';

/*
 * Slack's selects number their options, and the number is the table's order:
 * option 0 is "None" (or "Same as messages" for VIP), option 1 is Ding, ...
 * option 13 is Boop, option 14 is the huddles' Boop Plus. Measured on every
 * select in Preferences → Notifications by choosing an option and reading the
 * URL Slack played: option 1 played b2-*.mp3, option 5 confirm_delivery-*.mp3.
 * So an option is identified by its index, never by its label, which is in
 * the reader's language.
 */
export function valueAt(index) {
  if (index === 0) return NONE;
  if (index === SLACK_SOUNDS.length + 1) return HUDDLE_ONLY.value;
  return SLACK_SOUNDS[index - 1]?.value ?? null;
}

export function indexOf(value) {
  if (value === NONE) return 0;
  if (value === HUDDLE_ONLY.value) return SLACK_SOUNDS.length + 1;
  const at = SLACK_SOUNDS.findIndex((sound) => sound.value === value);
  return at < 0 ? -1 : at + 1;
}

/** Where Slack starts a slot that has never been set, and where a fallback lands. */
export const DEFAULT_SOUND = 'b2.mp3';

const KNOWN = new Set([...SLACK_SOUNDS, HUDDLE_ONLY].map((sound) => sound.value));

export function isSlackSound(value) {
  return KNOWN.has(value);
}

/**
 * Which of Slack's sounds a URL is, or null.
 *
 * Slack's bundler fingerprints the files -- `knock_brush-ac2b6e8.mp3` -- and
 * the hash changes with every Slack release, so it is matched by the stem.
 * Only Slack's thirteen: a huddle's own join and leave sounds are not
 * anybody's choice and are left alone.
 */
export function soundFromUrl(url) {
  const match = /\/([a-z0-9_]+?)(?:-[0-9a-f]{5,})?\.mp3(?:[?#].*)?$/i.exec(String(url ?? ''));
  if (!match) return null;
  const value = `${match[1].toLowerCase()}.mp3`;
  return KNOWN.has(value) ? value : null;
}

/**
 * The Slack sound to carry `slot`'s custom sound, or null if none is free.
 *
 * `prefs` is what Slack has for every slot in this workspace; `assignments`
 * is what this plugin has put on top. Free means no other slot's preference
 * is that sound -- whether it is a real choice there or another carrier --
 * since a carrier shared with anything else plays the custom sound for both.
 * The slot's own previous sound comes first, because a carrier is also what
 * every client without this plugin goes on playing.
 */
export function allocateCarrier(slot, prefs, assignments = {}) {
  const used = new Set(
    SLOTS.filter((other) => other !== slot).map((other) => prefs[other]).filter(Boolean),
  );
  const previous = assignments[slot]?.previous ?? prefs[slot];
  const candidates = [previous, ...SLACK_SOUNDS.map((sound) => sound.value)];
  return candidates.find((value) => value !== NONE && isSlackSound(value) && !used.has(value)) ?? null;
}

/**
 * What has to change so that every custom slot still has a carrier of its
 * own. Answers a list of steps, applied in order:
 *
 *   { slot, drop: true }       the slot's preference was changed somewhere
 *                              else -- Slack on another computer, Slack's own
 *                              select -- to something that is not its carrier,
 *                              so somebody chose a Slack sound: let it be
 *   { slot, carrier }          two slots ended up on one sound: move the
 *                              custom one to a free carrier
 */
export function reconcile(prefs, assignments = {}) {
  const steps = [];
  const live = { ...assignments };
  for (const slot of SLOTS) {
    const assignment = live[slot];
    if (!assignment) continue;
    if (prefs[slot] !== undefined && prefs[slot] !== assignment.carrier) {
      steps.push({ slot, drop: true });
      delete live[slot];
    }
  }
  const working = { ...prefs };
  for (const slot of SLOTS) {
    const assignment = live[slot];
    if (!assignment) continue;
    const clash = SLOTS.some((other) => other !== slot && working[other] === assignment.carrier);
    if (!clash) continue;
    const carrier = allocateCarrier(slot, working, live);
    if (carrier && carrier !== assignment.carrier) {
      steps.push({ slot, carrier });
      working[slot] = carrier;
      live[slot] = { ...assignment, carrier };
    }
  }
  return steps;
}

/**
 * Where a slot goes when its custom sound is deleted: the sound it had before
 * the custom one, if that was one of Slack's, or Slack's default. Never
 * silence -- a deleted file is not somebody asking for no sound at all.
 */
export function fallbackFor(assignment) {
  const previous = assignment?.previous;
  if (previous === NONE) return NONE;
  return isSlackSound(previous) ? previous : DEFAULT_SOUND;
}

/** The custom sound playing in place of `value`, in a workspace's assignments. */
export function customFor(value, assignments = {}) {
  for (const slot of SLOTS) {
    if (assignments[slot]?.carrier === value) return assignments[slot].sound;
  }
  return null;
}

/** Files kept under a name of their own, so two picked files called "ding.mp3" never collide. */
export function fileNameFor(id, originalName) {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(String(originalName ?? ''))?.[1]?.toLowerCase() ?? 'mp3';
  return `${id}.${ext}`;
}

/** The label a picked file starts with: its name, without the extension. */
export function labelFor(originalName) {
  const stem = String(originalName ?? '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  return stem.slice(0, 60) || 'Sound';
}

/** What a picked file has to be. */
export const MAX_SOUND_BYTES = 5 * 1024 * 1024;
export const ACCEPT = '.mp3,.wav,.ogg,.oga,.opus,.m4a,.aac,.flac,.webm,audio/*';

export function checkFile(file) {
  if (!file) return 'none';
  if (file.size > MAX_SOUND_BYTES) return 'tooBig';
  const typed = /^audio\//.test(file.type ?? '');
  const named = /\.(mp3|wav|ogg|oga|opus|m4a|aac|flac|webm)$/i.test(file.name ?? '');
  return typed || named ? null : 'notAudio';
}
