// Motion — Slack, with the frames in between.
//
// Slack's client is almost entirely static: views swap, dialogs appear, menus
// exist and then do not. Nothing travels, so nothing tells you where it came
// from. This mod adds the frames in between, and it is deliberately almost all
// CSS: dialogs, menus and hover states are mounted at the moment they should
// animate, so an `animation` on them fires at exactly the right time with no
// observer, no timer and nothing to wedge. Only the channel switch needs
// JavaScript, and only because nothing remounts when it happens -- see
// navigation.js, where the timings that decide when it fires are written down.
//
// The two settings that matter are speed and amplitude, and they are written
// as custom properties rather than baked into the rules, so changing one is a
// single style recalculation instead of a reload. `api.settings.onChange` is
// what keeps the mod running through it: the point of a speed control you
// cannot see take effect is hard to explain.
//
// `api.css` replaces this plugin's stylesheet whole on every call, so the mod
// builds the entire sheet each time and hands it over in one go rather than
// adding to it. (Helpers that write CSS -- toggle's `whenOn`, badge, tooltip --
// have a style node of their own, so they cannot collide with this one. They
// did not always, and a shipped mod folded nothing away because of it; see
// tests/styles.test.mjs.)

import { STRINGS } from './strings.js';
import { onViewChange, restartAnimation } from './navigation.js';
import { paintToasts } from './toasts.js';

const ROOT_CLASS = 'betterslack-motion';
const ENTER_CLASS = 'betterslack-motion-enter';

/** The families the panel switches on and off, each with a class of its own. */
const GROUPS = ['views', 'panels', 'hover', 'press', 'arrivals'];

/** Where a view change is animated: the column holding the conversation. */
const VIEW = '.p-view_contents--primary';

const clamp = (value, low, high) => Math.min(high, Math.max(low, Number(value) || 0));

/** Two decimals is under a millisecond at these durations, and keeps the CSS readable. */
const round = (value) => Math.round(value * 100) / 100;

export default {
  /**
   * @param {import('../../../src/runtime/api.js').PluginApi} api
   */
  start(api) {
    const t = api.i18n.strings(STRINGS);
    const sheet = api.assets.text('motion.css');
    const root = document.documentElement;
    const classFor = (group) => `${ROOT_CLASS}-${group}`;

    /*
     * `prefers-reduced-motion` is deliberately not consulted.
     *
     * It was, for a while, and it was wrong here. Installing a mod called
     * Motion and switching it on is the clearest statement of intent there is;
     * asking again afterwards -- through a system setting people turn on for
     * their window manager years ago and forget -- meant the mod installed,
     * reported healthy and did visibly nothing, which is indistinguishable
     * from broken. The switch that governs this mod is the mod.
     *
     * The design system underneath still honours the system setting, because
     * `api.ui.kit` and the Mods panel move whether or not this is installed and
     * have no such statement of intent to go on. Their tokens are declared on
     * :root and this mod overrides them from html.betterslack-motion, which is
     * more specific -- so when it is on, it wins, which is the whole point.
     */

    const apply = () => {
      // Speed is "how fast", so it divides the durations: 200 is twice as
      // quick, not twice as long. Getting this the other way round is the kind
      // of control that makes people think the slider is broken.
      const speed = clamp(api.settings.get('speed', 100), 25, 300);
      const amplitude = clamp(api.settings.get('amplitude', 100), 0, 200);

      root.classList.add(ROOT_CLASS);
      for (const group of GROUPS) {
        root.classList.toggle(classFor(group), api.settings.get(group, true) === true);
      }

      // One call, everything in it: see the note at the top about the single
      // stylesheet a plugin gets.
      api.css(`html.${ROOT_CLASS} {\n`
        + `  --bsm-scale: ${round(100 / speed)};\n`
        + `  --bsm-amp: ${round(amplitude / 100)};\n`
        + `}\n\n${sheet}`);
    };

    apply();

    // Without this the panel would reload the plugin on every keystroke in the
    // speed field, and a reload is a flash of unstyled motion.
    api.settings.onChange(apply);

    // The one component a stylesheet in this document cannot reach.
    paintToasts(api);

    // The one thing CSS cannot see coming.
    let clearStamp = null;
    onViewChange(api, () => {
      clearStamp?.();
      clearStamp = restartAnimation(document.querySelector(VIEW), ENTER_CLASS);
    });

    api.onDispose(() => {
      clearStamp?.();
      root.classList.remove(ROOT_CLASS, ...GROUPS.map(classFor));
    });

    api.commands.add({
      id: 'settings',
      title: t('command'),
      subtitle: t('commandSubtitle'),
      run: () => api.app.openMod(api.id),
    });
  },

  stop() {},
};
