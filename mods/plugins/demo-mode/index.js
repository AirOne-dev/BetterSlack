/**
 * Demo Mode — a Slack full of people who do not exist.
 *
 * The mod installs a switch at the right-hand end of the top bar and does
 * nothing else until you press it. Then every name, face, message, channel,
 * file and link on screen is replaced by an invented one, so you can
 * screenshot, screen-share or demo your real client without showing anybody's
 * work. Press it again and the real thing comes back.
 *
 * The replacing is `redaction.js`, which is also what `pnpm shoot --mods` runs
 * before it photographs a real workspace: one implementation, so the pictures
 * in this repository and the ones you take yourself hide the same things.
 *
 * Three things a mod has to get right that a throwaway script did not:
 *
 * - **It has to be reversible.** The recipe was about to close Slack; this is
 *   switched off in a client somebody keeps using, so every write is recorded
 *   and put back -- and only where Slack has not re-rendered since.
 * - **It has to say it is on.** Forgetting which state you are in is the whole
 *   risk, in both directions: a screenshot you think is anonymous, or a name
 *   you think is invented. Hence the strip across the bottom and the switch
 *   turning red, neither of which follows the theme.
 * - **It has to start off.** Installing the mod is not the request; pressing
 *   the switch is. The state is deliberately not persisted either: coming back
 *   to a Slack full of invented names after a restart, and reading them as
 *   real, is the one failure this mod could cause on its own.
 */

import { createRedaction } from './redaction.js';
import { STRINGS } from './strings.js';

const INDICATOR_ID = 'betterslack-demo-indicator';
const FLASH_ID = 'betterslack-demo-flash';
/** On `<html>`, so the switch's own appearance is pure CSS. */
const ON_CLASS = 'betterslack-demo-on';
/*
 * Also on `<html>`, and for the same reason it is not an inline style: the
 * toolbar buttons are re-mounted whenever Slack re-renders around them, and a
 * remount during the two seconds a capture takes would put the button back in
 * shot. A class and a stylesheet survive it.
 */
const SHOOTING_CLASS = 'betterslack-demo-shooting';

/*
 * Both states in one icon: a face, and the mask that goes over it.
 *
 * The classes are mine, inside my own markup, so the stylesheet below never
 * has to name the id the runtime gives the button -- which is the runtime's
 * business and not a contract.
 */
const CAMERA_ICON = `<svg viewBox="0 0 20 20" class="bs-demo-icon bs-demo-shot" aria-hidden="true">
  <path d="M2.5 6.5h3l1.2-2h6.6l1.2 2h3v9h-15z" fill="none" stroke="currentColor"
        stroke-width="1.6" stroke-linejoin="round"/>
  <circle cx="10" cy="11" r="3.1" fill="none" stroke="currentColor" stroke-width="1.6"/>
</svg>`;

const ICON = `<svg viewBox="0 0 20 20" class="bs-demo-icon" aria-hidden="true">
  <circle cx="7.5" cy="6.5" r="2.8" fill="none" stroke="currentColor" stroke-width="1.6"/>
  <path d="M2.6 16a4.9 4.9 0 0 1 9.8 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  <g class="bs-demo-off">
    <path d="M13.5 4.5c2.6 1.2 2.6 9.8 0 11" fill="none" stroke="currentColor"
          stroke-width="1.6" stroke-linecap="round" stroke-dasharray="2 2.6"/>
  </g>
  <g class="bs-demo-on">
    <circle cx="15.4" cy="10" r="3.4" fill="currentColor"/>
  </g>
</svg>`;

