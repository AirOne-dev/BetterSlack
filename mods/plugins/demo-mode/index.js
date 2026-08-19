/**
 * Demo Mode — a Slack full of people who do not exist.
 *
 * Switch it on and every name, face, message, channel, file and link on screen
 * is replaced by an invented one, so you can photograph or share your real
 * client without photographing or sharing your colleagues. Switch it off and
 * the real thing comes back.
 *
 * The replacing is `redaction.js`, which is also what `pnpm shoot --mods` runs
 * before it photographs a real workspace: one implementation, so the pictures
 * in this repository and the ones you take yourself hide the same things.
 *
 * Two things a mod has to get right that a throwaway script did not:
 *
 * - **It has to be reversible.** The recipe was about to close Slack; this is
 *   switched off in a client somebody keeps using, so every write is recorded
 *   and put back -- and only where Slack has not re-rendered since.
 * - **It has to say it is on.** Forgetting which state you are in is the whole
 *   risk: a screenshot you think is anonymous, or a name you thought was
 *   invented. Hence the strip in the corner, for as long as the mod is on.
 */

import { createRedaction } from './redaction.js';
import { STRINGS } from './strings.js';

const INDICATOR_ID = 'betterslack-demo-indicator';

export default {
  /**
   * @param {import('../../../src/runtime/api.js').PluginApi} api
   */
  start(api) {
    const t = api.i18n.strings(STRINGS);
    const redaction = createRedaction({ document });

    api.css(`
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

    const indicator = api.dom.h('div', { id: INDICATOR_ID, role: 'status' }, [t('indicator')]);
    document.body.append(indicator);

    redaction.start();

    api.commands.add({
      id: 'sweep',
      title: t('sweep'),
      subtitle: t('sweepHint'),
      run: () => {
        redaction.sweep();
        api.ui.toast(t('swept'));
      },
    });

    api.commands.add({
      id: 'check',
      title: t('check'),
      subtitle: t('checkHint'),
      run: () => {
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

    api.onDispose(() => {
      redaction.stop();
      redaction.restore();
      indicator.remove();
    });
  },

  stop() {},
};
