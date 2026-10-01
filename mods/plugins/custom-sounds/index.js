/**
 * Custom Sounds — your own files in every sound picker Slack has.
 *
 * Preferences → Notifications has six of them (messages, VIP, direct messages
 * arriving and leaving, huddles, calendar). Each is redrawn here as the same
 * select with Slack's sounds, the sounds you added, and "Add a sound…" at the
 * bottom, which opens a file picker. Added files are kept on this computer
 * through api.data; nothing is uploaded.
 *
 * How a custom sound gets played is in sounds.js: it rides on a Slack sound
 * (the "carrier") and is swapped in when Slack is about to play that one.
 * Deleting a sound asks first and puts every slot that used it back on the
 * sound it had before.
 */

import {
  ACCEPT,
  NONE,
  SLOTS,
  allocateCarrier,
  checkFile,
  customFor,
  fallbackFor,
  fileNameFor,
  indexOf,
  labelFor,
  reconcile,
  soundFromUrl,
  valueAt,
} from './sounds.js';

const STRINGS = {
  en: {
    yourSounds: 'Your sounds',
    add: 'Add a sound…',
    manage: 'Manage your sounds…',
    added: '“{name}” added',
    tooBig: 'That file is over 5 MB. A notification sound is a second or two.',
    notAudio: 'That is not a sound file (mp3, wav, ogg, m4a, flac…).',
    unplayable: 'That file could not be played.',
    noCarrier: 'Every Slack sound is already in use here, so this one cannot be told apart.',
    openPrefs: 'Choose it from Preferences → Notifications: that is where Slack keeps its sound lists.',
    manageTitle: 'Your sounds',
    manageSubtitle: 'Kept on this computer only. Nothing is uploaded.',
    empty: 'No sounds added yet. Pick “Add a sound…” in any sound list in Preferences → Notifications.',
    play: 'Play',
    rename: 'Rename',
    delete: 'Delete',
    close: 'Close',
    usedBy: 'Used for: {slots}',
    unused: 'Not used anywhere',
    deleteTitle: 'Delete “{name}”?',
    deleteMessage: 'The file is removed from this computer.',
    deleteFallback: 'The file is removed from this computer, and these go back to the sound they had before: {slots}.',
    cancel: 'Cancel',
    deleted: '“{name}” deleted',
    fallbackLater: '{slots}: back on the previous sound the next time Preferences → Notifications is open.',
    missing: '“{name}” was missing from disk; its slots are back on their previous sound',
    commandTitle: 'Manage custom sounds',
    commandSubtitle: 'Add, play, rename or delete your notification sounds',
    slot_desktop_sound: 'Messages',
    slot_priority_desktop_sound: 'VIP',
    slot_dm_arrival_sound: 'Direct message received',
    slot_dm_sent_sound: 'Message sent',
    slot_huddle_invite_sound: 'Huddles',
    slot_calendar_desktop_notification_sound: 'Calendar',
  },
  fr: {
    yourSounds: 'Vos sons',
    add: 'Ajouter un son…',
    manage: 'Gérer vos sons…',
    added: '« {name} » ajouté',
    tooBig: 'Ce fichier dépasse 5 Mo. Un son de notification dure une seconde ou deux.',
    notAudio: 'Ce n’est pas un fichier audio (mp3, wav, ogg, m4a, flac…).',
    unplayable: 'Ce fichier n’a pas pu être lu.',
    noCarrier: 'Tous les sons de Slack sont déjà utilisés ici, celui-ci ne pourrait pas être distingué.',
    openPrefs: 'Choisissez-le depuis Préférences → Notifications : c’est là que Slack garde ses listes de sons.',
    manageTitle: 'Vos sons',
    manageSubtitle: 'Conservés sur cet ordinateur uniquement. Rien n’est envoyé.',
    empty: 'Aucun son ajouté. Choisissez « Ajouter un son… » dans une liste de sons, dans Préférences → Notifications.',
    play: 'Écouter',
    rename: 'Renommer',
    delete: 'Supprimer',
    close: 'Fermer',
    usedBy: 'Utilisé pour : {slots}',
    unused: 'Utilisé nulle part',
    deleteTitle: 'Supprimer « {name} » ?',
    deleteMessage: 'Le fichier est retiré de cet ordinateur.',
    deleteFallback: 'Le fichier est retiré de cet ordinateur, et ces emplacements reprennent le son qu’ils avaient avant : {slots}.',
    cancel: 'Annuler',
    deleted: '« {name} » supprimé',
    fallbackLater: '{slots} : retour au son précédent à la prochaine ouverture de Préférences → Notifications.',
    missing: '« {name} » manquait sur le disque ; ses emplacements ont repris leur son précédent',
    commandTitle: 'Gérer les sons personnalisés',
    commandSubtitle: 'Ajouter, écouter, renommer ou supprimer vos sons de notification',
    slot_desktop_sound: 'Messages',
    slot_priority_desktop_sound: 'VIP',
    slot_dm_arrival_sound: 'Message direct reçu',
    slot_dm_sent_sound: 'Message envoyé',
    slot_huddle_invite_sound: 'Appels d’équipe',
    slot_calendar_desktop_notification_sound: 'Calendrier',
  },
};

