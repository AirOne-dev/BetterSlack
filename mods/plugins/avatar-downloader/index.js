/**
 * Avatar Downloader — profile pictures at full quality.
 *
 * Slack renders avatars at 24-72px, so saving the image from the page gives a
 * thumbnail. The API exposes the whole ladder up to `image_original`, which is
 * the file as uploaded. This grabs the best one available.
 *
 * Uses `api.slack.web` (see src/runtime/web-api.ts) to read the profile, then
 * fetches the image and saves it. Nothing is uploaded anywhere.
 */

const ICON_PROFILE = `<svg viewBox="0 0 20 20" aria-hidden="true" width="16" height="16" style="margin-right:6px">
  <path fill="currentColor" d="M10 2.75a.75.75 0 0 1 .75.75v7.19l2.22-2.22a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 0 1 1.06-1.06l2.22 2.22V3.5a.75.75 0 0 1 .75-.75Z"/>
  <path fill="currentColor" d="M3.75 12.5a.75.75 0 0 1 .75.75v1.25c0 .14.11.25.25.25h10.5a.25.25 0 0 0 .25-.25v-1.25a.75.75 0 0 1 1.5 0v1.25c0 .97-.78 1.75-1.75 1.75H4.75c-.97 0-1.75-.78-1.75-1.75v-1.25a.75.75 0 0 1 .75-.75Z"/>
</svg>`;

const ICON_ACTION = `<svg viewBox="0 0 20 20" aria-hidden="true">
  <path fill="currentColor" d="M10 2.75a.75.75 0 0 1 .75.75v7.19l2.22-2.22a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 0 1 1.06-1.06l2.22 2.22V3.5a.75.75 0 0 1 .75-.75Z"/>
  <path fill="currentColor" d="M3.75 12.5a.75.75 0 0 1 .75.75v1.25c0 .14.11.25.25.25h10.5a.25.25 0 0 0 .25-.25v-1.25a.75.75 0 0 1 1.5 0v1.25c0 .97-.78 1.75-1.75 1.75H4.75c-.97 0-1.75-.78-1.75-1.75v-1.25a.75.75 0 0 1 .75-.75Z"/>
</svg>`;

/**
 * Best first. `image_original` is the upload itself; the numbered ones are
 * Slack's renditions.
 */
export const QUALITY_ORDER = [
  'image_original',
  'image_1024',
  'image_512',
  'image_192',
  'image_72',
  'image_48',
  'image_32',
  'image_24',
];

/**
 * Pick an avatar URL from a Slack profile.
 *
 * `wanted` is a specific key from the ladder above; anything else -- including
 * nothing -- means the largest that exists. A profile that does not have the
 * requested one falls back rather than failing: not every account has an
 * original upload, and refusing to save anything would be a strange way to
 * honour a preference.
 */
export function pickBestAvatar(profile, wanted = 'best') {
  if (!profile || typeof profile !== 'object') return null;
  if (wanted !== 'best') {
    const chosen = profile[wanted];
    if (typeof chosen === 'string' && chosen.length > 0) return { key: wanted, url: chosen };
  }
  for (const key of QUALITY_ORDER) {
    const value = profile[key];
    if (typeof value === 'string' && value.length > 0) return { key, url: value };
  }
  return null;
}

/** Turn a URL and a user into a sensible file name. */
export function fileNameFor(user, url, key) {
  const handle =
    user?.profile?.display_name || user?.name || user?.real_name || user?.id || 'slack-user';
  // Collapse runs of dots as well as separators: a display name is attacker-
  // controlled in a shared workspace, and ".." in a download name is a path
  // the browser should never be handed.
  const safe = String(handle)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.\-]+|[.\-]+$/g, '');
  const extMatch = String(url).match(/\.([a-z0-9]{3,4})(?:\?|$)/i);
  const ext = extMatch ? extMatch[1].toLowerCase() : 'png';
  const size = key === 'image_original' ? 'original' : key.replace('image_', '') + 'px';
  return `${safe || 'slack-user'}-${size}.${ext}`;
}

const STRINGS = {
  en: {
    unknownUser: 'Could not tell which user this is',
    noToken: 'No Slack session token for this workspace',
    fetching: 'Fetching avatar…',
    noAvatar: 'This user has no avatar',
    saved: 'Saved {quality} · {size} kB',
    failed: 'Download failed: {reason}',
    download: 'Download avatar',
    downloadTheirs: 'Download this person’s avatar',
  },
  fr: {
    unknownUser: 'Impossible de déterminer de quel utilisateur il s’agit',
    noToken: 'Aucun jeton de session Slack pour cet espace de travail',
    fetching: 'Récupération de l’avatar…',
    noAvatar: 'Cet utilisateur n’a pas d’avatar',
    saved: 'Enregistré en {quality} · {size} ko',
    failed: 'Échec du téléchargement : {reason}',
    download: 'Télécharger l’avatar',
    downloadTheirs: 'Télécharger l’avatar de cette personne',
  },
};

export default {
  /**
   * @param {import('../../../src/runtime/api.js').PluginApi} api
   */
  start(api) {
    const t = api.i18n.strings(STRINGS);
    api.css(`
      .betterslack-profile-row { padding: 8px 20px 12px; }
      .betterslack-profile-row .c-button { width: 100%; display: inline-flex; align-items: center; justify-content: center; }
    `);

    const download = async (userId) => {
      if (!userId) {
        api.ui.toast(t('unknownUser'), { variant: 'error' });
        return;
      }
      if (!api.slack.web.available) {
        api.ui.toast(t('noToken'), { variant: 'error' });
        return;
      }

      const pending = api.ui.toast(t('fetching'), { duration: 0 });
      try {
        const user = await api.slack.web.userInfo(userId);
        const best = pickBestAvatar(user.profile, api.settings.get('quality', 'best'));
        if (!best) {
          pending.dismiss();
          api.ui.toast(t('noAvatar'), { variant: 'warning' });
          return;
        }

        // The loader does the fetching. Slack's CDN serves avatars without CORS
        // headers, so `fetch` from the renderer fails with "Failed to fetch"
        // even though an <img> with the same URL loads fine.
        const saved = await api.files.save(best.url, fileNameFor(user, best.url, best.key));

        pending.dismiss();
        const quality =
          best.key === 'image_original' ? 'the original' : best.key.replace('image_', '') + 'px';
        api.ui.toast(t('saved', { quality, size: Math.round(saved.bytes / 1024) }), {
          variant: 'success',
        });
        api.log.info(`saved to ${saved.path}`);
      } catch (err) {
        pending.dismiss();
        api.log.error(err);
        api.ui.toast(t('failed', { reason: err.message }), { variant: 'error' });
      }
    };

    api.slack.addProfileButton({
      id: 'download-avatar',
      label: t('download'),
      icon: ICON_PROFILE,
      onClick: (pane) => download(pane.userId),
    });

    // Also from a message, so it works without opening the profile first.
    api.slack.addMessageAction({
      id: 'download-avatar',
      label: t('downloadTheirs'),
      icon: ICON_ACTION,
      onClick: (message) => download(api.slack.userIdFromMessage(message)),
    });
  },

  stop() {},
};
