/**
 * User Inspector — everything Slack's API knows, shown inside the profile.
 *
 * Slack's profile pane shows a handful of fields. `users.info` returns roughly
 * fifty, and `users.getPresence` / `dnd.info` add a few more. Rather than
 * putting those in a dialog, this appends more sections to the pane itself,
 * built from Slack's own section markup — same headers, same label/value rows,
 * same spacing — so it reads as part of the profile rather than as an add-on.
 *
 * Where the data comes from: `api.slack.web`, the audited wrapper around
 * Slack's own API (src/runtime/web-api.ts). Requests can only reach Slack's own
 * origin, and this plugin never touches localStorage or the session token
 * itself. Nothing is sent anywhere.
 */

/**
 * Anchor on the pane, not on `.p-r_member_profile__container` inside it: that
 * inner container is present in some profile variants and absent in others, so
 * targeting it means the sections silently fail to appear half the time.
 *
 * Note this is a *contract*, not just Slack's markup. Anything in this
 * repository that presents a profile carries the same two hooks -- the pane
 * attribute and the avatar class -- and gets these sections for free; the
 * member column's profile dialog is the first thing other than Slack to do it.
 */
// keepMounted owns the element's id (it uses it to find its own node), so the
// styling hook is a class. One pane, one id; the class is what CSS and tests
// look for.
const NODE_CLASS = 'betterslack-user-details';

/**
 * Boolean flags worth surfacing, in the order they matter, as translation keys.
 *
 * Keys rather than English text so `rolesOf` can stay a pure function: it takes
 * the translator, which keeps it testable without a running api.
 */
const ROLE_KEYS = [
  ['is_primary_owner', 'rolePrimaryOwner'],
  ['is_owner', 'roleOwner'],
  ['is_admin', 'roleAdmin'],
  ['is_bot', 'roleBot'],
  ['is_app_user', 'roleAppUser'],
  ['is_restricted', 'roleGuest'],
  ['is_ultra_restricted', 'roleSingleChannelGuest'],
  ['deleted', 'roleDeactivated'],
  ['is_email_confirmed', 'roleEmailConfirmed'],
];

const STRINGS = {
  en: {
    rolePrimaryOwner: 'Primary owner',
    roleOwner: 'Owner',
    roleAdmin: 'Admin',
    roleBot: 'Bot',
    roleAppUser: 'App user',
    roleGuest: 'Guest',
    roleSingleChannelGuest: 'Single-channel guest',
    roleDeactivated: 'Deactivated',
    roleEmailConfirmed: 'Email confirmed',
    active: 'Active',
    away: 'Away',
    userId: 'User ID',
    username: 'Username',
    roles: 'Roles',
    title: 'Title',
    phone: 'Phone',
    timeZone: 'Time zone',
    theirTime: '{zone} — {time} their time',
    locale: 'Locale',
    presence: 'Presence',
    presenceAuto: '{state} (auto)',
    dnd: 'Do not disturb',
    dndUntil: 'On until {when}',
    dndOn: 'On',
    status: 'Status',
    updated: 'Profile updated',
    moreDetails: 'More details',
    avatar: 'Avatar',
    availableSizes: 'Available sizes',
    original: 'original',
    rawData: 'Raw data',
    rawSummary: '{count} fields from users.info, plus presence and do-not-disturb.',
    copyRaw: 'Copy raw JSON',
    copiedRaw: 'Copied the full API response',
    loading: 'Loading…',
    unknownUser: 'Could not tell which user this profile belongs to.',
    noToken: 'No Slack session token for this workspace.',
    refused: 'Slack refused the request: {reason}',
  },
  fr: {
    rolePrimaryOwner: 'Propriétaire principal',
    roleOwner: 'Propriétaire',
    roleAdmin: 'Administrateur',
    roleBot: 'Bot',
    roleAppUser: 'Utilisateur d’application',
    roleGuest: 'Invité',
    roleSingleChannelGuest: 'Invité à un seul canal',
    roleDeactivated: 'Désactivé',
    roleEmailConfirmed: 'E-mail confirmé',
    active: 'Disponible',
    away: 'Absent',
    userId: 'ID utilisateur',
    username: 'Nom d’utilisateur',
    roles: 'Rôles',
    title: 'Fonction',
    phone: 'Téléphone',
    timeZone: 'Fuseau horaire',
    theirTime: '{zone} — {time} chez cette personne',
    locale: 'Langue',
    presence: 'Présence',
    presenceAuto: '{state} (automatique)',
    dnd: 'Ne pas déranger',
    dndUntil: 'Actif jusqu’à {when}',
    dndOn: 'Actif',
    status: 'Statut',
    updated: 'Profil mis à jour',
    moreDetails: 'Plus de détails',
    avatar: 'Avatar',
    availableSizes: 'Tailles disponibles',
    original: 'original',
    rawData: 'Données brutes',
    rawSummary: '{count} champs de users.info, plus la présence et le mode Ne pas déranger.',
    copyRaw: 'Copier le JSON brut',
    copiedRaw: 'Réponse complète de l’API copiée',
    loading: 'Chargement…',
    unknownUser: 'Impossible de déterminer à qui appartient ce profil.',
    noToken: 'Aucun jeton de session Slack pour cet espace de travail.',
    refused: 'Slack a refusé la requête : {reason}',
  },
};