const CHECK = '<svg viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M15.7 5.3a1 1 0 0 1 0 1.4l-7 7a1 1 0 0 1-1.4 0l-3-3a1 1 0 1 1 1.4-1.4L8 11.6l6.3-6.3a1 1 0 0 1 1.4 0Z"/></svg>';
const NOTE = '<svg viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M15.5 2.6a.75.75 0 0 1 .5.7v9.95a2.75 2.75 0 1 1-1.5-2.45V5.85l-6 1.5v7.4a2.75 2.75 0 1 1-1.5-2.45V4.8a.75.75 0 0 1 .57-.73l7.5-1.87a.75.75 0 0 1 .43.4Z"/></svg>';
const PLUS = '<svg viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M10 3.5a.75.75 0 0 1 .75.75v5h5a.75.75 0 0 1 0 1.5h-5v5a.75.75 0 0 1-1.5 0v-5h-5a.75.75 0 0 1 0-1.5h5v-5A.75.75 0 0 1 10 3.5Z"/></svg>';
const GEAR = '<svg viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm-1.5 3a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Zm.6-7.5h1.8l.4 1.9 1.2.5 1.6-1.1 1.3 1.3-1.1 1.6.5 1.2 1.9.4v1.8l-1.9.4-.5 1.2 1.1 1.6-1.3 1.3-1.6-1.1-1.2.5-.4 1.9H9.1l-.4-1.9-1.2-.5-1.6 1.1-1.3-1.3 1.1-1.6-.5-1.2-1.9-.4V9.1l1.9-.4.5-1.2-1.1-1.6 1.3-1.3 1.6 1.1 1.2-.5.4-1.9Z"/></svg>';

/** Marks an <audio> this plugin made, so its own play() is not intercepted. */
const OURS = Symbol('custom-sounds');

/*
 * Slack's select, found by the preference it edits. Slack renders each picker
 * with that name as its `selectId`; which attribute it lands on is the
 * selector's business, so both are asked.
 */
const slotSelector = (slot) => `#${slot}, [data-qa="${slot}"], [data-qa="${slot}_select"]`;
const ALL_SLOTS = SLOTS.map(slotSelector).join(', ');