export default {
  /**
   * @param {import('../../../src/runtime/api.js').PluginApi} api
   */
  start(api) {
    const t = api.i18n.strings(STRINGS);
    const redaction = createRedaction({ document });
    const root = document.documentElement;

    api.css(`
      /* The switch: one icon, two states, and neither of them subtle. */
      .bs-demo-on { display: none; }
      html.${ON_CLASS} .bs-demo-off { display: none; }
      html.${ON_CLASS} .bs-demo-on { display: inline; }
      html.${ON_CLASS} .bs-demo-icon { color: #b8362f; }

      /*
       * The camera belongs to the demo, so it is only there during one.
       *
       * Reached through the class on its own icon rather than through the id
       * the runtime gives the button, which is the runtime's business. Hidden
       * rather than shown, so its natural display never has to be guessed.
       */
      html:not(.${ON_CLASS}) .betterslack-toolbar-button:has(.bs-demo-shot) { display: none; }

      /*
       * Out of shot, but not out of the layout: the shutter is on the loader's
       * side and photographs whatever is on screen, and removing these would
       * shift Slack's own buttons along the top bar for the one frame that
       * matters.
       */
      html.${SHOOTING_CLASS} #${INDICATOR_ID},
      html.${SHOOTING_CLASS} .betterslack-toolbar-button { visibility: hidden; }

      #${FLASH_ID} {
        position: fixed; inset: 0; z-index: 2147483000;
        background: #fff; pointer-events: none; opacity: 0;
        animation: betterslack-demo-flash 420ms ease-out forwards;
      }
      @keyframes betterslack-demo-flash {
        0% { opacity: 0; }
        12% { opacity: 0.85; }
        100% { opacity: 0; }
      }

      #${INDICATOR_ID} {
        position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%);
        z-index: 2147482000;
        padding: 6px 14px; border-radius: 999px;
        font-family: Lato, Slack-Lato, sans-serif; font-size: 11px;
        font-weight: 700; letter-spacing: 0.3px;
        color: #fff;
        /* Not a theme colour, on purpose. Every other strip in BetterSlack
           follows the theme; this one has to be legible and unmistakable
           whatever is painting the client, because it is the only thing
           telling you the names on screen are not real. */
        background: #b8362f;
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.35);
        pointer-events: none;
      }
    `);

    let indicator = null;
    let on = false;

    const setDemo = (wanted) => {
      if (wanted === on) return;
      on = wanted;
      root.classList.toggle(ON_CLASS, on);

      if (on) {
        redaction.start();
        indicator = api.dom.h('div', { id: INDICATOR_ID, role: 'status' }, [t('indicator')]);
        document.body.append(indicator);
        return;
      }

      redaction.stop();
      redaction.restore();
      indicator?.remove();
      indicator = null;
    };

    api.slack.addToolbarButton('topNav', {
      id: 'toggle',
      label: t('toggle'),
      description: t('toggleHint'),
      icon: ICON,
      onClick: () => setDemo(!on),
    });

    /*
     * A picture at the size it will be published at.
     *
     * Cropping a taller frame afterwards takes the crop from the middle, which
     * is how the top bar and the composer went missing from every panel shot
     * on this project's own site. The loader forces the viewport first, so
     * what comes back needs no cropping at all.
     */
    const shoot = async () => {
      /*
       * The local clock, not UTC.
       *
       * `toISOString()` is the short way to a sortable stamp and it named the
       * first file 07-41 while the clock on the wall said 09:41, which is a
       * small thing that makes you distrust the whole file.
       */
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
        + `-${pad(now.getHours())}${pad(now.getMinutes())}`;
      root.classList.add(SHOOTING_CLASS);
      try {
        const saved = await api.files.screenshot({
          size: api.settings.get('size', '1600x1000'),
          filename: `slack-${stamp}.png`,
        });
        flash();
        api.ui.toast(t('saved', { name: saved.path.split('/').pop() }), { variant: 'success' });
      } catch (err) {
        api.ui.toast(t('failed', { reason: err.message }), { variant: 'warning' });
      } finally {
        // In a finally, or a failed capture leaves the client with no toolbar
        // buttons and no way to press anything.
        root.classList.remove(SHOOTING_CLASS);
      }
    };

    /** Confirmation you can see, in the place you were already looking. */
    const flash = () => {
      document.getElementById(FLASH_ID)?.remove();
      const sheet = api.dom.h('div', { id: FLASH_ID, 'aria-hidden': 'true' });
      sheet.addEventListener('animationend', () => sheet.remove());
      document.body.append(sheet);
      // A fallback, since an animation that never starts never ends -- and a
      // white sheet left over the client is a broken Slack.
      setTimeout(() => sheet.remove(), 1200);
    };

    api.slack.addToolbarButton('topNav', {
      id: 'shot',
      label: t('shoot'),
      description: t('shootHint'),
      icon: CAMERA_ICON,
      onClick: () => void shoot(),
    });

    api.commands.add({
      id: 'shoot',
      title: t('shoot'),
      subtitle: t('shootHint'),
      run: () => {
        if (!on) return void api.ui.toast(t('checkOff'), { variant: 'warning' });
        void shoot();
      },
    });

    api.commands.add({
      id: 'toggle',
      title: t('toggle'),
      subtitle: t('toggleHint'),
      run: () => setDemo(!on),
    });

    api.commands.add({
      id: 'check',
      title: t('check'),
      subtitle: t('checkHint'),
      run: () => {
        if (!on) {
          api.ui.toast(t('checkOff'), { variant: 'warning' });
          return;
        }
        /*
         * The safety property, handed to whoever is holding the shutter.
         *
         * `remaining()` knows nothing about what was on screen before: it is
         * the absolute rule -- after a sweep, nothing drawn may point anywhere
         * but at example.com. That is what makes it worth reading aloud.
         */
        const left = redaction.remaining();
        if (left.length === 0) {
          api.ui.toast(t('checkClean'), { variant: 'success' });
          return;
        }
        for (const item of left) api.log.warn(`still real: ${item.what} in ${item.where} — ${item.text}`);
        api.ui.toast(t('checkFound', { count: left.length }), { variant: 'warning' });
      },
    });

    api.commands.add({
      id: 'sweep',
      title: t('sweep'),
      subtitle: t('sweepHint'),
      run: () => {
        if (!on) return void api.ui.toast(t('checkOff'), { variant: 'warning' });
        redaction.sweep();
        api.ui.toast(t('swept'));
      },
    });

    // Switching the mod off is switching the demo off: the real thing comes
    // back, whichever way you left it.
    api.onDispose(() => {
      setDemo(false);
      root.classList.remove(SHOOTING_CLASS);
      document.getElementById(FLASH_ID)?.remove();
    });
  },

  stop() {},
};