/** English, for callers with no translator of their own (tests, mostly). */
const fallbackT = (key, vars = {}) =>
  String(STRINGS.en[key] ?? key).replace(/\{(\w+)\}/g, (whole, name) =>
    name in vars ? String(vars[name]) : whole);

function formatTimestamp(seconds) {
  if (typeof seconds !== 'number' || seconds <= 0) return null;
  return new Date(seconds * 1000).toLocaleString();
}

function localTimeFor(offsetSeconds) {
  if (typeof offsetSeconds !== 'number') return null;
  const now = new Date();
  const local = new Date(now.getTime() + (offsetSeconds + now.getTimezoneOffset() * 60) * 1000);
  return local.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Roles a user actually has, as readable labels. */
export function rolesOf(user, t = fallbackT) {
  return ROLE_KEYS.filter(([flag]) => user?.[flag] === true).map(([, key]) => t(key));
}

/** The rows this plugin adds, as [label, value] pairs, ready to render. */
export function buildRows({ user, presence, dnd }, t = fallbackT) {
  const profile = user?.profile ?? {};
  const rows = [];
  const push = (label, value) => {
    if (value !== null && value !== undefined && value !== '') rows.push([label, String(value)]);
  };

  push(t('userId'), user?.id);
  push(t('username'), user?.name);
  push(t('roles'), rolesOf(user, t).join(' · '));
  push(t('title'), profile.title);
  push(t('phone'), profile.phone);

  if (user?.tz) {
    const local = localTimeFor(user.tz_offset);
    const zone = user.tz_label ?? user.tz;
    push(t('timeZone'), local ? t('theirTime', { zone, time: local }) : zone);
  }
  push(t('locale'), user?.locale);

  if (presence?.presence) {
    const state = presence.presence === 'active' ? t('active')
      : presence.presence === 'away' ? t('away') : presence.presence;
    push(t('presence'), presence.auto_away ? t('presenceAuto', { state }) : state);
  }
  if (dnd?.dnd_enabled) {
    const until = formatTimestamp(dnd.next_dnd_end_ts);
    push(t('dnd'), until ? t('dndUntil', { when: until }) : t('dndOn'));
  }

  push(t('status'), profile.status_text);
  push(t('updated'), formatTimestamp(user?.updated));

  // Workspace-defined fields vary per organisation; show whatever is filled in.
  const custom = profile.fields;
  if (custom && typeof custom === 'object') {
    for (const [id, field] of Object.entries(custom)) {
      push(field?.label ?? id, field?.value ?? field?.alt);
    }
  }

  return rows;
}

/** Avatar renditions Slack holds, largest first. */
export function avatarSizes(profile, t = fallbackT) {
  return Object.keys(profile ?? {})
    .filter((key) => key.startsWith('image_') && typeof profile[key] === 'string')
    .sort((a, b) => {
      if (a === 'image_original') return -1;
      if (b === 'image_original') return 1;
      return Number(b.slice(6)) - Number(a.slice(6));
    })
    .map((key) => ({
      key,
      label: key === 'image_original' ? t('original') : `${key.slice(6)}px`,
      url: profile[key],
    }));
}

export default {
  /**
   * @param {import('../../../src/runtime/api.js').PluginApi} api
   */
  start(api) {
    const t = api.i18n.strings(STRINGS);
    // The two halves of the contract, from the API rather than written out
    // here: Slack's own names churn, and a copy in a mod is a copy nobody
    // updates when they do.
    const { profilePane: PANE, profileAvatar: AVATAR } = api.slack.selectors;
    // Slack's own classes do the heavy lifting; this only covers the few things
    // it has no class for.
    api.css(`
      .${NODE_CLASS} .betterslack-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px; }
      .${NODE_CLASS} .betterslack-chip {
        font-size: 12px; padding: 2px 8px; border-radius: 999px;
        border: 1px solid var(--dt_color-otl-sec, rgba(94, 93, 96, .35));
        color: var(--dt_color-content-sec, #454447);
      }
      .${NODE_CLASS} .betterslack-muted { color: var(--dt_color-content-ter, #5e5d60); font-size: 13px; }
      .${NODE_CLASS} .betterslack-actions { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
    `);

    const cache = new Map();

    // Slack's own field and section shells, straight from the API.
    const { field, section } = api.helpers;

    const render = (host, data) => {
      host.replaceChildren();

      if (data.error) {
        host.append(section(t('moreDetails'), [
          api.dom.h('div', { class: 'betterslack-muted' }, [data.error]),
        ]));
        return;
      }
      if (!data.user) {
        host.append(section(t('moreDetails'), [
          api.dom.h('div', { class: 'betterslack-muted' }, [t('loading')]),
        ]));
        return;
      }

      const rows = buildRows(data, t);
      const roleChips = rolesOf(data.user, t);

      const details = rows
        .filter(([label]) => label !== t('roles'))
        .map(([label, value]) => field(label, value));

      if (roleChips.length > 0) {
        details.unshift(
          api.dom.h('div', { class: 'p-rimeto_member_profile_field__contact_info' }, [
            api.dom.h('div', { class: 'p-rimeto_member_profile_field' }, [
              api.dom.h('div', { class: 'p-rimeto_member_profile_field__primary' }, [
                api.dom.h('div', { class: 'p-rimeto_member_profile_field__label' }, [t('roles')]),
                api.dom.h('div', { class: 'betterslack-chips' },
                  roleChips.map((r) => api.dom.h('span', { class: 'betterslack-chip' }, [r]))),
              ]),
            ]),
          ]),
        );
      }

      host.append(section(t('moreDetails'), details));

      const sizes = avatarSizes(data.user.profile, t);
      if (sizes.length > 0) {
        const links = api.dom.h('div', { class: 'betterslack-chips' });
        for (const size of sizes) {
          links.append(
            api.dom.h('a', {
              class: 'betterslack-chip c-link',
              href: size.url,
              target: '_blank',
              rel: 'noreferrer',
            }, [size.label]),
          );
        }
        host.append(section(t('avatar'), [
          api.dom.h('div', { class: 'p-rimeto_member_profile_field__label' }, [t('availableSizes')]),
          links,
        ]));
      }

      // The full response, for anything the rows above do not cover.
      const copy = api.dom.h('button', {
        class: 'c-button c-button--outline c-button--medium',
        type: 'button',
      }, [t('copyRaw')]);
      copy.addEventListener('click', () => {
        void api.helpers.copy(JSON.stringify(data, null, 2), t('copiedRaw'));
      });
      host.append(section(t('rawData'), [
        api.dom.h('div', { class: 'betterslack-muted' }, [
          t('rawSummary', { count: Object.keys(data.user).length }),
        ]),
        api.dom.h('div', { class: 'betterslack-actions' }, [copy]),
      ]));
    };

    const load = async (userId) => {
      if (cache.has(userId)) return cache.get(userId);
      const data = await (async () => {
        try {
          // Through the API's directory, so opening the same profile twice --
          // or after another mod has already asked about them -- costs nothing.
          const users = await api.slack.web.users([userId]);
          // The directory answers with what it has and swallows the rest --
          // a partial answer is normal when several people are asked about at
          // once. For one person it is a failure, and the reason belongs on
          // screen, so ask again the way that reports it.
          const user = users.get(userId) ?? (await api.slack.web.userInfo(userId));
          // Allowed to be absent: bots have no presence, and dnd.info is not
          // readable in every workspace. availability() folds both together and
          // never rejects.
          const { presence, dnd } = await api.slack.web.availability(userId);
          return { user, presence, dnd };
        } catch (err) {
          api.log.error(err);
          return { error: t('refused', { reason: err.message }) };
        }
      })();
      cache.set(userId, data);
      return data;
    };

    /**
     * Who a profile belongs to.
     *
     * `data-user-id` on the pane when it is there, and the avatar URL only as a
     * fallback: Slack's own pane does not carry the attribute, but a custom or
     * bot avatar is not served from its CDN and has no id in the URL, which is
     * how this ended up reporting that it could not tell.
     */
    const fill = (host, pane) => {
      const avatar = pane.querySelector(AVATAR);
      const userId = pane.getAttribute('data-user-id')?.toUpperCase()
        || (avatar?.getAttribute('src')?.match(/\/T[A-Z0-9]+-(U[A-Z0-9]+)-/i) ?? [])[1]?.toUpperCase();

      if (!userId) {
        render(host, { error: t('unknownUser') });
        return;
      }
      if (!api.slack.web.available) {
        render(host, { error: t('noToken') });
        return;
      }

      // Cached profiles render on the spot; the rest fill in a moment later.
      if (cache.has(userId)) render(host, cache.get(userId));
      else {
        render(host, {});
        void load(userId).then((data) => {
          if (host.isConnected) render(host, data);
        });
      }
    };

    /*
     * One mount per pane, not one mount full stop.
     *
     * `helpers.mount` tracks a single node id, so it fills whichever profile it
     * finds first and ignores the rest. That was invisible while Slack's pane
     * was the only profile in the app; now that a plugin can present one too,
     * having Slack's pane open meant the other profile silently got no
     * sections. Each pane is stamped and given its own keepMounted, which keeps
     * the re-render protection that mattered in the first place: Slack rebuilds
     * the pane's contents when presence changes.
     */
    let seq = 0;
    api.dom.onEach(PANE, (pane) => {
      const key = `${NODE_CLASS}-${seq++}`;
      pane.setAttribute('data-betterslack-pane', key);
      api.helpers.mount(`[data-betterslack-pane="${key}"]`, key, () => {
        const host = api.dom.h('div', { class: NODE_CLASS });
        fill(host, pane);
        return host;
      });
    });
  },

  stop() {},
};