export default {
  async start(api) {
    const t = api.i18n.strings(STRINGS);
    const disposers = [];

    /** Your sounds: { id, label, file }. The files themselves are in api.data. */
    let sounds = api.settings.get('sounds', []);
    /** Per workspace: { [teamId]: { [slot]: { sound, carrier, previous } } }. */
    let assignments = api.settings.get('assignments', {});
    /**
     * Per workspace, the Slack value a slot has to go back to the next time
     * Preferences is open -- a fallback that could not be written at the
     * moment a sound was deleted, because Slack's selects were not there.
     */
    let pending = api.settings.get('pending', {});
    /** Set while this plugin clicks an option itself, so Slack's preview of it is not heard. */
    let quietUntil = 0;
    /** A playable URL per custom sound, made once from its kept file. */
    const urls = new Map();

    const team = () => api.slack.currentTeamId() ?? 'default';
    const mine = (teamId = team()) => assignments[teamId] ?? {};
    const soundById = (id) => sounds.find((sound) => sound.id === id);
    const slotLabel = (slot) => t(`slot_${slot}`);

    const saveSounds = () => api.settings.set('sounds', sounds);
    const saveAssignments = () => api.settings.set('assignments', assignments);
    const setAssignment = (teamId, slot, value) => {
      const forTeam = { ...(assignments[teamId] ?? {}) };
      if (value) forTeam[slot] = value;
      else delete forTeam[slot];
      assignments = { ...assignments, [teamId]: forTeam };
    };

    /* -- the files ------------------------------------------------------- */

    async function urlFor(id) {
      if (urls.has(id)) return urls.get(id);
      const sound = soundById(id);
      const blob = sound ? await api.data.read(sound.file).catch(() => null) : null;
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      urls.set(id, url);
      return url;
    }

    function preview(url) {
      if (!url) return;
      const audio = new Audio(url);
      audio[OURS] = true;
      Promise.resolve().then(() => audio.play()).catch(() => undefined);
    }

    /* -- Slack's own selects --------------------------------------------- */

    /*
     * Where each sound is stored is Slack's business, and it is not one place:
     * messages and VIP live in one store, the two accessibility sounds in this
     * computer's client store, huddles under a preference of their own. None
     * of that is reachable from a mod, and all of it is reachable from Slack's
     * own select -- so a choice is made by opening that select and clicking
     * the option, the way a person would, with the list kept invisible while
     * it happens. Slack then writes the preference wherever it keeps it.
     *
     * Which is also why choosing works only while Preferences is open: the
     * selects exist only then. Anything that has to change Slack's choice at
     * another moment waits in `pending` until they are back.
     */
    const button = (slot) => document.getElementById(`${slot}_button`);
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    async function withList(slot, work) {
      const trigger = button(slot);
      if (!trigger) return null;
      document.documentElement.classList.add('betterslack-custom-sounds-busy');
      try {
        trigger.click();
        let list = null;
        for (let i = 0; i < 20 && !list; i += 1) {
          await sleep(30);
          list = document.querySelector('.c-select_options_list[role="listbox"], [role="listbox"]');
        }
        if (!list) return null;
        return await work(list);
      } finally {
        // Closed if the work left it open; a click on an option closes it already.
        if (document.querySelector('[role="listbox"]')) {
          trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await sleep(30);
          if (document.querySelector('[role="listbox"]')) trigger.click();
        }
        await sleep(30);
        document.documentElement.classList.remove('betterslack-custom-sounds-busy');
      }
    }

    /** The options of a slot's select: { index, label, selected }. */
    const readOptions = (slot) => withList(slot, async (list) => {
      const seen = new Map();
      // The list is virtualised: what is rendered is a window of it, so it is
      // walked top to bottom to see every option once.
      for (const top of [0, list.scrollHeight / 2, list.scrollHeight]) {
        list.scrollTop = top;
        await sleep(20);
        for (const option of list.querySelectorAll('[role="option"]')) {
          const index = Number(/_option_(\d+)$/.exec(option.getAttribute('data-qa') ?? option.id)?.[1]);
          if (Number.isNaN(index)) continue;
          seen.set(index, {
            index,
            label: option.textContent.trim(),
            selected: option.getAttribute('aria-selected') === 'true',
          });
        }
      }
      return [...seen.values()].sort((a, b) => a.index - b.index);
    });

    /** Click option `index` in a slot's select. `quiet` swallows Slack's preview of it. */
    async function selectIndex(slot, index, { quiet = false } = {}) {
      quietUntil = quiet ? Date.now() + 1500 : 0;
      const done = await withList(slot, async (list) => {
        for (const top of [list.scrollTop, 0, list.scrollHeight / 2, list.scrollHeight]) {
          list.scrollTop = top;
          await sleep(20);
          const option = list.querySelector(`[data-qa="${slot}_option_${index}"], #${slot}_option_${index}`);
          if (option) {
            option.click();
            return true;
          }
        }
        return false;
      });
      await sleep(120);
      return Boolean(done);
    }

    /** Labels, in the reader's language, by option index -- the same in every select. */
    const labels = new Map();
    /**
     * Each slot's options, read once when Preferences comes up, so a picker
     * opens on the click rather than after a round trip through Slack's list.
     */
    const optionsBySlot = new Map();
    function learnLabels(options) {
      for (const option of options ?? []) if (option.index > 0) labels.set(option.label, option.index);
    }

    /** What every slot holds right now, as Slack values, read off the selects' own text. */
    function currentValues() {
      const values = {};
      for (const slot of SLOTS) {
        const text = button(slot)?.textContent.trim();
        if (!text) continue;
        values[slot] = labels.has(text) ? valueAt(labels.get(text)) : NONE;
      }
      return values;
    }

    /** Give a slot one of Slack's own options. */
    async function chooseSlack(slot, index) {
      if (!(await selectIndex(slot, index))) {
        api.ui.toast(t('openPrefs'), { variant: 'warning' });
        return;
      }
      setAssignment(team(), slot, null);
      await saveAssignments();
      refreshButtons();
    }

    /** Give a slot one of your sounds, through a carrier. */
    async function chooseCustom(slot, id) {
      const teamId = team();
      const options = await readOptions(slot);
      if (!options?.length) {
        api.ui.toast(t('openPrefs'), { variant: 'warning' });
        return;
      }
      learnLabels(options);
      const selected = options.find((option) => option.selected)?.index ?? 0;
      const existing = mine(teamId)[slot];
      // The sound to come back to is the last real choice, never a carrier.
      const previous = existing?.previous ?? valueAt(selected);
      const values = currentValues();
      const carrier = allocateCarrier(slot, values, { ...mine(teamId), [slot]: { previous } });
      if (!carrier) {
        api.ui.toast(t('noCarrier'), { variant: 'error' });
        return;
      }
      if (valueAt(selected) !== carrier && !(await selectIndex(slot, indexOf(carrier), { quiet: true }))) {
        api.ui.toast(t('openPrefs'), { variant: 'warning' });
        return;
      }
      setAssignment(teamId, slot, { sound: id, carrier, previous });
      await saveAssignments();
      preview(await urlFor(id));
      refreshButtons();
    }

    /**
     * Preferences just came up: catch up on what had to wait for it, and let
     * go of any slot whose carrier is no longer what Slack holds -- somebody
     * chose a sound by other means, and that choice wins.
     */
    async function onPrefsShown() {
      for (const slot of SLOTS) {
        if (!button(slot)) continue;
        const options = await readOptions(slot);
        if (options?.length) optionsBySlot.set(slot, options);
        learnLabels(options);
      }
      const teamId = team();
      const waiting = pending[teamId] ?? {};
      for (const [slot, value] of Object.entries(waiting)) {
        if (!button(slot)) continue;
        if (await selectIndex(slot, indexOf(value), { quiet: true })) delete waiting[slot];
      }
      pending = { ...pending, [teamId]: waiting };
      await api.settings.set('pending', pending);
      const values = currentValues();
      let changed = false;
      for (const step of reconcile(values, mine(teamId))) {
        if (step.drop) {
          setAssignment(teamId, step.slot, null);
          changed = true;
        }
      }
      if (changed) await saveAssignments();
      refreshButtons();
    }

    /* -- adding, deleting ------------------------------------------------ */

    function pickFile() {
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = ACCEPT;
        input.style.display = 'none';
        input.addEventListener('change', () => {
          resolve(input.files?.[0] ?? null);
          input.remove();
        }, { once: true });
        input.addEventListener('cancel', () => {
          resolve(null);
          input.remove();
        }, { once: true });
        document.body.append(input);
        input.click();
      });
    }

    /** True if the browser can decode it; a renamed .txt is refused here. */
    function canPlay(blob) {
      return new Promise((resolve) => {
        const url = URL.createObjectURL(blob);
        const audio = new Audio();
        audio[OURS] = true;
        const done = (ok) => {
          URL.revokeObjectURL(url);
          resolve(ok);
        };
        audio.addEventListener('canplaythrough', () => done(true), { once: true });
        audio.addEventListener('loadedmetadata', () => done(true), { once: true });
        audio.addEventListener('error', () => done(false), { once: true });
        setTimeout(() => done(false), 5000);
        audio.src = url;
        audio.load();
      });
    }

    async function addSound(forSlot) {
      const file = await pickFile();
      if (!file) return null;
      const problem = checkFile(file);
      if (problem) {
        api.ui.toast(t(problem), { variant: 'error' });
        return null;
      }
      if (!(await canPlay(file))) {
        api.ui.toast(t('unplayable'), { variant: 'error' });
        return null;
      }
      const id = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const kept = await api.data.write(fileNameFor(id, file.name), file);
      const sound = { id, label: labelFor(file.name), file: kept.name };
      sounds = [...sounds, sound];
      await saveSounds();
      api.ui.toast(t('added', { name: sound.label }), { variant: 'success' });
      if (forSlot) await chooseCustom(forSlot, id);
      return sound;
    }

    /** Every slot, in every workspace, that plays this sound. */
    function usesOf(id) {
      const uses = [];
      for (const [teamId, forTeam] of Object.entries(assignments)) {
        for (const slot of SLOTS) if (forTeam[slot]?.sound === id) uses.push({ teamId, slot });
      }
      return uses;
    }

    /**
     * Take a sound away and put every slot that used it back on the sound it
     * had before.
     *
     * Most of the time there is nothing to write: the carrier *is* the
     * previous sound whenever that was free, so letting go of the custom file
     * is the fallback. When it was not -- two slots had the same sound -- Slack
     * has to be told, and that needs its select: written now if Preferences
     * is open, and the next time it is otherwise.
     */
    async function release(id) {
      const here = team();
      const waiting = [];
      for (const { teamId, slot } of usesOf(id)) {
        const assignment = mine(teamId)[slot];
        const fallback = fallbackFor(assignment);
        setAssignment(teamId, slot, null);
        if (fallback === assignment.carrier) continue;
        const done = teamId === here && button(slot)
          && (await selectIndex(slot, indexOf(fallback), { quiet: true }));
        if (!done) {
          pending = { ...pending, [teamId]: { ...(pending[teamId] ?? {}), [slot]: fallback } };
          waiting.push(slotLabel(slot));
        }
      }
      await saveAssignments();
      await api.settings.set('pending', pending);
      return waiting;
    }

    async function deleteSound(id) {
      const sound = soundById(id);
      if (!sound) return false;
      const uses = usesOf(id);
      const slots = [...new Set(uses.map((use) => slotLabel(use.slot)))].join(', ');
      const ok = await api.ui.confirm({
        title: t('deleteTitle', { name: sound.label }),
        message: uses.length ? t('deleteFallback', { slots }) : t('deleteMessage'),
        confirmLabel: t('delete'),
        cancelLabel: t('cancel'),
        danger: true,
      });
      if (!ok) return false;
      const waiting = await release(id);
      await api.data.remove(sound.file).catch(() => undefined);
      const url = urls.get(id);
      if (url) URL.revokeObjectURL(url);
      urls.delete(id);
      sounds = sounds.filter((other) => other.id !== id);
      await saveSounds();
      refreshButtons();
      api.ui.toast(t('deleted', { name: sound.label }), { variant: 'success' });
      if (waiting.length) api.ui.toast(t('fallbackLater', { slots: waiting.join(', ') }), { variant: 'info', duration: 6000 });
      return true;
    }

    /** A file that vanished from disk is a deletion nobody confirmed: fall back, and say so. */
    async function checkFiles() {
      const kept = new Set((await api.data.list().catch(() => [])).map((entry) => entry.name));
      for (const sound of [...sounds]) {
        if (kept.has(sound.file)) continue;
        await release(sound.id);
        sounds = sounds.filter((other) => other.id !== sound.id);
        api.ui.toast(t('missing', { name: sound.label }), { variant: 'warning' });
      }
      await saveSounds();
    }

    /* -- the swap -------------------------------------------------------- */

    /*
     * Slack plays a sound by calling play() on an <audio> it keeps per URL.
     * The prototype is patched rather than the constructor: Slack makes some
     * of those elements before any mod runs, and every one of them still looks
     * play() up on the prototype when it is called.
     *
     * A carrier about to play starts the custom file instead, with the same
     * volume, loop and output device; Slack's own element is never touched,
     * so switching the plugin off leaves nothing to undo. pause() is patched
     * for the same reason: a huddle rings in a loop until Slack pauses it, and
     * the custom ring has to stop with it.
     */
    const originalPlay = HTMLMediaElement.prototype.play;
    const originalPause = HTMLMediaElement.prototype.pause;
    const stand = new WeakMap();

    function customUrlFor(element) {
      const src = element.currentSrc || element.src;
      const value = soundFromUrl(src);
      if (!value) return { value: null, id: null };
      // This workspace first; then any other, since notifications from every
      // signed-in workspace play in this one window.
      let id = customFor(value, mine());
      if (!id) {
        for (const forTeam of Object.values(assignments)) {
          id = customFor(value, forTeam);
          if (id) break;
        }
      }
      return { value, id };
    }

    HTMLMediaElement.prototype.play = function play(...args) {
      if (this[OURS] || !(this instanceof HTMLAudioElement)) return originalPlay.apply(this, args);
      const { value, id } = customUrlFor(this);
      // This plugin clicking an option makes Slack preview it; that preview is
      // the carrier, which is exactly the sound the person did not choose.
      if (value && Date.now() < quietUntil) return Promise.resolve();
      const url = id && urls.get(id);
      // Not loaded, or gone: Slack's own sound plays, which is the slot's
      // previous one whenever it could be -- the fallback, by construction.
      if (!url) return originalPlay.apply(this, args);
      let custom = stand.get(this);
      if (!custom || custom.src !== url) {
        custom = new Audio(url);
        custom[OURS] = true;
        stand.set(this, custom);
      }
      custom.volume = this.volume;
      custom.loop = this.loop;
      custom.currentTime = 0;
      if (this.sinkId && typeof custom.setSinkId === 'function') {
        custom.setSinkId(this.sinkId).catch(() => undefined);
      }
      return originalPlay.call(custom);
    };
    HTMLMediaElement.prototype.pause = function pause(...args) {
      const custom = stand.get(this);
      if (custom) originalPause.call(custom);
      return originalPause.apply(this, args);
    };
    disposers.push(() => {
      HTMLMediaElement.prototype.play = originalPlay;
      HTMLMediaElement.prototype.pause = originalPause;
    });

    /* -- the pickers ----------------------------------------------------- */

    const buttons = new Map();

    function currentLabel(slot) {
      const assignment = mine()[slot];
      if (assignment && soundById(assignment.sound)) return soundById(assignment.sound).label;
      return button(slot)?.textContent.trim() || '…';
    }

    function refreshButtons() {
      for (const [slot, element] of buttons) {
        if (!element.isConnected) {
          buttons.delete(slot);
          continue;
        }
        element.querySelector('.c-input_select__selected_value').textContent = currentLabel(slot);
      }
    }

    /**
     * Slack's own options -- its labels, in the reader's language, and the
     * list that slot really offers (huddles have one more) -- then yours.
     */
    async function openPicker(slot, anchor) {
      let options = optionsBySlot.get(slot);
      if (!options) {
        options = await readOptions(slot);
        if (options?.length) optionsBySlot.set(slot, options);
        learnLabels(options);
      }
      // What Slack holds now, by its own words on its own button.
      const shown = button(slot)?.textContent.trim();
      const assignment = mine()[slot];
      const items = (options ?? []).map((option) => ({
        label: option.label,
        icon: !assignment && option.label === shown ? CHECK : undefined,
        onSelect: () => chooseSlack(slot, option.index),
      }));
      if (sounds.length) {
        items.push({ label: t('yourSounds'), disabled: true, onSelect: () => undefined });
        for (const sound of sounds) {
          items.push({
            label: sound.label,
            icon: assignment?.sound === sound.id ? CHECK : NOTE,
            onSelect: () => chooseCustom(slot, sound.id),
          });
        }
      }
      items.push(
        { label: t('add'), icon: PLUS, onSelect: () => void addSound(slot) },
        { label: t('manage'), icon: GEAR, onSelect: () => openManager() },
      );
      if (anchor.isConnected) api.ui.menu(anchor, items, { align: 'left' });
    }

    /*
     * The same select, redrawn in Slack's classes so it follows the theme,
     * put where Slack's was. Slack's stays in the document, out of sight: it is
     * React's, React expects to find it on the next render, and it is what
     * this plugin clicks to make a choice -- so it is hidden by size and
     * opacity rather than with display none.
     */
    function makeButton(slot) {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = 'c-input_select betterslack-custom-sounds__select';
      element.dataset.customSoundsSlot = slot;
      element.setAttribute('aria-haspopup', 'menu');
      element.setAttribute('aria-label', slotLabel(slot));
      const value = document.createElement('span');
      value.className = 'c-input_select__selected_value';
      value.textContent = currentLabel(slot);
      const chevron = document.createElement('span');
      chevron.className = 'c-input_select__chevron';
      chevron.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true" width="16" height="16"><path fill="currentColor" d="M5.7 7.7a1 1 0 0 1 1.4 0L10 10.6l2.9-2.9a1 1 0 1 1 1.4 1.4l-3.6 3.6a1 1 0 0 1-1.4 0L5.7 9.1a1 1 0 0 1 0-1.4Z"/></svg>';
      element.append(value, chevron);
      // VIP's select is disabled until somebody is on the VIP list; so is this.
      if (button(slot)?.getAttribute('aria-disabled') === 'true') {
        element.disabled = true;
        element.classList.add('c-input_select--disabled');
      }
      element.addEventListener('click', () => void openPicker(slot, element));
      buttons.set(slot, element);
      return element;
    }

    let catchingUp = null;
    disposers.push(api.helpers.each(ALL_SLOTS, (found) => {
      const slot = SLOTS.find((name) => found.matches(slotSelector(name)));
      if (!slot) return;
      const slack = found.closest('.c-basic-select') ?? found;
      if (slack.dataset.customSoundsHidden) return;
      slack.dataset.customSoundsHidden = 'true';
      slack.classList.add('betterslack-custom-sounds__hidden');
      slack.after(makeButton(slot));
      // Once per appearance of Preferences, not once per select.
      catchingUp ??= sleep(50).then(onPrefsShown).catch((err) => api.log.warn(err)).finally(() => {
        catchingUp = null;
      });
    }));
    disposers.push(() => {
      for (const element of document.querySelectorAll('[data-custom-sounds-hidden]')) {
        element.classList.remove('betterslack-custom-sounds__hidden');
        delete element.dataset.customSoundsHidden;
      }
      for (const element of document.querySelectorAll('.betterslack-custom-sounds__select')) element.remove();
    });

    api.css(`
      .betterslack-custom-sounds__hidden { position: absolute !important; width: 1px !important; height: 1px !important;
        overflow: hidden !important; opacity: 0 !important; pointer-events: none !important; }
      /* While this plugin works Slack's select, its list is never seen. */
      html.betterslack-custom-sounds-busy .c-select_options_list,
      html.betterslack-custom-sounds-busy .c-select_options_list * { opacity: 0 !important; }
      .betterslack-custom-sounds__select { min-width: 225px; justify-content: space-between; }
      .betterslack-custom-sounds__select.c-input_select { margin: 0; }
      .betterslack-custom-sounds__list { display: flex; flex-direction: column; gap: 8px; }
      .betterslack-custom-sounds__row { display: flex; align-items: center; gap: 8px; padding: 8px 0;
        border-bottom: 1px solid var(--dt_color-otl-sec, rgba(0,0,0,.1)); }
      .betterslack-custom-sounds__row:last-child { border-bottom: none; }
      .betterslack-custom-sounds__meta { flex: 1; min-width: 0; }
      .betterslack-custom-sounds__name { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .betterslack-custom-sounds__uses { color: var(--dt_color-content-sec, #616061); font-size: 12px; }
    `);

    /* -- the manager ----------------------------------------------------- */

    let manager = null;

    function renderManager() {
      if (!manager) return;
      const list = document.createElement('div');
      list.className = 'betterslack-custom-sounds__list';
      if (!sounds.length) {
        const empty = document.createElement('p');
        empty.textContent = t('empty');
        list.append(empty);
      }
      for (const sound of sounds) {
        const row = document.createElement('div');
        row.className = 'betterslack-custom-sounds__row';
        const meta = document.createElement('div');
        meta.className = 'betterslack-custom-sounds__meta';
        const name = document.createElement('div');
        name.className = 'betterslack-custom-sounds__name';
        name.textContent = sound.label;
        const uses = document.createElement('div');
        uses.className = 'betterslack-custom-sounds__uses';
        const slots = [...new Set(usesOf(sound.id).map((use) => slotLabel(use.slot)))];
        uses.textContent = slots.length ? t('usedBy', { slots: slots.join(', ') }) : t('unused');
        meta.append(name, uses);
        const button = (label, variant, onClick) => {
          const element = document.createElement('button');
          element.type = 'button';
          element.className = `c-button c-button--${variant} c-button--small`;
          element.textContent = label;
          element.addEventListener('click', onClick);
          return element;
        };
        row.append(
          meta,
          button(t('play'), 'outline', async () => preview(await urlFor(sound.id))),
          button(t('rename'), 'outline', () => {
            const input = document.createElement('input');
            input.className = 'c-input_text';
            input.value = sound.label;
            input.maxLength = 60;
            name.replaceChildren(input);
            input.focus();
            input.select();
            const commit = async () => {
              const label = input.value.trim().slice(0, 60) || sound.label;
              sounds = sounds.map((other) => (other.id === sound.id ? { ...other, label } : other));
              await saveSounds();
              refreshButtons();
              renderManager();
            };
            input.addEventListener('keydown', (event) => {
              if (event.key === 'Enter') void commit();
              if (event.key === 'Escape') renderManager();
            });
            input.addEventListener('blur', () => void commit(), { once: true });
          }),
          button(t('delete'), 'danger', async () => {
            if (await deleteSound(sound.id)) renderManager();
          }),
        );
        list.append(row);
      }
      manager.body.replaceChildren(list);
    }

    function openManager() {
      manager?.close();
      manager = api.ui.modal({
        title: t('manageTitle'),
        subtitle: t('manageSubtitle'),
        content: document.createElement('div'),
        actions: [
          {
            label: t('add'),
            variant: 'default',
            onClick: async () => {
              await addSound(null);
              renderManager();
              return false;
            },
          },
          { label: t('close'), variant: 'primary' },
        ],
        onClose: () => {
          manager = null;
        },
      });
      renderManager();
    }

    disposers.push(api.commands.add({
      id: 'manage',
      title: t('commandTitle'),
      subtitle: t('commandSubtitle'),
      run: openManager,
    }));

    /*
     * Everything playable before Slack next plays anything -- but not awaited:
     * the start screen waits for every mod's start(), and reading files off
     * disk is not something to watch it wait on. Until this lands, Slack plays
     * its carriers, which are the previous sounds: the fallback again.
     */
    const ready = (async () => {
      await checkFiles();
      await Promise.all(sounds.map((sound) => urlFor(sound.id)));
    })().catch((err) => api.log.warn('could not load the sounds', err));

    api.onDispose(() => {
      for (const dispose of disposers.splice(0).reverse()) {
        try {
          dispose();
        } catch {
          /* already gone */
        }
      }
      manager?.close();
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    });

    lastSettle = ready;
  },
};

/*
 * The first settle of the latest start(), for the tests: start() itself does
 * not wait for it, so a test that wants the settled state has to.
 */
let lastSettle = Promise.resolve();
export function settled() {
  return lastSettle;
}

